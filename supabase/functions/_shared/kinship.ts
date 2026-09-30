// ─── Kinship: who is this person to me? ─────────────────────────
//
// The family tree stores only three kinds of link — parent, spouse and
// sibling — and never a label like "Mother". A label depends on who is
// looking: Asha is Aarav's mother, Rohan's wife and Kamala's daughter-in-law.
// So labels are computed here, from the viewer's own place in the tree.
//
// Hindi terms are part of the answer, not a translation: they carry what
// English leaves out. Your father's mother is Dadi and your mother's mother
// is Nani; your father's sister is Bua and your mother's sister is Mausi.
// "Nani's pension papers" is a question a family actually asks.
//
// Pure and dependency-free ON PURPOSE: the app imports this file for the
// tree screen, rag-search imports it to resolve "Mom's passport" before
// retrieval, and the QA self-test runs it in Node. One set of rules.
// Only erasable TypeScript here (no enums), so Node can strip the types.
// ────────────────────────────────────────────────────────────────

export type Gender = 'female' | 'male' | null;

export interface KinPerson {
  id: string;
  name: string;
  gender: Gender;
  /** YYYY-MM-DD. Only used to tell elder from younger (Tau/Chacha, Jeth/Devar). */
  birthDate?: string | null;
}

/** `parent`: from is a parent of to. `spouse` and `sibling` read both ways. */
export type LinkKind = 'parent' | 'spouse' | 'sibling';

export interface KinLink {
  from: string;
  to: string;
  kind: LinkKind;
}

export interface Relation {
  /** Stable key for the pattern, e.g. "P" (parent), "PP" (grandparent), "PBS". */
  path: string;
  /** "Mother", "Grandmother", "Sister-in-law"… */
  en: string;
  /** "Maa", "Nani", "Bhabhi"… — null where Hindi has no common word. */
  hi: string | null;
}

// A step from one person to the next: to a Parent, a Child, a Spouse, a
// siBling (by a sibling link, or by sharing a parent).
type Step = 'P' | 'C' | 'S' | 'B';

export interface KinGraph {
  people: Map<string, KinPerson>;
  parents: Map<string, Set<string>>;
  children: Map<string, Set<string>>;
  spouses: Map<string, Set<string>>;
  siblingLinks: Map<string, Set<string>>;
}

const add = (map: Map<string, Set<string>>, key: string, value: string) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(value);
};

export function buildGraph(people: KinPerson[], links: KinLink[]): KinGraph {
  const graph: KinGraph = {
    people: new Map(people.map((p) => [p.id, p])),
    parents: new Map(),
    children: new Map(),
    spouses: new Map(),
    siblingLinks: new Map(),
  };
  for (const l of links) {
    if (l.from === l.to || !graph.people.has(l.from) || !graph.people.has(l.to)) continue;
    if (l.kind === 'parent') {
      add(graph.parents, l.to, l.from);
      add(graph.children, l.from, l.to);
    } else if (l.kind === 'spouse') {
      add(graph.spouses, l.from, l.to);
      add(graph.spouses, l.to, l.from);
    } else if (l.kind === 'sibling') {
      add(graph.siblingLinks, l.from, l.to);
      add(graph.siblingLinks, l.to, l.from);
    }
  }
  return graph;
}

const setOf = (map: Map<string, Set<string>>, id: string) => [...(map.get(id) ?? [])];

export const parentsOf = (g: KinGraph, id: string) => setOf(g.parents, id);
export const childrenOf = (g: KinGraph, id: string) => setOf(g.children, id);
export const spousesOf = (g: KinGraph, id: string) => setOf(g.spouses, id);

/** Brothers and sisters: a sibling link, or at least one parent in common. */
export function siblingsOf(g: KinGraph, id: string): string[] {
  const out = new Set(setOf(g.siblingLinks, id));
  for (const p of parentsOf(g, id)) for (const c of childrenOf(g, p)) out.add(c);
  // Siblings of siblings by link (three children linked pairwise, no parents).
  for (const s of [...out]) for (const t of setOf(g.siblingLinks, s)) out.add(t);
  out.delete(id);
  return [...out];
}

function neighbours(g: KinGraph, id: string): Array<[Step, string]> {
  return [
    ...parentsOf(g, id).map((x): [Step, string] => ['P', x]),
    ...childrenOf(g, id).map((x): [Step, string] => ['C', x]),
    ...spousesOf(g, id).map((x): [Step, string] => ['S', x]),
    ...siblingsOf(g, id).map((x): [Step, string] => ['B', x]),
  ];
}

const g3 = (gender: Gender, female: string, male: string, neutral: string) =>
  gender === 'female' ? female : gender === 'male' ? male : neutral;

