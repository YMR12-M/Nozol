import { z } from 'zod';
import { idSchema, isoDate } from '../../utils/schemas.js';

const occupancy = {
  adults: z.coerce.number().int().min(1).max(30).default(2),
  children: z.coerce.number().int().min(0).max(20).default(0),
};

export const searchQuery = z.object({
  check_in: isoDate,
  check_out: isoDate,
  ...occupancy,
  rate_plan_id: idSchema.optional(),
  promo_code: z.string().trim().max(30).optional(),
});

export const calendarQuery = z.object({ from: isoDate, to: isoDate })
  .refine((q) => q.to >= q.from, { message: 'النهاية قبل البداية', path: ['to'] });

export const quoteBody = z.object({
  unit_type_id: idSchema,
  rate_plan_id: idSchema.nullish(),
  check_in: isoDate,
  check_out: isoDate,
  adults: z.number().int().min(1).max(30).default(2),
  children: z.number().int().min(0).max(20).default(0),
  units: z.number().int().min(1).max(20).default(1),
  promo_code: z.string().trim().max(30).optional(),
  /** للموظف فقط: تسعير تواريخ ماضية (تسجيل إقامة بأثر رجعي) */
  allow_past: z.boolean().optional(),
});

export const availableUnitsQuery = z.object({
  unit_type_id: idSchema,
  check_in: isoDate,
  check_out: isoDate,
  /** عند تعديل حجز: ليالي هذا الحجز تُحتسَب فارغة */
  exclude_reservation_id: idSchema.optional(),
});
