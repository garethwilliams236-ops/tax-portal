'use client';

// Password sign-in, not a magic link.
//
// The link flow needs a mail sender that actually delivers: Supabase's built-in
// mailer is rate-limited to a handful of messages an hour, and custom SMTP
// requires a verified sending domain. Neither is worth a DNS project for a
// portal with one user. A password removes the dependency entirely.
//
// Nothing about the security posture changes. Supabase still issues the
// session, @supabase/ssr still writes it to an httpOnly cookie the page's own
// JavaScript cannot read, and row-level security is still what decides which
// rows this account can see.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      setErr(error.message);
      return;
    }
    // The session cookie is set by the time this resolves. refresh() re-runs the
    // server components with it, so the middleware sees an authenticated request.
    router.replace('/');
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">Tax Portal</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
        Sign in to continue.
      </p>

      <form onSubmit={signIn} className="mt-6 space-y-3">
        <label
          className="block text-[12px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--muted)' }}
        >
          Email
        </label>
        <input
          className="input"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />

        <label
          className="block text-[12px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--muted)' }}
        >
          Password
        </label>
        <input
          className="input"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button className="btn btn-pri w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {err && (
          <p className="text-[13px]" style={{ color: 'var(--crit)' }}>
            {err}
          </p>
        )}
      </form>

      <p className="mt-8 text-[11.5px]" style={{ color: 'var(--muted)' }}>
        Your records are held in Postgres behind row-level security. Nothing is stored in this
        browser beyond the session cookie, which this page&rsquo;s JavaScript cannot read.
      </p>
    </main>
  );
}
