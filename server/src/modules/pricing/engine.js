/**
 * ═══════════════════════════════════════════════════════════════
 *  محرّك التسعير — دوال صرفة بلا قاعدة بيانات ولا وقت حالي
 *
 *  كل ما يخصّ الفلوس في النظام يمرّ من هنا: عرض السعر في البحث، الحجز،
 *  إعادة الحساب عند التعديل، والفاتورة. وجوده في ملف واحد بلا اعتماديات
 *  يجعل اختباره بالأرقام ممكنًا، وهذا هو المقصود: خطأ قرش في آلاف الفواتير
 *  لا يظهر إلا بعد شهور.
 *
 *  نموذج التسعير:
 *   1) لكل ليلة: السعر الأساسي لنوع الوحدة، ثم **تفوز قاعدة واحدة** (الأعلى
 *      أولوية؛ عند التساوي: الخاصة بخطة سعر على العامّة، ثم الأحدث بداية).
 *      القاعدة إمّا تحدّد سعرًا (set_price) أو تعدّل نسبيًّا (percent_adjust).
 *   2) خصم خطة السعر (مثل «غير قابل للاسترداد») على سعر الغرفة.
 *   3) رسوم الأفراد: بالغ زائد وطفل زائد عن المشمولين، ووجبات الخطة للفرد.
 *   4) القيود (حدّ أدنى للإقامة، إغلاق وصول/مغادرة، إيقاف بيع) تُجمَع من كل
 *      القواعد المطابقة، ولا تؤثّر في السعر.
 *   5) الخصم (كود ترويجي) على الغرفة ورسوم الأفراد، ثم الخدمة، ثم الضريبة.
 * ═══════════════════════════════════════════════════════════════
 */
import { addDays, diffDays, dowIncluded, eachNight } from '../../utils/dates.js';
import { applyBps, roundHalfUp, sum } from '../../utils/money.js';

const BPS = 10_000;

/* ── اختيار القاعدة ─────────────────────────────────────────── */

function ruleMatches(rule, date, planId) {
  if (rule.is_active === 0 || rule.is_active === false) return false;
  if (date < rule.start_date || date > rule.end_date) return false;
  if (!dowIncluded(rule.dow_mask ?? 127, date)) return false;
  return rule.rate_plan_id == null || rule.rate_plan_id === planId;
}

function pickWinner(matching) {
  const priced = matching.filter((rule) => rule.kind === 'set_price' || rule.kind === 'percent_adjust');
  if (priced.length === 0) return null;
  return [...priced].sort((a, b) =>
    (b.priority - a.priority)
    || (Number(b.rate_plan_id != null) - Number(a.rate_plan_id != null))
    || (a.start_date === b.start_date ? 0 : (b.start_date > a.start_date ? 1 : -1))
    || (b.id - a.id))[0];
}

/* ── سعر الليلة ─────────────────────────────────────────────── */

export function nightlyRoomPrice({ rule, unitType, ratePlan }) {
  const base = unitType.base_price_minor;
  let price = base;
  if (rule?.kind === 'set_price') price = rule.price_minor;
  else if (rule?.kind === 'percent_adjust') price = roundHalfUp((base * (BPS + rule.percent_bps)) / BPS);
  if (ratePlan?.discount_bps) price = roundHalfUp((price * (BPS - ratePlan.discount_bps)) / BPS);
  return Math.max(0, price);
}

/** رسوم الأفراد للّيلة الواحدة: البالغ/الطفل الزائد + وجبات الخطة */
export function occupancyCharges({ unitType, ratePlan, adults, children }) {
  const extraAdults = Math.max(0, adults - unitType.base_adults);
  const chargeableChildren = Math.max(0, children - unitType.free_children);
  return {
    extraGuest: extraAdults * unitType.extra_adult_minor + chargeableChildren * unitType.extra_child_minor,
    meal: ratePlan ? adults * ratePlan.meal_adult_minor + children * ratePlan.meal_child_minor : 0,
  };
}

/* ── القيود ─────────────────────────────────────────────────── */

/**
 * هل الإقامة مسموحة؟ تُرجع قائمة مخالفات (فارغة = مسموحة).
 * الحدّ الأدنى/الأقصى للإقامة يُقرأ من قواعد يوم الوصول (كما تفعل المنصّات).
 */
