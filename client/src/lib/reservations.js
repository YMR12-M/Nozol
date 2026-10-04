/**
 * منطق الحجز الخالص (بلا React): ما يُرسَل للسيرفر، وما يُسمح به في كل حالة.
 * مشترك بين «حجز جديد» و«تفاصيل الحجز»، ومفصول كي يُختبر بالأرقام وحده.
 */
import { addDays, diffDays } from './format.js';

/** حدود السيرفر (createReservationSchema · assertStayDates) */
export const MAX_ROOMS = 20;
export const MAX_NIGHTS = 90;

/** غرفة جاهزة للنزول: نظيفة أو تم فحصها */
export const isUnitReady = (housekeepingStatus) => ['clean', 'inspected'].includes(housekeepingStatus);

/* ── أرقام وتواريخ ──────────────────────────────────────────── */

/** أرقام عربية/فارسية (٠١٢) ← لاتينية: السيرفر يقرأ الهاتف والهوية باللاتينية فقط */
export const latinDigits = (text = '') => String(text)
  .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
  .replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit));

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** يتحقّق من نافذة الإقامة؛ يُرجع رسالة الخطأ أو null */
export function stayIssue({ check_in: checkIn, check_out: checkOut }, today) {
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) return 'اختار تاريخ الوصول والمغادرة';
  if (checkOut <= checkIn) return 'المغادرة لازم تكون بعد الوصول';
  if (diffDays(checkIn, checkOut) > MAX_NIGHTS) return `الحدّ الأقصى للإقامة ${MAX_NIGHTS} ليلة`;
  if (checkIn < today) return 'تاريخ الوصول فات';
  return null;
}

/** ساعة · ساعتان · 3 ساعات · 11 ساعة — بنفس صيغة nightsLabel */
function plural(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}
export const hoursLabel = (n) => plural(n, 'ساعة', 'ساعتان', 'ساعات', 'ساعة');
export const minutesLabel = (n) => plural(n, 'دقيقة', 'دقيقتان', 'دقائق', 'دقيقة');

/** المتبقي من مهلة الحجز المعلّق: { expired, label, urgent } أو null لو بلا مهلة */
export function holdRemaining(holdExpiresAt, now = Date.now()) {
  if (!holdExpiresAt) return null;
  const ms = new Date(holdExpiresAt).getTime() - now;
  if (!(ms > 0)) return { expired: true, urgent: true, label: 'انتهت المهلة' };
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (hours > 0) parts.push(hoursLabel(hours));
  if (minutes > 0 || hours === 0) parts.push(minutesLabel(minutes));
  return { expired: false, urgent: totalMinutes <= 360, label: parts.join(' و') };
}

/* ── سطور الغرف في الحجز الجديد ─────────────────────────────── */

/**
 * سطر غرفة. `rate_plan_id: undefined` = لم تُختَر خطة بعد (تُختار تلقائيًّا
 * حين تصل العروض لو جاء النوع من التقويم)، أمّا `null` فهي «بلا خطة».
 */
export const newLine = (key, defaults = {}) => ({
  key, adults: 2, children: 0, unit_type_id: null, rate_plan_id: undefined, unit_id: null, ...defaults,
});
export const isChosen = (line) => line.unit_type_id !== null && line.rate_plan_id !== undefined;

/** خطة العرض المطابقة لخطة السطر داخل نتيجة نوع واحد */
export const findPlan = (result, ratePlanId) =>
  result?.plans.find((plan) => (plan.rate_plan?.id ?? null) === (ratePlanId ?? null)) ?? null;

/**
 * مشكلة سطر مختار مقابل نتيجة البحث الحالية (التواريخ أو العدد تغيّروا بعد الاختيار).
 * `usedByOthers`: كم سطرًا آخر اختار النوع نفسه؛ كلها تُخصم من الوحدات الفاضية.
 */
export function lineProblem(line, result, usedByOthers = 0) {
  if (!isChosen(line)) return null;
  if (!result) return 'النوع ده مش متاح في التواريخ دي';
  if (!result.capacity_ok) return 'عدد الضيوف أكبر من سعة النوع ده';
  if (result.available_units - usedByOthers <= 0) return 'مفيش وحدات فاضية كفاية من النوع ده';
  if (!findPlan(result, line.rate_plan_id)) return 'الخطة دي مش متاحة في التواريخ دي';
  return null;
}

/** ما يحتاجه تسعير الغرفة (بلا اختيار وحدة بعينها): النوع والضيوف والخطة إن وُجدت */
export const pricingRoom = (line) => ({
  unit_type_id: line.unit_type_id,
  adults: line.adults,
  children: line.children,
  ...(line.rate_plan_id ? { rate_plan_id: line.rate_plan_id } : {}),
});

/**
 * أرقام معاينة السيرفر (POST /reservations/quote) بنفس أسماء حقول الحجز، فتُعرض بـ totalsRows
 * كما تُعرض تفاصيل الحجز المحفوظ.
 */
