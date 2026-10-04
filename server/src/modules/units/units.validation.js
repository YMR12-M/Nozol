import { z } from 'zod';
import { idSchema, isoDate, optionalText } from '../../utils/schemas.js';

const code = z.string().trim().min(1).max(30);

const base = z.object({
  unit_type_id: idSchema,
  code,
  floor: optionalText(20),
  notes: optionalText(500),
  status: z.enum(['active', 'out_of_order']),
  sort_order: z.number().int().min(-1000).max(100_000),
});

export const createUnitSchema = base.partial().required({ unit_type_id: true, code: true });
export const updateUnitSchema = base.partial();

/**
 * إضافة جماعية: قائمة أكواد صريحة، أو مدى (غرف 101 إلى 120).
 * المدى يحفظ كتابة 20 غرفة واحدة واحدة عند إعداد المنشأة.
 */
export const bulkCreateSchema = z.object({
  unit_type_id: idSchema,
  floor: optionalText(20),
  codes: z.array(code).min(1).max(300).optional(),
  range: z.object({
    prefix: z.string().trim().max(10).default(''),
    from: z.number().int().min(0).max(100_000),
    to: z.number().int().min(0).max(100_000),
    pad: z.number().int().min(0).max(6).default(0),
  }).refine((r) => r.to >= r.from, 'نهاية المدى قبل بدايته')
    .refine((r) => r.to - r.from < 300, 'الحدّ الأقصى 300 وحدة في المرّة')
    .optional(),
}).refine((value) => Boolean(value.codes) !== Boolean(value.range), 'حدّد codes أو range (واحد منهما فقط)');

export const listUnitsQuery = z.object({
  unit_type_id: idSchema.optional(),
  status: z.enum(['active', 'out_of_order', 'archived']).optional(),
  housekeeping_status: z.enum(['dirty', 'cleaning', 'clean', 'inspected']).optional(),
  q: z.string().trim().max(40).optional(),
});

export const housekeepingStatusSchema = z.object({
  status: z.enum(['dirty', 'cleaning', 'clean', 'inspected']),
});

export const blockSchema = z.object({
  start_date: isoDate,
  end_date: isoDate,
  reason: z.enum(['maintenance', 'owner_use', 'other']).default('other'),
  note: optionalText(255),
}).refine((b) => b.end_date > b.start_date, { message: 'تاريخ النهاية لازم يكون بعد البداية', path: ['end_date'] });
