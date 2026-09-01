/**
 * Request schemas for endpoints that exist only in this service.
 *
 * Everything the admin UI also models lives in `@app/shared` and is imported,
 * not redefined. What is left here is API-local wire format — the CSV import
 * envelope and the telemetry batch — plus one body reader.
 */

import { z } from 'zod';
import { deviceInfoSchema, roleKey } from '@app/shared';

export const telemetrySchema = z.object({
  device: deviceInfoSchema,
  /** Wall-clock minutes the add-in was in use since the last batch. */
  activeMinutes: z.number().int().min(0).max(1440).default(0),
  commands: z.array(z.object({
    commandId: z.string().min(1).max(120),
    invocations: z.number().int().min(1).max(100_000),
  })).max(200).default([]),
  /** Client-side date, so a batch buffered overnight lands on the right day. */
  usageDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type TelemetryBatch = z.infer<typeof telemetrySchema>;

/* ---------------------------------------------------------------- CSV import
 *
 * Not in `@app/shared`: the admin UI parses CSV client-side and drives the
 * ordinary create/update routes, so these shapes have exactly one consumer.
 */

export const importPreviewSchema = z.object({
  orgId: z.string().uuid(),
  csv: z.string().min(1).max(2_000_000),
});

export const importActionSchema = z.enum(['create', 'update', 'unchanged', 'conflict', 'invalid']);
export type ImportAction = z.infer<typeof importActionSchema>;

export const importPlanRowSchema = z.object({
  line: z.number().int().min(1),
  action: importActionSchema,
  email: z.string().max(200),
  displayName: z.string().max(120).nullable().optional(),
  roleKey: roleKey.optional(),
  existingUserId: z.string().uuid().nullable().optional(),
  message: z.string().max(300).optional(),
});
export type ImportPlanRow = z.infer<typeof importPlanRowSchema>;

export const importCommitSchema = z.object({
  orgId: z.string().uuid(),
  /** Integrity token from the preview response. Guards a hand-edited plan. */
  token: z.string().min(32).max(200),
  rows: z.array(importPlanRowSchema).max(5000),
});
