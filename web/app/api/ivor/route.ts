import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ask, topic } from '@/lib/ivor/answer';
import { getIvorLevel, setIvorLevel } from '@/lib/db/ivor-level';

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

  let body: { question?: string; topicId?: string; path?: string; setLevel?: string; getLevel?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  try {
    if (body.setLevel === 'plain' || body.setLevel === 'technical') {
      await setIvorLevel(user.id, body.setLevel);
      return NextResponse.json({ level: body.setLevel });
    }
    const level = await getIvorLevel(user.id);
    if (body.getLevel) return NextResponse.json({ level });

    if (body.topicId) return NextResponse.json(await topic(String(body.topicId), level));

    const question = String(body.question ?? '').slice(0, 500);
    // The path the user is on, so "this period" and "this company" mean
    // something. Capped, and parsed rather than trusted.
    const path = body.path ? String(body.path).slice(0, 300) : null;
    return NextResponse.json(await ask(question, path, level));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