export function evaluateStay({ rules, ratePlan, unitType, checkIn, checkOut, adults, children }) {
  const planId = ratePlan?.id ?? null;
  const nights = diffDays(checkIn, checkOut);
  const violations = [];

  if (adults > unitType.max_adults) {
    violations.push({ code: 'OVER_CAPACITY', message: `أقصى عدد بالغين ${unitType.max_adults}` });
  }
  if (children > unitType.max_children) {
    violations.push({ code: 'OVER_CAPACITY', message: `أقصى عدد أطفال ${unitType.max_children}` });
  }
  if (adults + children > unitType.max_occupancy) {
    violations.push({ code: 'OVER_CAPACITY', message: `أقصى سعة للوحدة ${unitType.max_occupancy} أفراد` });
  }

  const arrival = rules.filter((rule) => ruleMatches(rule, checkIn, planId));
  const departure = rules.filter((rule) => ruleMatches(rule, checkOut, planId));

  const minStay = Math.max(1, ...arrival.map((rule) => rule.min_stay ?? 0));
  const maxStays = arrival.filter((rule) => rule.max_stay != null).map((rule) => rule.max_stay);
  const maxStay = maxStays.length > 0 ? Math.min(...maxStays) : null;

  if (nights < minStay) {
    violations.push({ code: 'MIN_STAY', min_stay: minStay, message: `الحدّ الأدنى للإقامة ${minStay} ليلة` });
  }
  if (maxStay !== null && nights > maxStay) {
    violations.push({ code: 'MAX_STAY', max_stay: maxStay, message: `الحدّ الأقصى للإقامة ${maxStay} ليلة` });
  }
  if (arrival.some((rule) => rule.closed_to_arrival)) {
    violations.push({ code: 'CLOSED_TO_ARRIVAL', message: 'الوصول مغلق في التاريخ ده' });
  }
  if (departure.some((rule) => rule.closed_to_departure)) {
    violations.push({ code: 'CLOSED_TO_DEPARTURE', message: 'المغادرة مغلقة في التاريخ ده' });
  }

  const stopped = eachNight(checkIn, checkOut)
    .filter((date) => rules.some((rule) => ruleMatches(rule, date, planId) && rule.stop_sell));
  if (stopped.length > 0) {
    violations.push({ code: 'STOP_SELL', dates: stopped, message: `البيع موقوف في: ${stopped.slice(0, 3).join('، ')}${stopped.length > 3 ? '…' : ''}` });
  }

  return { violations, min_stay: minStay, max_stay: maxStay };
}

/* ── تسعير إقامة وحدة واحدة ─────────────────────────────────── */

export function priceUnitStay({ unitType, ratePlan = null, rules = [], checkIn, checkOut, adults, children }) {
  const planId = ratePlan?.id ?? null;
  const { extraGuest, meal } = occupancyCharges({ unitType, ratePlan, adults, children });

  const nights = eachNight(checkIn, checkOut).map((date) => {
    const winner = pickWinner(rules.filter((rule) => ruleMatches(rule, date, planId)));
    return {
      date,
      room_minor: nightlyRoomPrice({ rule: winner, unitType, ratePlan }),
      extra_guest_minor: extraGuest,
      meal_minor: meal,
      rule_id: winner?.id ?? null,
    };
  });

  return {
    nights,
    rooms_minor: sum(nights.map((night) => night.room_minor)),
    extra_guest_minor: sum(nights.map((night) => night.extra_guest_minor)),
    meal_minor: sum(nights.map((night) => night.meal_minor)),
    ...evaluateStay({ rules, ratePlan, unitType, checkIn, checkOut, adults, children }),
  };
}

/* ── الكود الترويجي ─────────────────────────────────────────── */

/** @returns {{ valid: true } | { valid: false, code: string, message: string }} */
export function validatePromo({ promo, today, checkIn, checkOut }) {
  const invalid = (code, message) => ({ valid: false, code, message });
  if (!promo || !promo.is_active) return invalid('PROMO_INVALID', 'كود الخصم غير صالح');
  if ((promo.valid_from && today < promo.valid_from) || (promo.valid_to && today > promo.valid_to)) {
    return invalid('PROMO_EXPIRED', 'كود الخصم منتهي أو لم يبدأ بعد');
  }
  const lastNight = addDays(checkOut, -1);
  if ((promo.stay_from && checkIn < promo.stay_from) || (promo.stay_to && lastNight > promo.stay_to)) {
    return invalid('PROMO_STAY_WINDOW', 'كود الخصم لا يسري على تواريخ الإقامة دي');
  }
  if (diffDays(checkIn, checkOut) < promo.min_nights) {
    return invalid('PROMO_MIN_NIGHTS', `كود الخصم يتطلّب ${promo.min_nights} ليالٍ على الأقل`);
  }
  if (promo.max_uses != null && promo.uses_count >= promo.max_uses) {
    return invalid('PROMO_EXHAUSTED', 'كود الخصم استُنفد');
  }
  return { valid: true };
}

/** الخصم (موجب) على أساس قابل للخصم: الغرفة + رسوم الأفراد */
export function promoDiscount({ promo, base }) {
  if (!promo || base <= 0) return 0;
  const raw = promo.discount_type === 'percent' ? applyBps(base, promo.value) : promo.value;
  return Math.min(base, Math.max(0, raw));
}

