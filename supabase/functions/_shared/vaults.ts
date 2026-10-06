// ─── Asking across vaults (046) ─────────────────────────────────
//
// rag-search searches each of a person's vaults as one always was — its own
// family tree, index state and capped retrieval — and then puts what the
// vaults found together, here. Pure, so the QA self-test runs it.
// ────────────────────────────────────────────────────────────────

import type { NamedRelative } from './kinship.ts';

/**
 * Lists taken in turn, the best of each first. Every vault keeps its own
 * ranking, and the judge's places are shared out rather than won by
 * whichever vault holds the most documents: a family's 111-chunk tax return
 * cannot push a personal vault's one right passage out of view.
 */
export function takeInTurn<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) out.push(l[i]);
  }
  return out;
}

/** The same relative named in two vaults' trees is one note, not two. */
export function uniqueRelatives(all: NamedRelative[]): NamedRelative[] {
  const seen = new Set<string>();
  return all.filter((n) => {
    const key = `${n.term}|${n.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