// Elder or younger than the reference person, when both birth dates are known.
function elder(a: KinPerson | undefined, b: KinPerson | undefined): boolean | null {
  if (!a?.birthDate || !b?.birthDate) return null;
  return a.birthDate < b.birthDate;
}

/**
 * Name one path. `chain` is the people along it, starting with the viewer
 * and ending with the person being named. Returns null for a path that has
 * no everyday name — the caller then tries a longer or different path.
 */
function nameFor(path: string, chain: KinPerson[]): Relation | null {
  const me = chain[0];
  const them = chain[chain.length - 1];
  const via = chain[1];            // the first person on the way
  const g = them.gender;
  const viaFemale = via?.gender === 'female';
  const viaMale = via?.gender === 'male';
  const r = (en: string, hi: string | null): Relation => ({ path, en, hi });

  switch (path) {
    case '': return r('You', null);
    case 'P': return r(g3(g, 'Mother', 'Father', 'Parent'), g3(g, 'Maa', 'Papa', '') || null);
    case 'C': return r(g3(g, 'Daughter', 'Son', 'Child'), g3(g, 'Beti', 'Beta', '') || null);
    case 'S': return r(g3(g, 'Wife', 'Husband', 'Spouse'), g3(g, 'Patni', 'Pati', '') || null);
    case 'B': {
      const older = elder(them, me);
      const hi = g === 'female' ? (older ? 'Didi' : 'Behen') : g === 'male' ? (older ? 'Bhaiya' : 'Bhai') : null;
      return r(g3(g, 'Sister', 'Brother', 'Sibling'), hi);
    }

    case 'PP': {
      // Through Papa: Dada/Dadi. Through Maa: Nana/Nani.
      const hi = viaMale ? g3(g, 'Dadi', 'Dada', '') : viaFemale ? g3(g, 'Nani', 'Nana', '') : '';
      return r(g3(g, 'Grandmother', 'Grandfather', 'Grandparent'), hi || null);
    }
    case 'CC': {
      // A son's children: Pota/Poti. A daughter's: Nati/Natin.
      const hi = viaMale ? g3(g, 'Poti', 'Pota', '') : viaFemale ? g3(g, 'Natin', 'Nati', '') : '';
      return r(g3(g, 'Granddaughter', 'Grandson', 'Grandchild'), hi || null);
    }
    case 'PPP': {
      // Papa's Dada/Dadi are Pardada/Pardadi; Maa's Nana/Nani are Parnana/Parnani.
      // Mixed lines (Papa's Nani) have no single word families agree on.
      const second = chain[2];
      const hi = viaMale && second?.gender === 'male' ? g3(g, 'Pardadi', 'Pardada', '')
        : viaFemale && second?.gender === 'female' ? g3(g, 'Parnani', 'Parnana', '') : '';
      return r(g3(g, 'Great-grandmother', 'Great-grandfather', 'Great-grandparent'), hi || null);
    }
    case 'CCC': return r(g3(g, 'Great-granddaughter', 'Great-grandson', 'Great-grandchild'), null);

    case 'PB': {
      // Papa's brother: Tau if elder than Papa, else Chacha. Papa's sister: Bua.
      // Maa's brother: Mama. Maa's sister: Mausi.
      let hi = '';
      if (viaMale) hi = g === 'male' ? (elder(them, via) ? 'Tau' : 'Chacha') : g === 'female' ? 'Bua' : '';
      if (viaFemale) hi = g === 'male' ? 'Mama' : g === 'female' ? 'Mausi' : '';
      return r(g3(g, 'Aunt', 'Uncle', "Parent's sibling"), hi || null);
    }
    case 'PBS': {
      // The aunt's or uncle's spouse, named from the blood aunt or uncle.
      const blood = chain[2];
      let hi = '';
      if (viaMale && blood?.gender === 'male') hi = g === 'female' ? (elder(blood, via) ? 'Tai' : 'Chachi') : '';
      if (viaMale && blood?.gender === 'female') hi = g === 'male' ? 'Phupha' : '';
      if (viaFemale && blood?.gender === 'male') hi = g === 'female' ? 'Mami' : '';
      if (viaFemale && blood?.gender === 'female') hi = g === 'male' ? 'Mausa' : '';
      return r(g3(g, 'Aunt', 'Uncle', "Parent's sibling's spouse"), hi || null);
    }
    case 'PBC': return r('Cousin', null);
    case 'BC': {
      // A brother's children: Bhatija/Bhatiji. A sister's: Bhanja/Bhanji.
      const hi = viaMale ? g3(g, 'Bhatiji', 'Bhatija', '') : viaFemale ? g3(g, 'Bhanji', 'Bhanja', '') : '';
      return r(g3(g, 'Niece', 'Nephew', "Sibling's child"), hi || null);
    }
    case 'BCC': return r(g3(g, 'Grandniece', 'Grandnephew', "Sibling's grandchild"), null);

    case 'SP': return r(g3(g, 'Mother-in-law', 'Father-in-law', 'Parent-in-law'), g3(g, 'Saas', 'Sasur', '') || null);
    case 'CS': return r(g3(g, 'Daughter-in-law', 'Son-in-law', 'Child-in-law'), g3(g, 'Bahu', 'Damad', '') || null);
    case 'BS': {
      // A brother's wife: Bhabhi. A sister's husband: Jija.
      const hi = viaMale && g === 'female' ? 'Bhabhi' : viaFemale && g === 'male' ? 'Jija' : '';
      return r(g3(g, 'Sister-in-law', 'Brother-in-law', 'Sibling-in-law'), hi || null);
    }
    case 'SB': {
      // A husband's brother: Jeth if elder than him, else Devar; his sister: Nanad.
      // A wife's brother: Saala; her sister: Saali.
      let hi = '';
      if (viaMale) hi = g === 'male' ? (elder(them, via) ? 'Jeth' : 'Devar') : g === 'female' ? 'Nanad' : '';
      if (viaFemale) hi = g === 'male' ? 'Saala' : g === 'female' ? 'Saali' : '';
      return r(g3(g, 'Sister-in-law', 'Brother-in-law', 'Sibling-in-law'), hi || null);
    }
    case 'SBS': return r(g3(g, 'Sister-in-law', 'Brother-in-law', 'Sibling-in-law'), null);
    case 'SPP': return r(g3(g, "Spouse's grandmother", "Spouse's grandfather", "Spouse's grandparent"), null);
    case 'CSP': return r(g3(g, "Child's mother-in-law", "Child's father-in-law", "Child's parent-in-law"), g3(g, 'Samdhan', 'Samdhi', '') || null);

    // A parent's spouse who is not your parent, and a spouse's child who is not yours.
    case 'PS': return r(g3(g, 'Stepmother', 'Stepfather', 'Step-parent'), null);
    case 'SC': return r(g3(g, 'Stepdaughter', 'Stepson', 'Stepchild'), null);
    default: return null;
  }
}

