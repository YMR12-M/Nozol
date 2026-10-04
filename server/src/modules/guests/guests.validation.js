import { z } from 'zod';
import { emailSchema, isoDate, optionalText, pagingSchema, phoneSchema } from '../../utils/schemas.js';

const optionalPhone = z.union([phoneSchema, z.literal('').transform(() => null), z.null()]);
const optionalEmail = z.union([emailSchema, z.literal('').transform(() => null), z.null()]);

const base = z.object({
  full_name: z.string().trim().min(2).max(150),
  phone: optionalPhone,
  email: optionalEmail,
  nationality: optionalText(60),
  id_type: z.enum(['national_id', 'passport', 'other']).nullable(),
  id_number: z.string().trim().max(40).transform((value) => (value === '' ? null : value)).nullable(),
  birth_date: isoDate.nullable(),
  address: optionalText(255),
  notes: optionalText(1000),
  is_vip: z.boolean(),
  is_blacklisted: z.boolean(),
});

export const GUEST_FIELDS = Object.keys(base.shape);

export const createGuestSchema = base.partial().required({ full_name: true });
export const updateGuestSchema = base.partial();

/** بيانات النزيل داخل طلب الحجز (بدون علامات VIP/القائمة السوداء) */
export const inlineGuestSchema = base.omit({ is_vip: true, is_blacklisted: true }).partial().required({ full_name: true });

export const listGuestsQuery = pagingSchema.extend({
  q: z.string().trim().max(80).optional(),
  vip: z.enum(['true', 'false']).optional(),
  blacklisted: z.enum(['true', 'false']).optional(),
});
