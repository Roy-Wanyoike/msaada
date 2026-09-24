import { readFileSync } from "fs";
import { join } from "path";
import { DocsTabs } from "@/components/msaada/DocsTabs";

// Server component — reads the markdown files at request time.
export const dynamic = "force-dynamic";

async function readDoc(filename: string): Promise<string> {
  try {
    const filepath = join(process.cwd(), filename);
    return readFileSync(filepath, "utf-8");
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
