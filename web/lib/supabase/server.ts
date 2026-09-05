import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };


/**
 * The server-side Supabase client.
 *
 * Everything that touches tax data goes through this. The session lives in an
 * httpOnly cookie the browser's JavaScript cannot read, and the rows never
 * enter localStorage or sessionStorage — they are fetched in a server
 * component, rendered to HTML, and forgotten. That is the whole reason this
 * app exists rather than the single-file prototype: a lost or stolen machine
 * leaves nothing behind in the browser profile.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }),
            );
          } catch {
            // Called from a server component, where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/** The signed-in user, or a redirect. Every protected page starts here. */
export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
