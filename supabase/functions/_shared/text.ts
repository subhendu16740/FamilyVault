// ─── Making extracted text safe to store ────────────────────────
//
// Pure, so qa/tools/selftest.mjs can test it without a Deno runtime.
// ────────────────────────────────────────────────────────────────

/**
 * Strip what Postgres will not store, and the control noise around it.
 *
 * PDF.js emits U+0000 for a glyph it cannot map to a character — a font with
 * no ToUnicode table, as in browser-made Hindi PDFs. Postgres refuses a NUL
 * anywhere in `text` or `jsonb` ("unsupported Unicode escape sequence"), so a
 * single one failed the WHOLE ingestion: complete_document_ingestion returned
 * 500 and the document sat at 'pending', never searchable. A lone UTF-16
 * surrogate fails the same way.
 *
 * NUL is removed rather than replaced with a space: it stands for a letter
 * inside a word, and a space would split the word for search. Form feed (a
 * page break) becomes a line break; other control characters, a space.
 */
export function cleanText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/\f/g, '\n')
    .replace(/[\u0001-\u0008\u000B\u000E-\u001F\u007F]/g, ' ');
}
