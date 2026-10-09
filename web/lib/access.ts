/**
 * Who may do what, beyond row-level security.
 *
 * RLS already decides what a user can READ: a second user granted one
 * individual sees that individual and nothing else, with no code here. What is
 * left is the handful of things that are not tied to an entity she holds —
 * adding an entity, archiving one, managing who can see what. Migration 0009
 * enforces each of those in the database; this module only decides what to
 * SHOW, so she is not offered a button that would fail.
 */

export type AccessRole = 'owner' | 'viewer';

export interface AccessGrant {
  userId: string;
  email: string;
  role: AccessRole;
  isYou: boolean;
}

export interface GrantInput {
  email: string;
  role: AccessRole;
}

/** Validate a grant typed into the Details tab. Throws with a message fit to show. */
export function parseGrant(email: unknown, role: unknown): GrantInput {
  const e = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('Enter a valid email address');
  const r = String(role ?? '');
  if (r !== 'owner' && r !== 'viewer') throw new Error('Choose edit or view only');
  return { email: e, role: r };
}

/** Plain-words label for a role, as the Details tab shows it. */
export const roleLabel = (r: AccessRole) => (r === 'owner' ? 'Can edit' : 'View only');
