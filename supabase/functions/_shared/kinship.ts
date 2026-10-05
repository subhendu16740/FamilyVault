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
// "Nani's pension papers" is a question a family actually asks — so Ask
// understands them. The screens show only the English relation, and the
// family's own nickname for the person (045), never a Hindi word on its own:
// a family that says "Mummy" should not be told it says "Maa".
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
  /** The family's own name for them ("Pinky", "Bablu"), the same for everyone (045). */
  nickname?: string | null;
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

/**
 * Everyone reached through sibling links alone, from `id` (not including it):
 * three children linked pairwise, with no parents recorded, are one set.
 */
export function linkedSiblingsOf(g: KinGraph, id: string): string[] {
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    for (const s of setOf(g.siblingLinks, queue.shift()!)) {
      if (!seen.has(s)) { seen.add(s); queue.push(s); }
    }
  }
  seen.delete(id);
  return [...seen];
}

/**
 * When `childId` gets a parent: the brothers and sisters, by sibling link, who
 * get that parent too — the ones whose recorded parents are some of the
 * child's (usually none) — with the child's other parents they were missing.
 * Added as "Subhendu's sister" before anyone added Papa, she gets Papa and
 * Maa when Maa is added. A half-brother with a different parent recorded is
 * left alone.
 */
export function siblingsSharingParents(g: KinGraph, childId: string): Array<{ id: string; missing: string[] }> {
  const mine = parentsOf(g, childId);
  return linkedSiblingsOf(g, childId).flatMap((s) => {
    const theirs = parentsOf(g, s);
    if (!theirs.every((p) => mine.includes(p))) return [];
    return [{ id: s, missing: mine.filter((p) => !theirs.includes(p)) }];
  });
}

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

/** "Mother", "Cousin", "Grandmother" — what the screens show beside a name, with the nickname. */
export function relationLabel(rel: Relation | null): string | null {
  if (!rel || rel.path === '') return null;
  return rel.en;
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
    const name = p.nickname ? `${p.name} (called "${p.nickname}")` : p.name;
    lines.push(rel ? `${name}: your ${rel.en.toLowerCase()}${rel.hi ? ` (${rel.hi})` : ''}` : name);
  }
  return lines;
}

// ─── Relations named in a question ──────────────────────────────
//
// "Nani's pension papers", "my mother's passport", "Papa ka PAN", "नानी की
// पेंशन". The documents say "Meena Rao", never "Nani", so rag-search adds the
// names to the question before it searches. Worked out here, from the
// asker's place in the tree, with no model call: it costs nothing, runs on
// every question, and cannot be talked into anything.

export interface NamedRelative {
  personId: string;
  name: string;
  /** The word in the question that named them: "nani", "mother", "pinky". */
  term: string;
  /** "Grandmother"; "family member" for someone named by nickname with no relation to the asker. */
  label: string;
}

// Everyday words for a relation beyond its English label and Hindi term.
// Left out on purpose: "ma" (also an MA degree), "pa", "baba" (a father in
// Bengali, a grandfather or a holy man in Hindi), and "mama", which is a
// mother in English but a mother's brother in Hindi. The Hindi Mama comes
// from the tree, which knows which one it is.
const EVERYDAY: Record<string, string[]> = {
  mother: ['mom', 'mum', 'mummy', 'mommy', 'mumma', 'amma', 'ammi', 'mata', 'mataji', 'maa'],
  father: ['dad', 'daddy', 'papa', 'pitaji', 'pita', 'abba', 'appa'],
  grandmother: ['grandma', 'granny', 'grandmom'],
  grandfather: ['grandpa', 'granddad', 'grandad'],
  wife: ['biwi', 'patni'],
  husband: ['pati'],
  daughter: ['beti'],
  son: ['beta'],
  sister: ['sis', 'didi', 'behen', 'bahen'],
  brother: ['bro', 'bhai', 'bhaiya'],
  aunt: ['aunty', 'auntie'],
};

// A relation whose gender is not recorded answers to either word: with no
// gender set, "my mother" can only mean one of the parents.
const EITHER: Record<string, string[]> = {
  parent: ['mother', 'father'],
  grandparent: ['grandmother', 'grandfather'],
  'great-grandparent': ['great-grandmother', 'great-grandfather'],
  spouse: ['wife', 'husband'],
  child: ['daughter', 'son'],
  sibling: ['sister', 'brother'],
  grandchild: ['granddaughter', 'grandson'],
  "parent's sibling": ['aunt', 'uncle'],
  "parent's sibling's spouse": ['aunt', 'uncle'],
  "sibling's child": ['niece', 'nephew'],
  'parent-in-law': ['mother-in-law', 'father-in-law'],
  'child-in-law': ['daughter-in-law', 'son-in-law'],
  'sibling-in-law': ['sister-in-law', 'brother-in-law'],
};

