'use server';

import { createClient } from '@/lib/supabase/server';
import { parseGrant } from '@/lib/access';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

/**
 * Give an existing account access to one entity.
 *
 * The database function checks the caller is the portal owner and that the
 * account exists; this only validates the form and routes the error back to
 * the page as text rather than a crash.
 */
export async function grantAccess(formData: FormData) {
  const entityId = String(formData.get('entity_id'));
  const slug = String(formData.get('slug'));
  let message = '';
  try {
    const g = parseGrant(formData.get('email'), formData.get('role'));
    const supabase = await createClient();
    const { error } = await supabase.rpc('grant_entity_access', {
      p_email: g.email, p_entity: entityId, p_role: g.role,
    });
    if (error) message = error.message;
  } catch (e) {
    message = (e as Error).message;
  }
  revalidatePath(`/entity/${slug}/edit`);
  redirect(`/entity/${slug}/edit${message ? `?access_error=${encodeURIComponent(message)}` : ''}#access`);
}

export async function revokeAccess(formData: FormData) {
  const slug = String(formData.get('slug'));
  const supabase = await createClient();
  const { error } = await supabase.rpc('revoke_entity_access', {
    p_user: String(formData.get('user_id')),
    p_entity: String(formData.get('entity_id')),
  });
  revalidatePath(`/entity/${slug}/edit`);
  redirect(`/entity/${slug}/edit${error ? `?access_error=${encodeURIComponent(error.message)}` : ''}#access`);
}
