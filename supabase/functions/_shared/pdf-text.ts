// ─── Reading text out of a PDF, with the page layout intact ─────
//
// A PDF has no lines, no paragraphs and no table rows. It has glyphs at
// coordinates, written to the content stream in whatever order the
// producing program felt like. Read that stream in order and a table comes
// out column by column: every label, then every figure in the first column,
// then every figure in the second. That is what happened to this vault's
// placements report — the question "80% CTC range for Operations" was
// unanswerable because "Operations" and "27 - 44" ended up 200 characters
// apart with nine other functions and twenty other numbers in between.
//
// So this does what a reader's eye does: take each piece of text with its
// position, group pieces that share a baseline into a line, order them left
// to right, and put a run of spaces where there is a visible gap. The table
// comes back as rows:
//
//     Operations    28,73,765    31,61,743    27 - 44
//
// which the answering model, the relevance judge and keyword search can all
// use. Prose is unaffected — it was already in reading order — but it gains
// real line and paragraph breaks, which the chunker needs to split on
// sensible boundaries.
//
// PDF.js does the parsing. `pdfjs-serverless` is a single-file build of it
// for runtimes without Node's filesystem, which is what an Edge Function is.
// ────────────────────────────────────────────────────────────────

/** One piece of text as PDF.js reports it: the string and where it sits. */
export interface TextPiece {
  str: string;
  /** Left edge, in PDF units (1/72 inch), origin bottom-left. */
  x: number;
  /** Baseline, in PDF units. Larger is further UP the page. */
  y: number;
  /** Rendered width, used to tell a word space from a column gap. */
  width: number;
  /** Font size, used as the tolerance for "same line". */
  height: number;
  /** PDF.js's own hint that a line ended here. */
  hasEOL?: boolean;
}

/** Pieces closer than this fraction of the font size share a baseline. */
const LINE_TOLERANCE = 0.5;
/** A gap wider than this many times the font size is a column boundary. */
const COLUMN_GAP = 0.9;
/** A vertical step larger than this many TYPICAL line steps starts a
 *  paragraph. Measured against the page's own median step rather than the
 *  font size: a table set on 22-unit rows in 10-point type is not a page full
 *  of paragraphs, it is a table, and judging by font size alone says it is. */
const PARAGRAPH_GAP = 1.6;

/**
 * Rebuild readable text from positioned pieces. Pure and synchronous, so it
 * can be exercised without a PDF engine — the ordering rules are the part
 * that is easy to get wrong, not the parsing.
 */
export function reconstructLayout(pieces: TextPiece[]): string {
  const kept = pieces.filter(p => p.str && p.str.trim().length > 0);
  if (kept.length === 0) return '';

  // ── Group by baseline. Sorting by descending y walks down the page.
  const lines: TextPiece[][] = [];
  for (const piece of [...kept].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines[lines.length - 1];
    const tolerance = Math.max(1, (piece.height || 10) * LINE_TOLERANCE);
    if (line && Math.abs(line[0].y - piece.y) <= tolerance) line.push(piece);
    else lines.push([piece]);
  }

  const rendered: { text: string; y: number; height: number }[] = [];

  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);

    let text = '';
    let cursor: number | null = null;
    for (const piece of line) {
      if (cursor !== null) {
        const gap = piece.x - cursor;
        const size = piece.height || 10;
        if (gap > size * COLUMN_GAP) {
          // A visible gap. Two spaces, so the boundary survives into the
          // stored text and a reader (or a model) sees separate cells.
          text += '  ';
        } else if (gap > size * 0.12 && !/\s$/.test(text)) {
          text += ' ';
        }
      }
      text += piece.str;
      cursor = piece.x + (piece.width || 0);
    }

    const trimmed = text.replace(/[ \t]+/g, m => (m.length > 1 ? '  ' : ' ')).trim();
    if (trimmed) {
      rendered.push({ text: trimmed, y: line[0].y, height: line[0].height || 10 });
    }
  }

  // ── Join lines, opening a paragraph where the page leaves a real space.
  const typicalStep = medianStep(rendered.map(r => r.y));
  let out = '';
  for (let i = 0; i < rendered.length; i++) {
    if (i > 0) {
      const step = rendered[i - 1].y - rendered[i].y;
      out += step > typicalStep * PARAGRAPH_GAP ? '\n\n' : '\n';
    }
    out += rendered[i].text;
  }
  return out.trim();
}

/** The page's own usual line spacing, so the paragraph rule adapts to it. */
function medianStep(baselines: number[]): number {
  const steps: number[] = [];
  for (let i = 1; i < baselines.length; i++) {
    const step = baselines[i - 1] - baselines[i];
    if (step > 0.5) steps.push(step);
  }
  if (steps.length === 0) return 12;
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)];
}

/**
 * Extract every page of a PDF as laid-out text.
 *
 * Throws rather than returning something plausible-but-wrong, so the caller
 * can fall back to the older extractor and then to OCR. A PDF that is purely
 * scanned images has no text pieces at all and comes back empty, which is
 * the signal to try OCR.
 */
export async function extractPdfLayoutText(bytes: Uint8Array): Promise<string> {
  const { getDocument } = await import('https://esm.sh/pdfjs-serverless@1.3.1');

  const doc = await getDocument({
    data: bytes,
    useSystemFonts: true,
    // Nothing is being drawn, and both of these fetch assets we cannot reach.
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();

    const pieces: TextPiece[] = (content.items as Record<string, unknown>[])
      .filter(item => typeof item.str === 'string')
      .map(item => {
        // transform is [a, b, c, d, e, f]; e and f are the position, and d
        // is the vertical scale, which is the effective font size.
        const t = (item.transform ?? [1, 0, 0, 10, 0, 0]) as number[];
        return {
          str: item.str as string,
          x: t[4],
          y: t[5],
          width: (item.width as number) ?? 0,
          height: Math.abs(t[3]) || (item.height as number) || 10,
          hasEOL: item.hasEOL as boolean | undefined,
        };
      });

    const text = reconstructLayout(pieces);
    if (text) pages.push(text);
  }

  // Page breaks are paragraph breaks as far as chunking is concerned.
  return pages.join('\n\n');
}
