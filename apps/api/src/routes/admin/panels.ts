import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { createPanelSchema, patchPanelSchema } from '@app/shared';
import { notFound, badRequest } from '../../lib/errors';
import { requiredParam } from '../../lib/params';
import { requireCapability } from '../../middleware/auth';
import { audit } from '../../middleware/audit';

export const panels = new Hono();

panels.get('/', async (c) => {
  const rows = await db.select().from(s.panelDefinitions).orderBy(asc(s.panelDefinitions.sortOrder));
  return c.json({ rows });
});

panels.post('/', requireCapability('panel.manage'), async (c) => {
  const body = createPanelSchema.parse(await c.req.json());
  try {
    const [row] = await db.insert(s.panelDefinitions).values(body).returning();
    await audit(c, {
      action: 'panel.create',
      targetType: 'panel_definition',
      after: row,
    });
    return c.json({ row }, 201);
  } catch (e: unknown) {
    if (String(e).includes('unique') || String(e).includes('duplicate')) {
      throw badRequest('Slug already exists — slugs are the contract with the add-in and cannot be reused');
    }
    throw e;
  }
});

panels.patch('/:slug', requireCapability('panel.manage'), async (c) => {
  const slug = requiredParam(c, 'slug');
  const body = patchPanelSchema.parse(await c.req.json());

  const [before] = await db.select().from(s.panelDefinitions).where(eq(s.panelDefinitions.slug, slug)).limit(1);
  if (!before) throw notFound();

  // Deactivating a never-gated panel would drop it out of the catalog the
  // licence editor offers, so the next licence saved through the UI omits it
  // and the never-gated check then fails with a slug the operator can no
  // longer see. Block it at the source instead.
  if (before.neverGated && body.isActive === false) {
    throw badRequest(
      `"${slug}" carries the sign-in and licence controls and cannot be deactivated.`,
    );
  }

  const [row] = await db.update(s.panelDefinitions)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(s.panelDefinitions.slug, slug))
    .returning();

  await audit(c, {
    action: 'panel.update',
    targetType: 'panel_definition',
    before,
    after: row,
  });
  return c.json({ row });
});
