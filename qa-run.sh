#!/usr/bin/env bash
# QA script: verify all 12 routes + mobile audit
set -u
cd /home/z/my-project

LOG=/home/z/my-project/qa-stdout.log
: > "$LOG"

# ---------- 1. Start dev server ----------
pkill -9 -f "next-server" 2>/dev/null
pkill -9 -f "next dev" 2>/dev/null
pkill -9 -f "node_modules/.bin/next" 2>/dev/null
sleep 2
rm -f /home/z/my-project/dev.log

echo "=== Starting dev server ===" | tee -a "$LOG"
setsid bash -c 'cd /home/z/my-project && exec /home/z/my-project/node_modules/.bin/next dev -p 3000' </dev/null >/home/z/my-project/dev.log 2>&1 &
disown
SRV_BASH_PID=$!

# Wait for server
echo "Waiting for server to be ready..." | tee -a "$LOG"
for i in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 3 http://127.0.0.1:3000/ ; then
    echo "Server ready after ${i}s" | tee -a "$LOG"
    break
  fi
  sleep 1
done

# Confirm server is up
PING=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 http://127.0.0.1:3000/)
echo "Initial / ping: $PING" | tee -a "$LOG"

# ---------- 2. Warm all 12 routes via curl ----------
echo "" | tee -a "$LOG"
echo "=== Warming 12 routes via curl ===" | tee -a "$LOG"
ROUTES=(/ /report /cases /households /dashboard /audit /supervisor /referrals /report/mine /settings /admin /docs)
for r in "${ROUTES[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 90 "http://127.0.0.1:3000${r}")
  echo "warm ${r} ${code}" | tee -a "$LOG"
  sleep 2
done

# Check server still alive
SRV_CHECK=$(ps -ef | grep next-server | grep -v grep | head -1)
if [ -z "$SRV_CHECK" ]; then
  echo "WARNING: Server appears dead after warming" | tee -a "$LOG"
else
  echo "Server still alive after warming" | tee -a "$LOG"
fi

# ---------- 3. agent-browser setup ----------
echo "" | tee -a "$LOG"
echo "=== Starting agent-browser verification ===" | tee -a "$LOG"

SS_DIR=/home/z/my-project/reviews/screenshots
mkdir -p "$SS_DIR"

# Set desktop viewport
agent-browser set viewport 1280 800 2>&1 | tail -2 | tee -a "$LOG"

# ---------- 3a. Public routes: /report, /docs ----------
PUBLIC_ROUTES=(/report /docs)
for r in "${PUBLIC_ROUTES[@]}"; do
  echo "" | tee -a "$LOG"
  echo "--- PUBLIC: $r ---" | tee -a "$LOG"
  agent-browser cookies clear 2>&1 | tail -1 | tee -a "$LOG"
  agent-browser open "http://127.0.0.1:3000${r}" 2>&1 | tail -3 | tee -a "$LOG"
  agent-browser wait --load networkidle 2>&1 | tail -1 | tee -a "$LOG"
  # Snapshot (first 60 lines)
  echo "  [snapshot]" | tee -a "$LOG"
  agent-browser snapshot -c 2>&1 | head -60 | tee -a "$LOG"
  # Page errors
  echo "  [errors]" | tee -a "$LOG"
  agent-browser errors 2>&1 | head -30 | tee -a "$LOG"
  # Screenshot
  agent-browser screenshot "${SS_DIR}/public${r//\//_}.png" 2>&1 | tail -1 | tee -a "$LOG"
  # Page title for sanity
  echo "  [title]" | tee -a "$LOG"
  agent-browser get title 2>&1 | tee -a "$LOG"
done

# ---------- 3b. Authed routes via demo account ----------
AUTHED_ROUTES=(/ /cases /households /dashboard /audit /supervisor /referrals /report/mine /settings /admin)
echo "" | tee -a "$LOG"
echo "=== Auth flow: clear cookies -> open / -> click demo account ===" | tee -a "$LOG"
agent-browser cookies clear 2>&1 | tail -1 | tee -a "$LOG"
agent-browser open "http://127.0.0.1:3000/" 2>&1 | tail -3 | tee -a "$LOG"
agent-browser wait --load networkidle 2>&1 | tail -1 | tee -a "$LOG"
echo "[snapshot of login page]" | tee -a "$LOG"
agent-browser snapshot -i 2>&1 | head -80 | tee -a "$LOG"