export function quoteTotals(quote) {
  const { totals } = quote;
  return {
    rooms_minor: totals.breakdown.rooms_minor,
    extra_guest_minor: totals.breakdown.extra_guest_minor,
    meal_minor: totals.breakdown.meal_minor,
    extras_minor: totals.breakdown.extras_minor,
    discount_minor: totals.breakdown.discount_minor,
    service_charge_minor: totals.service_charge_minor,
    tax_minor: totals.tax_minor,
    city_fee_minor: totals.city_fee_minor,
    total_minor: totals.total_minor,
    deposit_due_minor: quote.deposit_due_minor,
  };
}

/**
 * صفوف الإجماليات. لو الأسعار «شاملة» فالخدمة والضريبة داخل الإجمالي أصلًا:
 * تُعرض صفوفًا منفصلة «منها» لا تُجمع، وإلا اختلف مجموع الصفوف عن الإجمالي.
 */
export function totalsRows(reservation, { inclusive = false } = {}) {
  const shown = (rows) => rows.filter((row) => row.minor !== 0);
  const rows = shown([
    { key: 'rooms', label: 'الإقامة', minor: reservation.rooms_minor },
    { key: 'extra_guest', label: 'أفراد إضافيون', minor: reservation.extra_guest_minor },
    { key: 'meal', label: 'وجبات', minor: reservation.meal_minor },
    { key: 'extras', label: 'خدمات وبنود', minor: reservation.extras_minor },
    { key: 'discount', label: 'خصم', minor: -reservation.discount_minor },
    ...(inclusive ? [] : [
      { key: 'service', label: 'رسم الخدمة', minor: reservation.service_charge_minor },
      { key: 'tax', label: 'الضريبة', minor: reservation.tax_minor },
    ]),
    { key: 'city_fee', label: 'رسم المدينة', minor: reservation.city_fee_minor },
  ]);
  const included = inclusive ? shown([
    { key: 'service', label: 'منها رسم الخدمة', minor: reservation.service_charge_minor },
    { key: 'tax', label: 'منها الضريبة', minor: reservation.tax_minor },
  ]) : [];
  return { rows, included };
}

/* ── جسم الطلب ──────────────────────────────────────────────── */

/**
 * نزيل جديد داخل الحجز. الحقول الفارغة تُحذف: السيرفر يرفض '' في id_type
 * وbirth_date، ولا حاجة لإرسال null لما لم يُكتب.
 */
export function inlineGuest(values) {
  const guest = { full_name: values.full_name.trim() };
  const fields = {
    phone: latinDigits(values.phone ?? '').trim(),
    id_number: latinDigits(values.id_number ?? '').trim(),
    email: (values.email ?? '').trim(),
    nationality: (values.nationality ?? '').trim(),
  };
  for (const [key, text] of Object.entries(fields)) if (text) guest[key] = text;
  if (values.id_type) guest.id_type = values.id_type;
  return guest;
}

/** سطر غرفة في الطلب: لا نرسل unit_id/rate_plan_id فارغَين (السيرفر يرفض null في unit_id) */
const toRoom = (line) => ({ ...pricingRoom(line), ...(line.unit_id ? { unit_id: line.unit_id } : {}) });

/** يبني جسم POST /reservations من حالة الصفحة */
export function buildReservationPayload({
  stay, lines, guest, guestValues, promoCode = '', details, deposit, override = {},
}) {
  const payload = {
    guest: guest.kind === 'existing' ? { id: guest.data.id } : inlineGuest(guestValues),
    check_in: stay.check_in,
    check_out: stay.check_out,
    adults: lines[0].adults,
    children: lines[0].children,
    rooms: lines.map(toRoom),
    status: details.status,
    source: details.source,
    send_confirmation: Boolean(details.send_confirmation),
  };

  const promo = promoCode.trim().toUpperCase();
  if (promo) payload.promo_code = promo;
  const optional = {
    external_ref: details.external_ref.trim(),
    guest_notes: details.guest_notes.trim(),
    internal_notes: details.internal_notes.trim(),
    expected_arrival: details.expected_arrival,
  };
  for (const [key, value] of Object.entries(optional)) if (value) payload[key] = value;

  if (deposit?.enabled && deposit.amount_minor > 0) {
    payload.deposit = { method: deposit.method, amount_minor: deposit.amount_minor };
    if (deposit.reference.trim()) payload.deposit.reference = deposit.reference.trim();
  }

  const overrides = Object.fromEntries(Object.entries(override).filter(([, enabled]) => enabled));
  if (Object.keys(overrides).length > 0) payload.override = overrides;
  return payload;
}

