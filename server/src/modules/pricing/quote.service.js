/**
 * ═══════════════════════════════════════════════════════════════
 *  عرض السعر: يحمّل بيانات المنشأة من القاعدة ويمرّرها لمحرّك التسعير الصرف.
 *  هذه الطبقة هي الوحيدة التي تعرف أين تُخزَّن الأنواع والخطط والقواعد.
 * ═══════════════════════════════════════════════════════════════
 */
import { query, queryOne } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { diffDays, todayIn } from '../../utils/dates.js';
import {
  computeTotals, depositDue, priceUnitStay, promoDiscount, reservationLines, validatePromo,
} from './engine.js';

export const MAX_NIGHTS = 90;

export function assertStayDates(property, checkIn, checkOut, { allowPast = false } = {}) {
  if (checkOut <= checkIn) {
    throw ApiError.unprocessable('تاريخ المغادرة لازم يكون بعد الوصول', {
      code: 'VALIDATION_ERROR', details: { check_out: 'لازم يكون بعد تاريخ الوصول' },
    });
  }
  if (diffDays(checkIn, checkOut) > MAX_NIGHTS) {
    throw ApiError.unprocessable(`الحدّ الأقصى للإقامة ${MAX_NIGHTS} ليلة`, {
      code: 'VALIDATION_ERROR', details: { check_out: `الحدّ الأقصى ${MAX_NIGHTS} ليلة` },
    });
  }
  if (!allowPast && checkIn < todayIn(property.timezone)) {
    throw ApiError.unprocessable('تاريخ الوصول فات', {
      code: 'PAST_DATE', details: { check_in: 'تاريخ في الماضي' },
    });
  }
}

export async function loadUnitType(propertyId, id, { activeOnly = true } = {}) {
  const type = await queryOne(
    `SELECT * FROM unit_types WHERE id = ? AND property_id = ? AND deleted_at IS NULL ${activeOnly ? 'AND is_active = 1' : ''}`,
    [id, propertyId],
  );
  if (!type) {
    throw ApiError.badRequest('نوع الوحدة غير موجود أو غير متاح', { code: 'BAD_UNIT_TYPE', details: { unit_type_id: 'غير متاح' } });
  }
  return type;
}

/**
 * خطة السعر: المحدَّدة صراحةً (لازم فعّالة، وعلنية لو الطلب من الإنترنت)،
 * وإلا الافتراضية للمنشأة إن وُجدت، وإلا بلا خطة (غرفة فقط).
 */
export async function loadRatePlan(propertyId, id, { publicOnly = false } = {}) {
  if (id) {
    const plan = await queryOne(
      `SELECT * FROM rate_plans WHERE id = ? AND property_id = ? AND is_active = 1 ${publicOnly ? 'AND is_public = 1' : ''}`,
      [id, propertyId],
    );
    if (!plan) throw ApiError.badRequest('خطة السعر غير متاحة', { code: 'BAD_RATE_PLAN', details: { rate_plan_id: 'غير متاحة' } });
    return plan;
  }
  return queryOne(
    `SELECT * FROM rate_plans WHERE property_id = ? AND is_default = 1 AND is_active = 1 ${publicOnly ? 'AND is_public = 1' : ''}`,
    [propertyId],
  );
}

/** قواعد تتقاطع مع [الوصول، المغادرة] — المغادرة مشمولة لقيد «إغلاق المغادرة» */
export const loadRules = (propertyId, unitTypeId, checkIn, checkOut) => query(
  `SELECT * FROM price_rules
    WHERE property_id = ? AND unit_type_id = ? AND is_active = 1 AND start_date <= ? AND end_date >= ?`,
  [propertyId, unitTypeId, checkOut, checkIn],
);

export const loadPromo = (propertyId, code) => (code
  ? queryOne('SELECT * FROM promo_codes WHERE property_id = ? AND code = ?', [propertyId, String(code).trim().toUpperCase()])
  : Promise.resolve(null));

/**
 * يجمع كل شيء في عرض سعر واحد (دالة صرفة على بيانات محمّلة).
 * `promoRequested` تُمرَّر لنُرجع سبب رفض الكود بدل تجاهله بصمت.
 */
export function buildQuote({
  property, unitType, ratePlan, rules, promo, promoRequested = null,
  checkIn, checkOut, adults, children, units = 1, today,
}) {
  const stay = priceUnitStay({ unitType, ratePlan, rules, checkIn, checkOut, adults, children });
  const stays = Array.from({ length: units }, () => stay);

  let promoInfo = null;
  let discount = 0;
  if (promoRequested) {
    const verdict = validatePromo({ promo, today, checkIn, checkOut });
    if (verdict.valid) {
      discount = promoDiscount({ promo, base: (stay.rooms_minor + stay.extra_guest_minor) * units });
      promoInfo = { code: promo.code, valid: true, discount_minor: discount };
    } else {
      promoInfo = { code: String(promoRequested).toUpperCase(), valid: false, reason: verdict.code, message: verdict.message, discount_minor: 0 };
    }
  }

  const nights = diffDays(checkIn, checkOut);
  const totals = computeTotals({
    lines: reservationLines({ stays, promoDiscountMinor: discount }),
    unitNights: nights * units,
    property,
  });

  return {
    check_in: checkIn,
    check_out: checkOut,
    nights,
    units,
    adults,
    children,
    unit_type: { id: unitType.id, code: unitType.code, name_ar: unitType.name_ar, name_en: unitType.name_en },
    rate_plan: ratePlan
      ? { id: ratePlan.id, code: ratePlan.code, name_ar: ratePlan.name_ar, name_en: ratePlan.name_en, meal_plan: ratePlan.meal_plan, is_refundable: Boolean(ratePlan.is_refundable) }
      : null,
    nightly: stay.nights.map(({ date, room_minor: room, extra_guest_minor: extra, meal_minor: meal }) => ({
      date, room_minor: room, extra_guest_minor: extra, meal_minor: meal,
    })),
    bookable: stay.violations.length === 0,
    violations: stay.violations,
    min_stay: stay.min_stay,
    promo: promoInfo,
    totals,
    deposit_due_minor: depositDue(totals.total_minor, property.deposit_percent),
    currency: property.currency,
    // يحتاجه خطّ الحجز لتخزين تفصيل الليالي ولقطة كل وحدة
    _stay: stay,
    _discount_minor: discount,
  };
}

/** نسخة للعرض: بلا الحقول الداخلية */
export const publicQuote = ({ _stay, _discount_minor: _d, ...quote }) => quote;

/** تحميل + حساب لطلب واحد (مسار /quote) */
export async function quoteStay(property, input, { publicOnly = false } = {}) {
  assertStayDates(property, input.check_in, input.check_out, { allowPast: input.allow_past });
  const unitType = await loadUnitType(property.id, input.unit_type_id);
  const ratePlan = await loadRatePlan(property.id, input.rate_plan_id, { publicOnly });
  const [rules, promo] = await Promise.all([
    loadRules(property.id, unitType.id, input.check_in, input.check_out),
    loadPromo(property.id, input.promo_code),
  ]);

  return buildQuote({
    property, unitType, ratePlan, rules, promo, promoRequested: input.promo_code ?? null,
    checkIn: input.check_in, checkOut: input.check_out,
    adults: input.adults, children: input.children ?? 0, units: input.units ?? 1,
    today: todayIn(property.timezone),
  });
}
