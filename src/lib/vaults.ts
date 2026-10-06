// Vaults (046): a person's personal vault — a family of one, for them alone,
// that nobody else can be invited to or join — and the families they are in.
// All of them are rows in `families`, and `is_personal` says which is which.
// Every screen names them through here, so the personal vault is called
// "Personal vault" everywhere, whatever its row is named.

import type { Database, FamilyWithMembership } from './database.types';

type FamilyRow = Database['public']['Tables']['families']['Row'];

export const PERSONAL_VAULT_NAME = 'Personal vault';

export function isPersonalVault(family: Pick<FamilyRow, 'is_personal'> | null | undefined): boolean {
  return family?.is_personal === true;
}

/** "Personal vault", or the family's own name. */
export function vaultName(family: Pick<FamilyRow, 'is_personal' | 'name'> | null | undefined): string {
  if (!family) return 'Family';
  return isPersonalVault(family) ? PERSONAL_VAULT_NAME : family.name;
}

/** The person's personal vault, and the families they share with others, oldest membership first. */
export function splitVaults(vaults: FamilyWithMembership[]): {
  personal: FamilyWithMembership | null;
  families: FamilyWithMembership[];
} {
  return {
    personal: vaults.find((v) => isPersonalVault(v.families)) ?? null,
    families: vaults.filter((v) => !isPersonalVault(v.families)),
  };
}

/** Who sees what is in it, for the line under a vault's name. */
export function vaultSubtitle(v: FamilyWithMembership): string {
  if (isPersonalVault(v.families)) return 'Only you can see it';
  return v.role === 'admin' ? 'Family · you are an admin' : 'Family';
}
