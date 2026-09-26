import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SlideViewer, type SlideMeta } from "@/components/msaada/SlideViewer";

// Server component — reads the slide HTML files from public/slides at request
// time to extract titles + speaker notes (the slides themselves are served
// statically and rendered in the client viewer's iframe).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SLIDES_DIR = join(process.cwd(), "public", "slides");
const SLIDE_RE = /^slide_(\d+)\.html$/;

function extractTag(html: string, tag: string): string | null {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : null;
}

/** Strip markup + decode the handful of entities the notes use. */
function htmlToText(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function loadSlides(): Promise<SlideMeta[]> {
  // Fallback deck: the known 12 slides — used if the fs listing fails (e.g.
  // an unexpected deployment layout). The viewer still works; notes/titles
  // just fall back to their generic forms.
  const fallback: SlideMeta[] = Array.from({ length: 12 }, (_, i) => ({
    src: `/slides/slide_${String(i + 1).padStart(2, "0")}.html`,
    title: `Slide ${i + 1}`,
    notes: null,
  }));

  try {
    const files = (await readdir(SLIDES_DIR))
      .map((f) => {
        const m = f.match(SLIDE_RE);
        return m ? { file: f, n: Number(m[1]) } : null;
      })
      .filter((x): x is { file: string; n: number } => x !== null)
      .sort((a, b) => a.n - b.n);

    if (files.length === 0) return fallback;

    const slides = await Promise.all(
      files.map(async ({ file, n }) => {
        let title = `Slide ${n}`;
        let notes: string | null = null;
        try {
          const html = await readFile(join(SLIDES_DIR, file), "utf-8");
          const rawTitle = extractTag(html, "title");
          if (rawTitle) {
            title =
              htmlToText(rawTitle).replace(/^Msaada\s*—\s*/i, "").trim() ||
              `Slide ${n}`;
          }
          const aside = html.match(
            /<aside[^>]*data-notes[^>]*>([\s\S]*?)<\/aside>/i
          );
          if (aside) notes = htmlToText(aside[1]) || null;
        } catch {
          // unreadable slide file — keep generic title, no notes
        }
        return { src: `/slides/${file}`, title, notes } satisfies SlideMeta;
      })
    );
    return slides;
  } catch {
    return fallback;
  }
}

export default async function PresentationPage() {
  const slides = await loadSlides();
  return <SlideViewer slides={slides} />;
}
