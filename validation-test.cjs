// Final end-to-end validation for Msaada — Issue #3
// Runs the full user journey through HTTP APIs.

const BASE = "http://localhost:3000";
const fs = require("fs");

// Persistent cookie jar (in-memory)
const cookieJar = {};

function headers(extra = {}) {
  const h = { ...extra };
  const cookies = Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (cookies) h["cookie"] = cookies;
  return h;
}

function captureCookies(resp) {
  const setCookie = resp.headers.get("set-cookie");
  if (setCookie) {
    // set-cookie may be a single string with multiple cookies separated by ,
    // For our session cookie there is just one. Parse name=value up to first ;
    setCookie
      .split(/,(?=\s*[a-zA-Z0-9_-]+=)/)
      .forEach((c) => {
        const m = c.trim().match(/^([^=]+)=([^;]*)/);
        if (m) cookieJar[m[1]] = m[2];
      });
  }
}

async function req(method, path, body, extra = {}) {
  const url = new URL(BASE + path);
  const opts = {
    method,
    headers: headers(extra),
  };
  if (body !== undefined && body !== null) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const t0 = Date.now();
  const resp = await fetch(url, opts);
  captureCookies(resp);
  const ms = Date.now() - t0;
  let data = null;
  const text = await resp.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: resp.status, data, ms, headers: resp.headers };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const results = [];
function record(step, ok, detail = "") {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? "  —  " + detail : ""}`);
}

(async () => {
  console.log("\n=== STEP 1: Login as demo CHV (demo@msaada.health / msaada123) ===");
  let r = await req("POST", "/api/auth/login", {
    email: "demo@msaada.health",
    password: "msaada123",
  });
  console.log("status", r.status, "ms", r.ms, "data", JSON.stringify(r.data));
  assert(r.status === 200, `login status 200, got ${r.status}`);
  assert(r.data && r.data.chv && r.data.chv.email === "demo@msaada.health", "login returned chv");
  assert(cookieJar["msaada_session"], "session cookie set");
  record("Login as demo CHV (POST /api/auth/login)", true, `200 in ${r.ms}ms; cookie set; chv.email=${r.data.chv.email}; role=${r.data.chv.role ?? "(none)"}`);

  console.log("\n=== STEP 2: GET /api/auth/me ===");
  r = await req("GET", "/api/auth/me");
  console.log("status", r.status, "data", JSON.stringify(r.data));
  assert(r.status === 200, `auth/me 200, got ${r.status}`);
  assert(r.data && r.data.chv, "auth/me returned chv");
  assert(r.data.chv.email === "demo@msaada.health", "auth/me chv.email correct");
  record("GET /api/auth/me", true, `200; chv.email=${r.data.chv.email}; role=${r.data.chv.role ?? "(none)"}`);

  console.log("\n=== STEP 3: GET /api/community-reports (expect 4 reports) ===");
  r = await req("GET", "/api/community-reports");
  console.log("status", r.status, "total", r.data && r.data.total);
  assert(r.status === 200, `community-reports 200, got ${r.status}`);
  const reportsCount = (r.data && Array.isArray(r.data.reports) && r.data.reports.length) || 0;
  const reportsTotal = (r.data && r.data.total) || 0;
  record("GET /api/community-reports (seeded)", reportsTotal === 4 || reportsCount === 4, `status=200; reports.length=${reportsCount}; total=${reportsTotal}`);
  // Save report ids for follow-up checks if needed
  const reportIds = (r.data && r.data.reports || []).map((x) => x.id);

  console.log("\n=== STEP 4: GET /api/response-cases (expect 2 cases assigned to demo CHV) ===");
  r = await req("GET", "/api/response-cases");
  console.log("status", r.status, "cases", JSON.stringify(r.data && r.data.cases && r.data.cases.map((c) => ({ id: c.id, status: c.status, reportCode: c.reportCode }))));
  assert(r.status === 200, `response-cases 200, got ${r.status}`);
  const cases = (r.data && r.data.cases) || [];
  record("GET /api/response-cases (seeded)", cases.length === 2, `status=200; cases.length=${cases.length}`);

  console.log("\n=== STEP 5: GET /api/dashboard (aggregate stats) ===");
  r = await req("GET", "/api/dashboard");
  console.log("status", r.status, "totals", JSON.stringify(r.data && r.data.totals));
  assert(r.status === 200, `dashboard 200, got ${r.status}`);
  const totals = (r.data && r.data.totals) || {};
  record("GET /api/dashboard", totals && typeof totals.total === "number", `status=200; totals.total=${totals.total}; byCounty.length=${(r.data && r.data.byCounty && r.data.byCounty.length) || 0}; byDay.length=${(r.data && r.data.byDay && r.data.byDay.length) || 0}`);

  console.log("\n=== STEP 6: Public report submission — POST /api/community-reports ===");
  const testObs = "Mama amekuwa akijitenga na jirani, halali vizuri, anakula kidogo. Tunahisi anahitaji msaada wa kisaikolojia.";
  r = await req("POST", "/api/community-reports", {
    description: testObs,
    category: "mental_health",
    county: "Kilifi",
    ward: "Malindi Town",
    landmark: "Near the chief camp",
    reporterName: "Neighbour",
    reporterContact: "0712345678",
  });
  console.log("status", r.status, "data", JSON.stringify(r.data));
  record("POST /api/community-reports (public)", r.status === 201, `status=${r.status}; reportCode=${r.data && r.data.reportCode}; status=${r.data && r.data.status}`);
  const newReportId = r.data && r.data.id;

  console.log("\n=== STEP 7: CHV workflow — accept case ===");
  if (cases.length === 0) {
    record("PATCH /api/response-cases/[id] action=accept", false, "no cases available");
  } else {
    const case0 = cases[0];
    r = await req("PATCH", `/api/response-cases/${case0.id}`, { action: "accept" });
    console.log("status", r.status, "data", JSON.stringify(r.data));
    record("PATCH /api/response-cases/[id] action=accept", r.status === 200 && r.data && r.data.status === "accepted", `status=${r.status}; case.status=${r.data && r.data.status}; acceptedAt=${r.data && r.data.acceptedAt ? "set" : "null"}`);

    console.log("\n=== STEP 8: CHV workflow — start response ===");
    r = await req("PATCH", `/api/response-cases/${case0.id}`, { action: "start" });
    console.log("status", r.status, "data", JSON.stringify(r.data));
    record("PATCH /api/response-cases/[id] action=start", r.status === 200 && r.data && r.data.status === "response_started", `status=${r.status}; case.status=${r.data && r.data.status}`);
  }

  console.log("\n=== STEP 9: Logout (cleanup) ===");
  r = await req("POST", "/api/auth/logout", {});
  console.log("status", r.status, "data", JSON.stringify(r.data));
  record("Logout (POST /api/auth/logout)", r.status === 200, `status=${r.status}`);

  // ===== Summary =====
  console.log("\n=== SUMMARY ===");
  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.ok) pass++; else fail++;
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}  —  ${r.detail}`);
  }
  console.log(`\nTotal: ${pass} pass, ${fail} fail / ${results.length}`);
  fs.writeFileSync("/home/z/my-project/validation-results.json", JSON.stringify({ results, pass, fail }, null, 2));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
