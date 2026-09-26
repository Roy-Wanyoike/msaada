import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DocsTabs } from "@/components/msaada/DocsTabs";

// Server component — reads the repo markdown files at request time.
//
// Hardened against the Turbopack warning class reported in #19: the Node
// built-ins use the explicit `node:` prefix (never silently shimmed into a
// client/edge graph — a bundler errors loudly instead of warning), the read
// is async via `node:fs/promises` (no sync fs call in the request path), and
// the runtime is pinned to Node.js so no Edge evaluation of this module can
// ever be attempted.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readDoc(filename: string): Promise<string> {
  try {
    return await readFile(join(process.cwd(), filename), "utf-8");
  } catch {
    return `# ${filename} not found`;
  }
}

export default async function DocsPage() {
  const [readme, problem, license] = await Promise.all([
    readDoc("README.md"),
    readDoc("PROBLEM.md"),
    readDoc("LICENSE"),
  ]);

  return <DocsTabs readme={readme} problem={problem} license={license} />;
}
