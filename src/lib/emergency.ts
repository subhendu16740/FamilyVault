// The emergency card (migration 032): what a doctor, a neighbour or a
// relative needs in the first minutes — blood group, allergies, conditions,
// medicines, the family doctor, the health insurance policy, people to call.
//
// Pure helpers shared by the person page, the full-screen card, the editor
// and the list. The queries live in api.ts. The checks here mirror
// save_emergency_card() so the form can say what is wrong before saving;
// the database checks again either way.

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'hh'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export interface EmergencyContact {
  name: string;
  relation: string | null;
  phone: string;
}

/** What a person types into the card. Blank text is cleared when saved. */
export interface EmergencyCardInput {
  bloodGroup: BloodGroup | null;
  allergies: string | null;
  conditions: string | null;
  medicines: string | null;
  doctorName: string | null;
  doctorPhone: string | null;
  insurer: string | null;
  policyNumber: string | null;
  contacts: EmergencyContact[];
  notes: string | null;
}

export interface EmergencyCard extends EmergencyCardInput {
  personId: string;
  /** The account that saved it last. */
  updatedBy: string | null;
  updatedAt: string;
}

/** At most this many people to call, as the database allows. */
export const MAX_CONTACTS = 3;

/** Character limits, as the database enforces them. */
export const LIMITS = {
  allergies: 500,
  conditions: 500,
  medicines: 1000,
  doctorName: 80,
  insurer: 80,
  policyNumber: 40,
  notes: 1000,
  contactName: 80,
  contactRelation: 40,
} as const;

export function isBloodGroup(value: unknown): value is BloodGroup {
  return typeof value === 'string' && (BLOOD_GROUPS as readonly string[]).includes(value);
}

/** "A−" with a real minus sign; hh is the Bombay blood group. */
export function bloodGroupLabel(group: BloodGroup | null): string {
  if (!group) return 'Not known';
  if (group === 'hh') return 'Bombay (hh)';
  return group.replace('-', '−');
}

/** What a screen reader says: "A negative", not "A minus". */
export function bloodGroupSpoken(group: BloodGroup | null): string {
  if (!group) return 'Blood group not known';
  if (group === 'hh') return 'Bombay blood group';
  const sign = group.endsWith('+') ? 'positive' : 'negative';
  return `${group.slice(0, -1)} ${sign}`;
}

/** Digits and a leading + only: what a phone's dialler wants. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/**
 * Same rule as save_emergency_card(): digits, spaces, brackets, dashes and
 * a leading +, with 3 to 15 digits in all. "112", "+91 98765 43210" and
 * "(011) 2345-6789" all pass.
 */
export function phoneLooksRight(phone: string): boolean {
  const p = phone.trim();
  const digits = p.replace(/\D/g, '').length;
  return /^\+?[0-9(][0-9 ()-]{2,19}$/.test(p) && digits >= 3 && digits <= 15;
}

const blank = (s: string | null | undefined) => !s || !s.trim();

/** Nothing on the card: saving it deletes the card. */
export function cardIsEmpty(card: EmergencyCardInput): boolean {
  return !card.bloodGroup
    && [card.allergies, card.conditions, card.medicines, card.doctorName, card.doctorPhone,
      card.insurer, card.policyNumber, card.notes].every(blank)
    && card.contacts.every((c) => blank(c.name) && blank(c.phone) && blank(c.relation));
}

/**
 * What is wrong with a card before it is sent, in the words the database
 * would use, or null when it can be saved.
 */
export function cardProblem(card: EmergencyCardInput): string | null {
  if (card.doctorPhone && !blank(card.doctorPhone) && !phoneLooksRight(card.doctorPhone)) {
    return "The doctor's phone number doesn't look right. Use digits, like +91 98765 43210.";
  }
  const filled = card.contacts.filter((c) => !(blank(c.name) && blank(c.phone) && blank(c.relation)));
  if (filled.length > MAX_CONTACTS) return 'Add at most three people to call.';
  for (const c of filled) {
    if (blank(c.name) || blank(c.phone)) return 'Each person to call needs a name and a phone number.';
    if (!phoneLooksRight(c.phone)) {
      return `${c.name.trim()}'s phone number doesn't look right. Use digits, like +91 98765 43210.`;
    }
  }
  return null;
}

/** An empty card to start the editor from. */
export function emptyCard(): EmergencyCardInput {
  return {
    bloodGroup: null, allergies: null, conditions: null, medicines: null,
    doctorName: null, doctorPhone: null, insurer: null, policyNumber: null,
    contacts: [], notes: null,
  };
}
