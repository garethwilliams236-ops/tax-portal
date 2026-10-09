import { createClient } from '@/lib/supabase/server';
import type { AccessGrant } from '@/lib/access';

/** True for the account that owns the portal (the first one, per migration 0004). */
export async function isAppOwner(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('is_app_owner');
  if (error) throw new Error(`is_app_owner: ${error.message}`);
  return data === true;
}

/** Everyone who can see an entity. Empty for anyone but the owner, by design of the function. */
export async function getAccess(entityId: string): Promise<AccessGrant[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_entity_access', { p_entity: entityId });
  if (error) throw new Error(`list_entity_access: ${error.message}`);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((r: any): AccessGrant => ({
    userId: r.user_id,
    email: r.email,
    role: r.role,
    isYou: r.is_you,
  }));
}
