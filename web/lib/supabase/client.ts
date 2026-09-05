import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser client — used ONLY for the sign-in form and sign-out. No tax data is
 * ever read through it. Session storage is the cookie set by the server, not
 * localStorage.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
