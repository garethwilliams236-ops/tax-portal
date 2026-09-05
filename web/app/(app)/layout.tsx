import Link from 'next/link';
import { requireUser } from '@/lib/supabase/server';
import { getEntities } from '@/lib/db/queries';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!user) redirect('/login');
  const entities = await getEntities();

  return (
    <div className="mx-auto max-w-[1800px] px-[18px] pb-[70px]">
      <header className="pt-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[19px] font-semibold tracking-tight">Tax Portal</h1>
          <span className="text-[13px]" style={{ color: 'var(--muted)' }}>
            as at {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <span className="flex-1" />
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>{user.email}</span>
          <form action="/auth/signout" method="post">
            <button className="btn text-[12px]">Sign out</button>
          </form>
        </div>

        <nav className="mt-4 flex gap-0.5 overflow-x-auto border-b" style={{ borderColor: 'var(--line)' }}>
          <Link href="/" className="whitespace-nowrap rounded-t-md px-3.5 py-2 text-sm font-medium">
            Overview
          </Link>
          {entities.map((e) => (
            <Link
              key={e.id}
              href={`/entity/${e.slug}`}
              className="whitespace-nowrap rounded-t-md px-3.5 py-2 text-sm font-medium"
              style={{ color: 'var(--muted)' }}
            >
              {e.name}
            </Link>
          ))}
          <Link href="/entity/new" className="whitespace-nowrap px-3.5 py-2 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
            + Add entity
          </Link>
        </nav>
      </header>

      <main className="pt-6">{children}</main>
    </div>
  );
}
