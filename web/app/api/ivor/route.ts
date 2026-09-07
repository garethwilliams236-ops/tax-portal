import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ask, topic } from '@/lib/ivor/answer';

export const dynamic = 'force-dynamic';

/**
 * Ivor's endpoint.
 *
 * The model call happens HERE, on the server. No API key reaches the browser,
 * and the live position Ivor reasons over is read under row-level security as
 * the signed-in user — so an unauthenticated request gets nothing, not even
 * the shape of the data.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  let body: { question?: string; topicId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  try {
    if (body.topicId) return NextResponse.json(await topic(String(body.topicId)));

    const question = String(body.question ?? '').slice(0, 500);
    return NextResponse.json(await ask(question));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
