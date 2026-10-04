import { z } from 'zod';
import { bpsSchema, idSchema, isoDate, minorAmount, optionalText } from '../../utils/schemas.js';

const code = z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/, 'حروف إنجليزية وأرقام وشرطات فقط');

/* ── خطط الأسعار ── */
const ratePlanBase = z.object({
  code,
  name_ar: z.string().trim().min(2).max(120),
  name_en: optionalText(120),
  description_ar: optionalText(500),
  description_en: optionalText(500),
  meal_plan: z.enum(['RO', 'BB', 'HB', 'FB', 'AI']),
  meal_adult_minor: minorAmount,
  meal_child_minor: minorAmount,
  discount_bps: bpsSchema.max(9500),
  is_refundable: z.boolean(),
  is_default: z.boolean(),
  is_public: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.number().int().min(-1000).max(100_000),
});
export const RATE_PLAN_FIELDS = Object.keys(ratePlanBase.shape);
export const createRatePlanSchema = ratePlanBase.partial().required({ code: true, name_ar: true });
export const updateRatePlanSchema = ratePlanBase.partial();

/* ── قواعد التسعير ── */
const ruleBase = z.object({
  unit_type_id: idSchema,
  rate_plan_id: idSchema.nullable(),
  name: z.string().trim().min(1).max(120),
  start_date: isoDate,
  end_date: isoDate,
  dow_mask: z.number().int().min(1).max(127),
  kind: z.enum(['set_price', 'percent_adjust', 'restriction_only']),
  price_minor: minorAmount.nullable(),
  percent_bps: z.number().int().min(-9000).max(30_000).nullable(),
  min_stay: z.number().int().min(1).max(60).nullable(),
  max_stay: z.number().int().min(1).max(365).nullable(),
  closed_to_arrival: z.boolean(),
  closed_to_departure: z.boolean(),
  stop_sell: z.boolean(),
  priority: z.number().int().min(-100).max(100),
  is_active: z.boolean(),
});
export const PRICE_RULE_FIELDS = Object.keys(ruleBase.shape);

/** تماسك القاعدة: لكل نوع الحقول التي يلزم وجودها */
export function ruleIssues(rule) {
  const issues = {};
  if (rule.end_date < rule.start_date) issues.end_date = 'النهاية قبل البداية';
  if (rule.kind === 'set_price' && (rule.price_minor === null || rule.price_minor === undefined)) {
    issues.price_minor = 'حدّد السعر';
  }
  if (rule.kind === 'percent_adjust' && (rule.percent_bps === null || rule.percent_bps === undefined)) {
    issues.percent_bps = 'حدّد النسبة';
  }
  if (rule.kind === 'restriction_only'
    && !rule.min_stay && !rule.max_stay && !rule.closed_to_arrival && !rule.closed_to_departure && !rule.stop_sell) {
    issues.kind = 'حدّد قيدًا واحدًا على الأقل';
  }
  if (rule.min_stay && rule.max_stay && rule.min_stay > rule.max_stay) issues.max_stay = 'أقل من الحدّ الأدنى';
  return issues;
}

export const createPriceRuleSchema = ruleBase
  .partial()
  .required({ name: true, start_date: true, end_date: true })
  .omit({ unit_type_id: true })
  .extend({ unit_type_ids: z.array(idSchema).min(1).max(50) });
export const updatePriceRuleSchema = ruleBase.partial().omit({ unit_type_id: true });

export const listPriceRulesQuery = z.object({
  unit_type_id: idSchema.optional(),
  rate_plan_id: idSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  active: z.enum(['true', 'false']).optional(),
});

/* ── أكواد الخصم ── */
const promoBase = z.object({
  code: z.string().trim().toUpperCase().min(3).max(30).regex(/^[A-Z0-9_-]+$/, 'حروف إنجليزية وأرقام وشرطات'),
  description: optionalText(190),
  discount_type: z.enum(['percent', 'fixed']),
  value: z.number().int().min(1).max(10_000_000_000),
  valid_from: isoDate.nullable(),
  valid_to: isoDate.nullable(),
  stay_from: isoDate.nullable(),
  stay_to: isoDate.nullable(),
  min_nights: z.number().int().min(1).max(60),
  max_uses: z.number().int().min(1).max(1_000_000).nullable(),
  is_active: z.boolean(),
});
export const PROMO_FIELDS = Object.keys(promoBase.shape);

export function promoIssues(promo) {
  const issues = {};
  if (promo.discount_type === 'percent' && promo.value > 10_000) issues.value = 'النسبة لا تتجاوز 100%';
  if (promo.valid_from && promo.valid_to && promo.valid_to < promo.valid_from) issues.valid_to = 'قبل البداية';
  if (promo.stay_from && promo.stay_to && promo.stay_to < promo.stay_from) issues.stay_to = 'قبل البداية';
  return issues;
}
export const createPromoSchema = promoBase.partial().required({ code: true, discount_type: true, value: true });
export const updatePromoSchema = promoBase.partial().omit({ code: true });

/* ── الخدمات الإضافية ── */
const serviceBase = z.object({
  name_ar: z.string().trim().min(2).max(120),
  name_en: optionalText(120),
  price_minor: minorAmount,
  taxable: z.boolean(),
  service_chargeable: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.number().int().min(-1000).max(100_000),
});
export const SERVICE_FIELDS = Object.keys(serviceBase.shape);
export const createServiceSchema = serviceBase.partial().required({ name_ar: true });
export const updateServiceSchema = serviceBase.partial();
