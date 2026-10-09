import { describe, expect, it } from 'vitest';
import { parseGrant, roleLabel } from '@/lib/access';

describe('parseGrant', () => {
  it('normalises the email and keeps the role', () => {
    expect(parseGrant('  Her@Example.COM ', 'owner')).toEqual({ email: 'her@example.com', role: 'owner' });
    expect(parseGrant('her@example.com', 'viewer').role).toBe('viewer');
  });
  it('refuses an address that is not one', () => {
    expect(() => parseGrant('her', 'owner')).toThrow(/valid email/);
    expect(() => parseGrant('', 'owner')).toThrow(/valid email/);
  });
  it('refuses a role the database would refuse', () => {
    expect(() => parseGrant('her@example.com', 'admin')).toThrow(/edit or view/);
    expect(() => parseGrant('her@example.com', undefined)).toThrow(/edit or view/);
  });
  it('labels roles in plain words', () => {
    expect(roleLabel('owner')).toBe('Can edit');
    expect(roleLabel('viewer')).toBe('View only');
  });
});
