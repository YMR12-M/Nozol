import { z } from 'zod';
import { AMENITY_KEYS } from '../../config/amenities.js';
import { minorAmount, optionalText } from '../../utils/schemas.js';

const base = z.object({
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/, 'حروف إنجليزية وأرقام وشرطات فقط'),
  name_ar: z.string().trim().min(2).max(120),
  name_en: optionalText(120),
  description_ar: optionalText(3000),
  description_en: optionalText(3000),
  kind: z.enum(['room', 'suite', 'chalet', 'villa', 'apartment']),
  base_adults: z.number().int().min(1).max(20),
  free_children: z.number().int().min(0).max(20),
  max_adults: z.number().int().min(1).max(30),
  max_children: z.number().int().min(0).max(20),
  max_occupancy: z.number().int().min(1).max(40),
  bedrooms: z.number().int().min(0).max(20),
  beds: optionalText(120),
  size_sqm: z.number().int().min(1).max(5000).nullable(),
  base_price_minor: minorAmount,
  extra_adult_minor: minorAmount,
  extra_child_minor: minorAmount,
  amenities: z.array(z.enum(AMENITY_KEYS)).max(40).transform((keys) => [...new Set(keys)]),
  sort_order: z.number().int().min(-1000).max(100_000),
  is_active: z.boolean(),
});

export const UNIT_TYPE_FIELDS = Object.keys(base.shape);

export const createUnitTypeSchema = base.partial().required({
  code: true, name_ar: true, base_price_minor: true,
});
export const updateUnitTypeSchema = base.partial();

export const listUnitTypesQuery = z.object({
  active: z.enum(['true', 'false']).optional(),
});

/** قواعد السعة المتقاطعة — تُفحَص على القيم النهائية بعد الدمج مع الموجود */
export function capacityIssues(type) {
  const issues = {};
  if (type.base_adults > type.max_adults) issues.base_adults = 'أكبر من الحد الأقصى للبالغين';
  if (type.max_occupancy < type.base_adults) issues.max_occupancy = 'أقل من البالغين المشمولين في السعر';
  if (type.max_occupancy > type.max_adults + type.max_children) {
    issues.max_occupancy = 'أكبر من مجموع الحد الأقصى للبالغين والأطفال';
  }
  if (type.free_children > type.max_children) issues.free_children = 'أكبر من الحد الأقصى للأطفال';
  return issues;
}