/** STAY_RESTRICTED عند الإنشاء: errors.rooms = [{ room, violations: [{ code, message }] }] */
export function restrictionLines(rooms = [], roomCount = 1) {
  return rooms.flatMap(({ room, violations }) =>
    violations.map((violation) => (roomCount > 1 ? `غرفة ${room + 1}: ${violation.message}` : violation.message)));
}

/** UNIT_NOT_AVAILABLE: errors.occupied = [{ night, reservation_code, guest_name, block_reason }] */
export function occupiedSummary(occupied = []) {
  const who = [...new Set(occupied.map((row) => (row.guest_name ? `${row.guest_name} (${row.reservation_code})` : 'حجب على الوحدة')))];
  return who.length > 0 ? `مشغولة بسبب: ${who.join('، ')}` : '';
}

/* ── ما يُسمح به في تفاصيل الحجز ────────────────────────────── */

/** الأزرار المتاحة لحجز بحالته وصلاحيات المستخدم (`can` من useAuth) */
export function reservationActions(reservation, { today, can }) {
  const { status } = reservation;
  const live = ['pending', 'confirmed', 'checked_in'].includes(status);
  const writes = can('reservations.write');
  return {
    confirm: status === 'pending' && writes,
    checkIn: status === 'confirmed' && can('reservations.checkin') && today < reservation.check_out,
    checkOut: status === 'checked_in' && can('reservations.checkin'),
    cancel: ['pending', 'confirmed'].includes(status) && can('reservations.cancel'),
    noShow: status === 'confirmed' && today > reservation.check_in && can('reservations.cancel'),
    changeDates: live && writes,
    move: live && writes,
    edit: writes,
    addItem: status !== 'cancelled' && can('billing.write'),
    addPayment: can('billing.write'),
    issueInvoice: status !== 'pending' && can('billing.write') && !reservation.invoices.some((invoice) => invoice.status === 'issued'),
    voidItem: can('billing.void'),
    voidPayment: can('billing.void'),
    voidInvoice: can('billing.void'),
  };
}

/**
 * مراجعة ما قبل تسجيل الدخول — نفس شروط السيرفر، فيرى الموظف المشكلة قبل أن يضغط.
 * الوحدات المعنيّة: ما يشغله النزيل اليوم، أو أول ليلة عند الوصول المبكّر.
 */
export function checkInReview(reservation, today) {
  const early = today < reservation.check_in;
  const arrival = early ? reservation.check_in : today;
  const units = reservation.segments.filter((segment) => segment.check_in <= arrival && segment.check_out > arrival);
  return {
    early,
    earlyNights: early ? diffDays(today, reservation.check_in) : 0,
    ended: today >= reservation.check_out,
    units,
    outOfOrder: units.filter((segment) => segment.unit_status !== 'active'),
    notReady: units.filter((segment) => segment.unit_status === 'active' && !isUnitReady(segment.housekeeping_status)),
    idMissing: !reservation.guest_id_number,
  };
}

/** مراجعة ما قبل تسجيل الخروج */
export function checkOutReview(reservation, today) {
  const remainingNights = Math.max(0, diffDays(today, reservation.check_out));
  return {
    balance: Math.max(0, reservation.balance_minor),
    remainingNights,
    // خروج مبكّر يحرّر الليالي المتبقية؛ لا معنى له يوم الوصول نفسه (لا يمكن أقل من ليلة)
    canDepartEarly: today < reservation.check_out && today > reservation.check_in,
  };
}

/** الجزء الذي يُقترح نقله: ما يشغله النزيل اليوم، وإلا أقرب جزء قادم */
export function defaultMoveSegment(reservation, today) {
  const { segments } = reservation;
  return segments.find((segment) => segment.check_in <= today && segment.check_out > today)
    ?? segments.find((segment) => segment.check_out > today)
    ?? segments[0]
    ?? null;
}

/** أول وآخر تاريخ نقل مسموح لجزء (النزيل المقيم لا ينقل ليالي فاتت) */
export function moveWindow(reservation, segment, today) {
  const inHouse = reservation.status === 'checked_in';
  const min = inHouse && today > segment.check_in ? today : segment.check_in;
  return { min, max: addDays(segment.check_out, -1) };
}

/** مبلغ الدفعة المقترح: المتبقي للدفع، أو الزائد عن الإجمالي للمرتجع */
export function suggestedAmount(type, reservation) {
  if (type === 'refund') {
    const over = reservation.paid_minor - reservation.total_minor;
    return over > 0 ? Math.min(over, reservation.paid_minor) : null;
  }
  return reservation.balance_minor > 0 ? reservation.balance_minor : null;
}

/** جزء الخصم الترويجي من خصم الحجز (الباقي بنود خصم يدوية) */
export function promoDiscountMinor(reservation) {
  if (!reservation.promo_code_id) return 0;
  const manual = reservation.items
    .filter((item) => item.type === 'discount' && !item.voided_at)
    .reduce((total, item) => total - item.amount_minor, 0);
  return Math.max(0, reservation.discount_minor - manual);
}
