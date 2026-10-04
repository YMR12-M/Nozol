import { z } from 'zod';
import {
  idSchema, isoDate, minorAmount, optionalText, pagingSchema, timeOfDay,
} from '../../utils/schemas.js';
import { inlineGuestSchema } from '../guests/guests.validation.js';
import { PAYMENT_METHODS } from '../billing/billing.validation.js';

const SOURCES = ['direct', 'phone', 'walk_in', 'booking_com', 'airbnb', 'other'];

const roomLine = z.object({
  unit_type_id: idSchema,
  /** اختيار غرفة بعينها؛ وإلا يُختار أنسبها تلقائيًا */
  unit_id: idSchema.optional(),
  adults: z.number().int().min(1).max(30).optional(),
  children: z.number().int().min(0).max(20).optional(),
  rate_plan_id: idSchema.nullish(),
});

const overrides = z.object({
  /** تجاوز قيود التسعير (حدّ أدنى للإقامة، إغلاق وصول...) — للمدير والمالك */
  restrictions: z.boolean().optional(),
  /** حجز نزيل في القائمة السوداء */
  blacklist: z.boolean().optional(),
  /** تواريخ ماضية (تسجيل إقامة بأثر رجعي) */
  past: z.boolean().optional(),
});

export const createReservationSchema = z.object({
  guest: z.union([z.object({ id: idSchema }), inlineGuestSchema]),
  check_in: isoDate,
  check_out: isoDate,
  adults: z.number().int().min(1).max(30).default(2),
  children: z.number().int().min(0).max(20).default(0),
  rooms: z.array(roomLine).min(1).max(20),
  rate_plan_id: idSchema.nullish(),
  promo_code: z.string().trim().max(30).optional(),
  status: z.enum(['confirmed', 'pending']).default('confirmed'),
  source: z.enum(SOURCES).default('direct'),
  external_ref: optionalText(80),
  guest_notes: optionalText(1000),
  internal_notes: optionalText(5000),
  expected_arrival: timeOfDay.nullish(),
  /** دفعة مقدّمة تُسجَّل مع الحجز */
  deposit: z.object({
    method: z.enum(PAYMENT_METHODS),
    amount_minor: minorAmount.refine((value) => value > 0, 'المبلغ لازم يكون أكبر من صفر'),
    reference: optionalText(120),
  }).optional(),
  send_confirmation: z.boolean().default(true),
  override: overrides.optional(),
});

/** معاينة سعر حجز كامل قبل إنشائه: نفس حقول الإقامة والغرف والكود، بلا نزيل ولا دفعات */
export const quoteReservationSchema = createReservationSchema.pick({
  check_in: true, check_out: true, adults: true, children: true, rooms: true, rate_plan_id: true, promo_code: true,
});

export const updateReservationSchema = z.object({
  guest_notes: optionalText(1000),
  internal_notes: optionalText(5000),
  expected_arrival: timeOfDay.nullable(),
  external_ref: optionalText(80),
  source: z.enum(SOURCES),
}).partial();

export const confirmSchema = z.object({ send_confirmation: z.boolean().default(true) });

export const checkInSchema = z.object({
  /** وصول قبل الموعد: يُنقَل تاريخ الوصول إلى اليوم (وتُسعَّر الليالي الزائدة) */
  early: z.boolean().default(false),
  /** الدخول رغم أن الغرفة لم تُنظَّف بعد */
  force_dirty: z.boolean().default(false),
});

export const checkOutSchema = z.object({
  /** خروج مبكّر: تُحرَّر الليالي المتبقية للبيع */
  early_departure: z.boolean().default(false),
  /** مغادرة برصيد غير مسدّد — للمدير والمالك */
  allow_unpaid: z.boolean().default(false),
  note: optionalText(255),
});

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, 'اكتب سبب الإلغاء').max(255),
  fee_minor: minorAmount.default(0),
  notify: z.boolean().default(true),
});

export const noShowSchema = z.object({
  fee_minor: minorAmount.default(0),
  note: optionalText(255),
});

export const changeDatesSchema = z.object({
  check_in: isoDate,
  check_out: isoDate,
  /** لو الوحدة مشغولة في الفترة الجديدة: يُنقَل الحجز لوحدة أخرى فاضية من نفس النوع */
  allow_reassign: z.boolean().default(false),
  override: overrides.pick({ restrictions: true, past: true }).optional(),
});

export const moveSchema = z.object({
  segment_id: idSchema,
  to_unit_id: idSchema,
  /** من أي ليلة يبدأ النقل؛ الافتراضي: بداية الجزء (أو اليوم للنزيل المقيم) */
  effective_date: isoDate.optional(),
  force_dirty: z.boolean().default(false),
});

const csv = z.string().transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean));
const flag = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1');

export const listReservationsQuery = pagingSchema.extend({
  status: csv.pipe(z.array(z.enum(['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show']))).optional(),
  q: z.string().trim().max(80).optional(),
  check_in_from: isoDate.optional(),
  check_in_to: isoDate.optional(),
  check_out_from: isoDate.optional(),
  check_out_to: isoDate.optional(),
  /** الحجوزات التي تبيت ليلة هذا التاريخ */
  stay_on: isoDate.optional(),
  arriving: isoDate.optional(),
  departing: isoDate.optional(),
  in_house: flag.optional(),
  unpaid: flag.optional(),
  source: z.enum([...SOURCES, 'website']).optional(),
  unit_id: idSchema.optional(),
  guest_id: idSchema.optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
