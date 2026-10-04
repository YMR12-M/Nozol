import { z } from 'zod';
import { idSchema, isoDate, optionalText } from '../../utils/schemas.js';

const TYPES = ['checkout_clean', 'stayover_clean', 'inspection', 'deep_clean', 'turndown', 'other'];
const STATUSES = ['pending', 'in_progress', 'done', 'verified', 'skipped'];

const flag = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1');

export const listTasksQuery = z.object({
  date: isoDate.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(STATUSES).optional(),
  unit_id: idSchema.optional(),
  assigned_to: idSchema.optional(),
  mine: flag.optional(),
  open: flag.optional(),
});

export const createTaskSchema = z.object({
  unit_id: idSchema,
  type: z.enum(TYPES).default('other'),
  priority: z.enum(['normal', 'high', 'urgent']).default('normal'),
  due_date: isoDate.optional(),
  assigned_to: idSchema.nullish(),
  note: optionalText(500),
});

export const updateTaskSchema = z.object({
  priority: z.enum(['normal', 'high', 'urgent']),
  due_date: isoDate,
  assigned_to: idSchema.nullable(),
  note: optionalText(500),
}).partial();

export const completeTaskSchema = z.object({ note: optionalText(500) });

export const generateSchema = z.object({ date: isoDate.optional() });