# Try to find a demo-account link/button
echo "[clicking demo account button]" | tee -a "$LOG"
# Try various selectors
agent-browser find text "demo" click 2>&1 | tail -3 | tee -a "$LOG"
agent-browser wait --load networkidle 2>&1 | tail -1 | tee -a "$LOG"
agent-browser wait 2000 2>&1 | tail -1 | tee -a "$LOG"
echo "[post-demo snapshot]" | tee -a "$LOG"
agent-browser snapshot -c 2>&1 | head -40 | tee -a "$LOG"
agent-browser get url 2>&1 | tee -a "$LOG"

# Screenshot of / after demo login
agent-browser screenshot "${SS_DIR}/authed_root.png" 2>&1 | tail -1 | tee -a "$LOG"

# Now navigate to each authed route
for r in "${AUTHED_ROUTES[@]}"; do
  # Skip / since we're already here
  if [ "$r" = "/" ]; then continue; fi
  echo "" | tee -a "$LOG"
  echo "--- AUTHED: $r ---" | tee -a "$LOG"
  agent-browser open "http://127.0.0.1:3000${r}" 2>&1 | tail -3 | tee -a "$LOG"
  agent-browser wait --load networkidle 2>&1 | tail -1 | tee -a "$LOG"
  agent-browser wait 1500 2>&1 | tail -1 | tee -a "$LOG"
  echo "  [snapshot]" | tee -a "$LOG"
  agent-browser snapshot -c 2>&1 | head -60 | tee -a "$LOG"
  echo "  [errors]" | tee -a "$LOG"
  agent-browser errors 2>&1 | head -30 | tee -a "$LOG"
  safe_name="${r//\//_}"
  safe_name="${safe_name#_}"  # strip leading _
  agent-browser screenshot "${SS_DIR}/authed${safe_name}.png" 2>&1 | tail -1 | tee -a "$LOG"
  echo "  [title]" | tee -a "$LOG"
  agent-browser get title 2>&1 | tee -a "$LOG"
  agent-browser errors --clear 2>&1 | tail -1 | tee -a "$LOG"
done

# ---------- 4. Mobile audit: /report and /cases ----------
echo "" | tee -a "$LOG"
echo "=== Mobile audit (375x667) ===" | tee -a "$LOG"
agent-browser set viewport 375 667 2>&1 | tail -2 | tee -a "$LOG"

for r in /report /cases; do
  echo "" | tee -a "$LOG"
  echo "--- MOBILE: $r ---" | tee -a "$LOG"
  agent-browser open "http://127.0.0.1:3000${r}" 2>&1 | tail -3 | tee -a "$LOG"
  agent-browser wait --load networkidle 2>&1 | tail -1 | tee -a "$LOG"
  agent-browser wait 1500 2>&1 | tail -1 | tee -a "$LOG"
  echo "  [mobile snapshot]" | tee -a "$LOG"
  agent-browser snapshot -c 2>&1 | head -60 | tee -a "$LOG"
  echo "  [mobile errors]" | tee -a "$LOG"
  agent-browser errors 2>&1 | head -20 | tee -a "$LOG"
  safe_name="${r//\//_}"
  safe_name="${safe_name#_}"
  agent-browser screenshot "${SS_DIR}/mobile${safe_name}.png" 2>&1 | tail -1 | tee -a "$LOG"
  # Check horizontal overflow via JS
  echo "  [overflow check]" | tee -a "$LOG"
  agent-browser eval "JSON.stringify({scrollW:document.documentElement.scrollWidth,clientW:document.documentElement.clientWidth,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth})" 2>&1 | tee -a "$LOG"
  # Touch target sizes: get all interactive elements' bounding boxes
  echo "  [touch target audit - first 20 interactive]" | tee -a "$LOG"
  agent-browser eval "JSON.stringify(Array.from(document.querySelectorAll('button, a, input, select, textarea, [role=button], [role=link]')).slice(0,20).map(e=>{const b=e.getBoundingClientRect();return{tag:e.tagName.toLowerCase(),text:(e.innerText||e.value||e.getAttribute('aria-label')||'').slice(0,30),w:Math.round(b.width),h:Math.round(b.height)}}))" 2>&1 | tee -a "$LOG"
done

# ---------- 5. Cleanup ----------
echo "" | tee -a "$LOG"
echo "=== Cleanup ===" | tee -a "$LOG"
agent-browser close 2>&1 | tail -1 | tee -a "$LOG"
pkill -9 -f "next-server" 2>/dev/null
pkill -9 -f "next dev" 2>/dev/null
echo "DONE" | tee -a "$LOG"
