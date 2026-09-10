import { notFound } from 'next/navigation';
import { getEntities, getEntityBySlug } from '@/lib/db/queries';
import { buildNudges } from '@/lib/db/nudges';
import { getTasks, merge, live, settled, orphaned } from '@/lib/db/tasks';
import { ToDo } from '../../../todo';
import { EntityHeader } from '../nav';

export const dynamic = 'force-dynamic';

/**
 * One entity's to-do list, in full.
 *
 * The rules are evaluated across every entity — a nudge like the Employment
 * Allowance is only meaningful against the whole picture — and the result is
 * filtered here. Filtering at the end rather than the start means a rule can
 * always see everything it needs to.
 *
 * A to-do filed against no entity in particular stays on the overview and does
 * not appear here, because it is not this entity's.
 */
export default async function EntityToDoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const asAt = new Date();

  const entity = await getEntityBySlug(slug);
  if (!entity) notFound();

  const [{ nudges, backlog }, tasks, entities] = await Promise.all([
    buildNudges(asAt), getTasks(), getEntities(),
  ]);

  const mine = merge(nudges, tasks).filter((i) => i.entityId === entity.id);

  return (
    <>
      <EntityHeader entity={entity} active="todo" />

      <div className="mt-6">
        <ToDo
          live={live(mine, asAt)}
          settled={settled(mine, asAt)}
          orphans={orphaned(nudges, tasks).filter((t) => t.entityId === entity.id)}
          backlog={backlog.filter((b) => b.entityId === entity.id)}
          entities={entities.filter((e) => e.id === entity.id)}
          defaultEntityId={entity.id}
          back={`/entity/${slug}/todo`}
          asAt={asAt}
        />
      </div>
    </>
  );
}
