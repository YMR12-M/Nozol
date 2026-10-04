import { z } from 'zod';
import {
  bpsSchema, emailSchema, minorAmount, optionalText, phoneSchema, timeOfDay,
} from '../../utils/schemas.js';

const optionalPhone = z.union([phoneSchema, z.literal('').transform(() => null), z.null()]);
const optionalEmail = z.union([emailSchema, z.literal('').transform(() => null), z.null()]);

const timezoneSchema = z.string().refine((timeZone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}, 'منطقة زمنية غير صالحة (مثال: Africa/Cairo)');

export const slugSchema = z.string().trim().toLowerCase()
  .min(3).max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'حروف إنجليزية صغيرة وأرقام وشرطات فقط (مثال: nile-view-hotel)');

const prefixSchema = z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9-]+$/, 'حروف إنجليزية وأرقام فقط');

const base = z.object({
  name_ar: z.string().trim().min(2).max(150),
  name_en: optionalText(150),
  kind: z.enum(['hotel', 'guesthouse', 'chalet', 'apartments', 'resort', 'hostel']),
  slug: slugSchema,
  description_ar: optionalText(5000),
  description_en: optionalText(5000),
  phone: optionalPhone,
  whatsapp: optionalPhone,
  email: optionalEmail,
  address_ar: optionalText(255),
  address_en: optionalText(255),
  city: optionalText(80),
  governorate: optionalText(80),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  timezone: timezoneSchema,
  currency: z.string().trim().toUpperCase().length(3),
  check_in_time: timeOfDay,
  check_out_time: timeOfDay,
  tax_bps: bpsSchema,
  service_charge_bps: bpsSchema,
  tax_on_service_charge: z.boolean(),
  prices_include_tax: z.boolean(),
  city_fee_per_night_minor: minorAmount,
  deposit_percent: z.number().int().min(0).max(100),
  hold_hours: z.number().int().min(1).max(168),
  free_cancel_hours: z.number().int().min(0).max(24 * 90),
  cancellation_policy_ar: optionalText(3000),
  cancellation_policy_en: optionalText(3000),
  public_booking_enabled: z.boolean(),
  invoice_prefix: prefixSchema,
  booking_prefix: prefixSchema,
});

export const PROPERTY_FIELDS = Object.keys(base.shape);

export const createPropertySchema = base.partial().required({ name_ar: true });
export const updatePropertySchema = base.partial();
