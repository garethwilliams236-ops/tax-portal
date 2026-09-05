'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">Tax Portal</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
        Sign in with a one-time link. There is no password to lose.
      </p>

      {sent ? (
        <div className="card mt-6 text-sm">
          <p className="font-medium">Check your email.</p>
          <p className="mt-1" style={{ color: 'var(--muted)' }}>
            The link signs you in on this device and expires shortly. It does not work twice.
          </p>
        </div>
      ) : (
        <form onSubmit={send} className="mt-6 space-y-3">
          <label className="block text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Email
          </label>
          <input
            className="input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <button className="btn btn-pri w-full" disabled={busy}>
            {busy ? 'Sending…' : 'Email me a link'}
          </button>
          {err && (
            <p className="text-[13px]" style={{ color: 'var(--crit)' }}>
              {err}
            </p>
          )}
        </form>
      )}

      <p className="mt-8 text-[11.5px]" style={{ color: 'var(--muted)' }}>
        Your records are held in Postgres behind row-level security. Nothing is stored in this
        browser beyond the session cookie, which your machine cannot read from JavaScript.
      </p>
    </main>
  );
}