const MAX_STEPS = 3;

/**
 * What `otherId` is to `meId`: the shortest path through the tree that has
 * an everyday name. Null when they are not connected, or only by a path
 * too long to name (the tree then shows just their name).
 */
export function relationTo(g: KinGraph, meId: string, otherId: string): Relation | null {
  const me = g.people.get(meId);
  const other = g.people.get(otherId);
  if (!me || !other) return null;
  if (meId === otherId) return nameFor('', [me]);

  // Breadth-first over paths, shortest first, never revisiting a person on
  // the same path. Families are small; every path up to three steps is cheap.
  let frontier: Array<{ path: string; chain: string[] }> = [{ path: '', chain: [meId] }];
  for (let depth = 0; depth < MAX_STEPS; depth++) {
    const next: typeof frontier = [];
    const named: Relation[] = [];
    for (const f of frontier) {
      for (const [step, id] of neighbours(g, f.chain[f.chain.length - 1])) {
        if (f.chain.includes(id)) continue;
        const path = f.path + step;
        const chain = [...f.chain, id];
        if (id === otherId) {
          const rel = nameFor(path, chain.map((c) => g.people.get(c)!));
          if (rel) named.push(rel);
        } else {
          next.push({ path, chain });
        }
      }
    }
    if (named.length) {
      // Several paths of the same length: prefer blood over marriage
      // (a sibling is a sibling before being a spouse's in-law).
      named.sort((a, b) => countOf(a.path, 'S') - countOf(b.path, 'S'));
      return named[0];
    }
    frontier = next;
  }
  return null;
}

const countOf = (s: string, ch: string) => s.split(ch).length - 1;

/** "Mother (Maa)", "Cousin", "Grandmother (Nani)". */
export function relationLabel(rel: Relation | null): string | null {
  if (!rel || rel.path === '') return null;
  return rel.hi ? `${rel.en} (${rel.hi})` : rel.en;
}

/**
 * One line per person, as rag-search hands the family to the model before
 * it rewrites the question: "Asha Verma: your mother (Maa)". The model then
 * turns "Mummy ka passport" or "Mom's passport" into "Asha Verma passport",
 * which is what the documents actually say.
 */
export function relativesForPrompt(g: KinGraph, meId: string | null): string[] {
  const lines: string[] = [];
  for (const p of g.people.values()) {
    if (p.id === meId) {
      lines.push(`${p.name}: you`);
      continue;
    }
    const rel = meId ? relationTo(g, meId, p.id) : null;
    lines.push(rel ? `${p.name}: your ${rel.en.toLowerCase()}${rel.hi ? ` (${rel.hi})` : ''}` : p.name);
  }
  return lines;
}