/* ── الإجماليات: خدمة + ضريبة + رسوم ────────────────────────── */

/**
 * @param {object} args
 * @param {Array<{type:string, amount_minor:number, taxable:boolean, service_chargeable:boolean}>} args.lines
 *        بنود موقّعة: الخصم سالب. الأنواع: room · extra_guest · meal · extra · discount · fee
 * @param {number} args.unitNights  مجموع (وحدات × ليالٍ) لرسم المدينة
 * @param {object} args.property    tax_bps · service_charge_bps · tax_on_service_charge · prices_include_tax · city_fee_per_night_minor
 *
 * الأسعار «شاملة» (prices_include_tax): الأسعار المعروضة تحتوي الخدمة والضريبة،
 * فنستخلصهما منها ولا نضيفهما، والإجمالي = مجموع البنود + رسم المدينة.
 * في الحالتين: صافي + خدمة + ضريبة = الإجمالي بالقرش بلا بقايا (الضريبة تُشتقّ كباقٍ
 * في الوضع الشامل).
 */
export function computeTotals({ lines, unitNights = 0, property }) {
  const serviceRate = property.service_charge_bps ?? 0;
  const taxRate = property.tax_bps ?? 0;
  const taxOnService = Boolean(property.tax_on_service_charge);
  const inclusive = Boolean(property.prices_include_tax);

  // نجمّع البنود بفئات (خاضع للخدمة؟ × خاضع للضريبة؟) ونحسب لكل فئة مرّة واحدة
  const groups = new Map();
  for (const line of lines) {
    const key = `${line.service_chargeable ? 1 : 0}${line.taxable ? 1 : 0}`;
    groups.set(key, (groups.get(key) ?? 0) + line.amount_minor);
  }

  let net = 0;
  let service = 0;
  let tax = 0;
  for (const [key, groupSum] of groups) {
    const chargeable = key[0] === '1';
    const taxable = key[1] === '1';

    if (inclusive) {
      const multiplier = taxOnService
        ? (1 + (chargeable ? serviceRate : 0) / BPS) * (1 + (taxable ? taxRate : 0) / BPS)
        : 1 + ((chargeable ? serviceRate : 0) + (taxable ? taxRate : 0)) / BPS;
      const groupNet = roundHalfUp(groupSum / multiplier);
      const groupService = chargeable ? applyBps(groupNet, serviceRate) : 0;
      net += groupNet;
      service += groupService;
      tax += groupSum - groupNet - groupService;
    } else {
      const groupService = chargeable ? applyBps(groupSum, serviceRate) : 0;
      const taxBase = taxable ? groupSum + (taxOnService ? groupService : 0) : 0;
      net += groupSum;
      service += groupService;
      tax += applyBps(taxBase, taxRate);
    }
  }

  const cityFee = unitNights * (property.city_fee_per_night_minor ?? 0);
  const byType = (type) => sum(lines.filter((line) => line.type === type).map((line) => line.amount_minor));

  return {
    subtotal_minor: net,
    service_charge_minor: service,
    tax_minor: tax,
    city_fee_minor: cityFee,
    total_minor: net + service + tax + cityFee,
    // أرقام العرض (قبل الخدمة والضريبة في الوضع الحصري، ومعها في الشامل)
    breakdown: {
      rooms_minor: byType('room'),
      extra_guest_minor: byType('extra_guest'),
      meal_minor: byType('meal'),
      extras_minor: byType('extra') + byType('fee'),
      discount_minor: -byType('discount'),
    },
  };
}

/** يبني بنود الحساب من أجزاء الحجز + بنود الفاتورة اليدوية + الخصم الترويجي */
export function reservationLines({ stays, folioItems = [], promoDiscountMinor = 0 }) {
  const lines = [];
  for (const stay of stays) {
    lines.push({ type: 'room', amount_minor: stay.rooms_minor, taxable: true, service_chargeable: true });
    lines.push({ type: 'extra_guest', amount_minor: stay.extra_guest_minor, taxable: true, service_chargeable: true });
    lines.push({ type: 'meal', amount_minor: stay.meal_minor, taxable: true, service_chargeable: true });
  }
  if (promoDiscountMinor > 0) {
    lines.push({ type: 'discount', amount_minor: -promoDiscountMinor, taxable: true, service_chargeable: true });
  }
  for (const item of folioItems) {
    const type = { discount: 'discount', fee: 'fee' }[item.type] ?? 'extra';
    lines.push({
      type,
      amount_minor: item.amount_minor,
      taxable: Boolean(item.taxable),
      service_chargeable: Boolean(item.service_chargeable),
    });
  }
  return lines.filter((line) => line.amount_minor !== 0);
}

/** العربون المطلوب من إجمالي الحجز */
export const depositDue = (totalMinor, percent) => roundHalfUp((totalMinor * percent) / 100);