// The Hindi terms as they are written in Devanagari, for questions asked in
// Hindi by voice or keyboard.
const DEVANAGARI: Record<string, string[]> = {
  maa: ['माँ', 'मां', 'मम्मी', 'माता'], papa: ['पापा', 'पिताजी', 'पिता'],
  nani: ['नानी'], nana: ['नाना'], dadi: ['दादी'], dada: ['दादा'],
  pardadi: ['परदादी'], pardada: ['परदादा'], parnani: ['परनानी'], parnana: ['परनाना'],
  bua: ['बुआ'], phupha: ['फूफा'], mama: ['मामा'], mami: ['मामी'], mausi: ['मौसी'], mausa: ['मौसा'],
  chacha: ['चाचा'], chachi: ['चाची'], tau: ['ताऊ'], tai: ['ताई'],
  bhaiya: ['भैया'], bhai: ['भाई'], didi: ['दीदी'], behen: ['बहन'],
  beta: ['बेटा'], beti: ['बेटी'], pati: ['पति'], patni: ['पत्नी'],
  saas: ['सास'], sasur: ['ससुर'], bahu: ['बहू'], damad: ['दामाद'],
  bhabhi: ['भाभी'], jija: ['जीजा'], devar: ['देवर'], jeth: ['जेठ'], nanad: ['ननद'], saala: ['साला'], saali: ['साली'],
  pota: ['पोता'], poti: ['पोती'], nati: ['नाती'], natin: ['नातिन'],
  bhatija: ['भतीजा'], bhatiji: ['भतीजी'], bhanja: ['भांजा', 'भानजा'], bhanji: ['भांजी', 'भानजी'],
  samdhi: ['समधी'], samdhan: ['समधन'],
};

/** Words, in any script, with their combining marks: a Devanagari vowel sign is \p{M}. */
const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

function termsFor(rel: Relation): string[] {
  const en = rel.en.toLowerCase();
  const english = EITHER[en] ?? [en];
  const terms = new Set<string>();
  for (const word of english) {
    terms.add(word);
    for (const extra of EVERYDAY[word] ?? []) terms.add(extra);
  }
  if (rel.hi) {
    const hi = rel.hi.toLowerCase();
    terms.add(hi);
    terms.add(`${hi}ji`);                               // Nanaji, Buaji, Mausiji
    if (rel.path === 'PP') { terms.add(`${hi}ma`); terms.add(`${hi}maa`); }   // Nanima, Dadima
    for (const d of DEVANAGARI[hi] ?? []) terms.add(d);
  }
  return [...terms];
}

/**
 * The people a question names by relation, seen from `meId` — or by the
 * family's nickname for them ("Pinky's passport"). Longer terms win
 * ("mother-in-law" is not also "mother"), and a term that fits several people
 * ("grandmother", with both alive) names them all: the answer model, told who
 * each one is, sorts out which was meant. A nickname of one or two letters
 * names nobody: too easily an ordinary word.
 */
export function relativesNamedIn(g: KinGraph, meId: string | null, ...texts: string[]): NamedRelative[] {
  if (!meId || !g.people.has(meId)) return [];
  let text = ` ${texts.flatMap(wordsOf).join(' ')} `;
  if (!text.trim()) return [];

  const byTerm = new Map<string, Array<{ person: KinPerson; rel: Relation | null }>>();
  const addTerm = (term: string, person: KinPerson, rel: Relation | null) => {
    const key = wordsOf(term).join(' ');
    if (!key) return;
    if (!byTerm.has(key)) byTerm.set(key, []);
    byTerm.get(key)!.push({ person, rel });
  };
  for (const person of g.people.values()) {
    if (person.id === meId) continue;
    const rel = relationTo(g, meId, person.id);
    if (rel) for (const term of termsFor(rel)) addTerm(term, person, rel);
    const nickname = person.nickname?.trim();
    if (nickname && wordsOf(nickname).join('').length >= 3) addTerm(nickname, person, rel);
  }

  const found = new Map<string, NamedRelative>();
  const longestFirst = [...byTerm.keys()].sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length);
  for (const term of longestFirst) {
    const padded = ` ${term} `;
    if (!text.includes(padded)) continue;
    for (const { person, rel } of byTerm.get(term)!) {
      if (!found.has(person.id)) {
        found.set(person.id, { personId: person.id, name: person.name, term, label: rel ? relationLabel(rel) ?? rel.en : 'family member' });
      }
    }
    text = text.split(padded).join(' · ');            // a shorter term cannot match inside it
  }
  return [...found.values()];
}

// ─── Laying the tree out ────────────────────────────────────────
//
// A family is not a tree: Aarav descends from his father's parents AND his
// mother's. So the tree is drawn as branches, each grown downwards from a pair
// of ancestors — "Ramesh & Kamala", "Suresh & Meena" — and a person who
// married in appears beside their spouse. The screen draws every branch, one
// below the other, eldest ancestors first: the same picture for everyone,
// with only the viewer's own card highlighted. `first` says which branch the
// viewer descends from.

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

/**
 * The name a branch's title shows: the first name, unless that is only an
 * initial ("K C Das Mohapatra") or a title (Dr, Shri), which say nothing
 * on their own.
 */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && /^(dr|mr|mrs|ms|shri|smt|sri|late)\.?$/i.test(words[0])) words.shift();
  const first = words[0] ?? name.trim();
  return first.replace(/\./g, '').length > 1 ? first : words.join(' ');
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
  // So does a brother or sister of theirs known only by a sibling link, with no
  // parents of their own: added as "Subhendu's sister" before anyone added
  // Papa, she is still Papa's child as far as anyone can tell.
  for (const k of [...kids]) {
    for (const s of linkedSiblingsOf(g, k)) if (parentsOf(g, s).length === 0) kids.add(s);
  }
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
  // Nor does someone whose sibling-linked brother or sister has parents: they
  // are drawn beside that sibling, under those parents (see unitFor).
  const isRoot = (id: string) =>
    linked(id) && parentsOf(g, id).length === 0 && spousesOf(g, id).every((s) => parentsOf(g, s).length === 0)
    && linkedSiblingsOf(g, id).every((s) => parentsOf(g, s).length === 0);

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
      ? `${shortName(first.person.name)} and siblings`
      : [first.person, ...first.spouses].map((p) => shortName(p.name)).join(' & ');
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