// ─── Laying the tree out ────────────────────────────────────────
//
// A family is not a tree: Aarav descends from his father's parents AND his
// mother's. So the screen shows one branch at a time, each grown downwards
// from a pair of ancestors — "Ramesh & Kamala", "Suresh & Meena" — and a
// person who married in appears beside their spouse. The branch the viewer
// descends from comes first.

export interface TreeUnit {
  person: KinPerson;
  spouses: KinPerson[];
  children: TreeUnit[];
}

export interface FamilyBranch {
  key: string;
  /** "Ramesh & Kamala" — the pair (or siblings) at the top. */
  title: string;
  /** One unit, or several brothers and sisters whose parents are not in the tree. */
  roots: TreeUnit[];
}

export interface Forest {
  branches: FamilyBranch[];
  /** People with no link to anyone yet. */
  loose: KinPerson[];
  /** Index into branches of the one to show first. */
  first: number;
}

const byAge = (g: KinGraph) => (a: string, b: string) => {
  const pa = g.people.get(a)!;
  const pb = g.people.get(b)!;
  if (pa.birthDate && pb.birthDate && pa.birthDate !== pb.birthDate) return pa.birthDate < pb.birthDate ? -1 : 1;
  if (!!pa.birthDate !== !!pb.birthDate) return pa.birthDate ? -1 : 1;
  return pa.name.localeCompare(pb.name);
};

function unitFor(g: KinGraph, id: string, above: Set<string>): TreeUnit {
  const spouses = spousesOf(g, id).filter((s) => !above.has(s));
  const inUnit = new Set([...above, id, ...spouses]);
  // Children of either partner: a child linked to only one parent still belongs here.
  const kids = new Set([...childrenOf(g, id), ...spouses.flatMap((s) => childrenOf(g, s))]);
  const children = [...kids]
    .filter((k) => !inUnit.has(k))       // a malformed loop never recurses forever
    .sort(byAge(g))
    .map((k) => unitFor(g, k, inUnit));
  return {
    person: g.people.get(id)!,
    spouses: spouses.sort(byAge(g)).map((s) => g.people.get(s)!),
    children,
  };
}

function unitHas(unit: TreeUnit, id: string, blood: boolean): boolean {
  if (unit.person.id === id) return true;
  if (!blood && unit.spouses.some((s) => s.id === id)) return true;
  return unit.children.some((c) => unitHas(c, id, blood));
}

function collect(unit: TreeUnit, into: Set<string>) {
  into.add(unit.person.id);
  for (const s of unit.spouses) into.add(s.id);
  for (const c of unit.children) collect(c, into);
}

export function buildForest(g: KinGraph, meId: string | null): Forest {
  const ids = [...g.people.keys()].sort(byAge(g));
  const linked = (id: string) =>
    parentsOf(g, id).length + childrenOf(g, id).length + spousesOf(g, id).length + siblingsOf(g, id).length > 0;

  // A branch starts from someone with no parents in the tree whose spouses
  // have none either. Someone whose spouse HAS parents married into that
  // branch and is drawn there, beside them.
  const isRoot = (id: string) =>
    linked(id) && parentsOf(g, id).length === 0 && spousesOf(g, id).every((s) => parentsOf(g, s).length === 0);

  const used = new Set<string>();
  const branches: FamilyBranch[] = [];
  for (const id of ids) {
    if (used.has(id) || !isRoot(id)) continue;
    // Brothers and sisters linked to each other but with no parents recorded
    // share one branch, side by side.
    const group = [id, ...siblingsOf(g, id).filter((s) => isRoot(s) && !used.has(s))].sort(byAge(g));
    const roots: TreeUnit[] = [];
    for (const m of group) {
      if (used.has(m)) continue;
      const unit = unitFor(g, m, new Set());
      used.add(m);
      for (const s of unit.spouses) used.add(s.id);
      roots.push(unit);
    }
    const first = roots[0];
    const title = roots.length > 1
      ? `${first.person.name.split(' ')[0]} and siblings`
      : [first.person, ...first.spouses].map((p) => p.name.split(' ')[0]).join(' & ');
    branches.push({ key: roots.map((r) => r.person.id).join('+'), title, roots });
  }

  const placed = new Set<string>();
  for (const b of branches) for (const r of b.roots) collect(r, placed);
  const loose = ids.filter((id) => !placed.has(id)).map((id) => g.people.get(id)!);

  let first = 0;
  if (meId) {
    const blood = branches.findIndex((b) => b.roots.some((r) => unitHas(r, meId, true)));
    const any = branches.findIndex((b) => b.roots.some((r) => unitHas(r, meId, false)));
    first = blood >= 0 ? blood : any >= 0 ? any : 0;
  }
  return { branches, loose, first };
}
