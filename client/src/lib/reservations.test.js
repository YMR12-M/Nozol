import { describe, expect, test } from 'vitest';
import {
  buildReservationPayload, checkInReview, checkOutReview, defaultMoveSegment, findPlan, holdRemaining, inlineGuest, isChosen,
  isIsoDate, latinDigits, lineProblem, moveWindow, newLine, occupiedSummary, pricingRoom, promoDiscountMinor, quoteTotals,
  reservationActions, restrictionLines, stayIssue, suggestedAmount, totalsRows,
} from './reservations.js';

const TODAY = '2026-10-12';

const segment = (overrides = {}) => ({
  id: 1, unit_id: 5, unit_code: '101', unit_type_id: 1, unit_status: 'active', housekeeping_status: 'clean',
  check_in: '2026-10-12', check_out: '2026-10-15', ...overrides,
});
const reservation = (overrides = {}) => ({
  id: 1, status: 'confirmed', check_in: '2026-10-12', check_out: '2026-10-15', nights: 3,
  total_minor: 300_000, paid_minor: 100_000, balance_minor: 200_000, guest_id_number: '29801011234567',
  invoices: [], items: [], promo_code_id: null, discount_minor: 0, segments: [segment()], ...overrides,
});
const everything = () => true;

describe('أرقام وتواريخ', () => {
  test('latinDigits يحوّل العربية والفارسية ويترك الباقي', () => {
    expect(latinDigits('٠١٠١٢٣٤٥٦٧٨')).toBe('01012345678');
    expect(latinDigits('۰۱۲')).toBe('012');
    expect(latinDigits('+20 101-ABC')).toBe('+20 101-ABC');
  });

  test('isIsoDate يرفض التواريخ المستحيلة بلا رمي أخطاء', () => {
    expect(isIsoDate('2026-10-12')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-1-1')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  test('stayIssue: النافذة الصالحة وكل حالات الرفض', () => {
    expect(stayIssue({ check_in: '2026-10-12', check_out: '2026-10-13' }, TODAY)).toBeNull();
    expect(stayIssue({ check_in: '', check_out: '2026-10-13' }, TODAY)).toMatch('اختار');
    expect(stayIssue({ check_in: '2026-10-13', check_out: '2026-10-13' }, TODAY)).toMatch('بعد الوصول');
    expect(stayIssue({ check_in: '2026-10-13', check_out: '2026-10-12' }, TODAY)).toMatch('بعد الوصول');
    expect(stayIssue({ check_in: '2026-10-11', check_out: '2026-10-13' }, TODAY)).toMatch('فات');
    expect(stayIssue({ check_in: '2026-10-12', check_out: '2027-01-11' }, TODAY)).toMatch('90');
    // 90 ليلة بالضبط مسموحة
    expect(stayIssue({ check_in: '2026-10-12', check_out: '2027-01-10' }, TODAY)).toBeNull();
  });

  test('holdRemaining: ساعات ودقائق بصيغة عربية صحيحة', () => {
    const now = Date.parse('2026-10-12T10:00:00Z');
    const at = (minutes) => new Date(now + minutes * 60_000).toISOString();
    expect(holdRemaining(null, now)).toBeNull();
    expect(holdRemaining(at(-5), now)).toMatchObject({ expired: true });
    expect(holdRemaining(at(45), now)).toMatchObject({ label: '45 دقيقة', urgent: true });
    expect(holdRemaining(at(60), now).label).toBe('ساعة');
    expect(holdRemaining(at(150), now).label).toBe('ساعتان و30 دقيقة');
    expect(holdRemaining(at(10 * 60), now)).toMatchObject({ label: '10 ساعات', urgent: false });
    expect(holdRemaining(at(12 * 60 + 1), now).label).toBe('12 ساعة ودقيقة');
  });
});

describe('سطور الغرف', () => {
  const result = (overrides = {}) => ({
    unit_type: { id: 3 }, available_units: 2, capacity_ok: true,
    plans: [{ rate_plan: { id: 7 } }, { rate_plan: null }], ...overrides,
  });

  test('isChosen: النوع والخطة معًا (undefined = لم تُختَر خطة، null = بلا خطة)', () => {
    expect(isChosen(newLine(0))).toBe(false);
    expect(isChosen(newLine(0, { unit_type_id: 3 }))).toBe(false);
    expect(isChosen(newLine(0, { unit_type_id: 3, rate_plan_id: null }))).toBe(true);
    expect(isChosen(newLine(0, { unit_type_id: 3, rate_plan_id: 7 }))).toBe(true);
  });

  test('findPlan يطابق الخطة الصريحة وغير المسمّاة', () => {
    expect(findPlan(result(), 7).rate_plan.id).toBe(7);
    expect(findPlan(result(), null).rate_plan).toBeNull();
    expect(findPlan(result(), 99)).toBeNull();
    expect(findPlan(undefined, 7)).toBeNull();
  });

  test('lineProblem: كل سبب لرفض سطر مختار', () => {
    const line = newLine(0, { unit_type_id: 3, rate_plan_id: 7 });
    expect(lineProblem(newLine(1), undefined)).toBeNull(); // لم يُختَر شيء
    expect(lineProblem(line, result())).toBeNull();
    expect(lineProblem(line, undefined)).toMatch('مش متاح');
    expect(lineProblem(line, result({ capacity_ok: false }))).toMatch('سعة');
    expect(lineProblem(line, result({ available_units: 1 }), 1)).toMatch('وحدات فاضية');
    expect(lineProblem(line, result({ available_units: 2 }), 1)).toBeNull();
    expect(lineProblem({ ...line, rate_plan_id: 99 }, result())).toMatch('الخطة');
  });

  test('pricingRoom: ما يحتاجه التسعير فقط (بلا unit_id ولا خطة فارغة)', () => {
    expect(pricingRoom(newLine(0, { unit_type_id: 3, rate_plan_id: 7, unit_id: 21, adults: 3, children: 1 })))
      .toEqual({ unit_type_id: 3, adults: 3, children: 1, rate_plan_id: 7 });
    expect(pricingRoom(newLine(0, { unit_type_id: 3, rate_plan_id: null }))).toEqual({ unit_type_id: 3, adults: 2, children: 0 });
  });

  test('quoteTotals يحوّل معاينة السيرفر لأسماء حقول الحجز (فيعرضها totalsRows كما تُعرض الحجوزات)', () => {
    const quote = {
      deposit_due_minor: 57_456,
      totals: {
        service_charge_minor: 18_000, tax_minor: 23_520, city_fee_minor: 0, total_minor: 191_520,
        breakdown: { rooms_minor: 150_000, extra_guest_minor: 0, meal_minor: 0, extras_minor: 0, discount_minor: 0 },
      },
    };
    const totals = quoteTotals(quote);
    expect(totals).toEqual({
      rooms_minor: 150_000, extra_guest_minor: 0, meal_minor: 0, extras_minor: 0, discount_minor: 0,
      service_charge_minor: 18_000, tax_minor: 23_520, city_fee_minor: 0, total_minor: 191_520, deposit_due_minor: 57_456,
    });
    expect(totalsRows(totals).rows.reduce((sum, row) => sum + row.minor, 0)).toBe(191_520);
  });
});

describe('صفوف الإجماليات', () => {
  const sum = (rows) => rows.reduce((total, row) => total + row.minor, 0);

  test('الأسعار غير الشاملة: مجموع الصفوف = الإجمالي (الخدمة والضريبة صفوف إضافية)', () => {
    const r = {
      rooms_minor: 100_000, extra_guest_minor: 0, meal_minor: 0, extras_minor: 20_000, discount_minor: 0,
      service_charge_minor: 14_400, tax_minor: 18_816, city_fee_minor: 0, total_minor: 153_216,
    };
    const { rows, included } = totalsRows(r);
    expect(rows.map((row) => row.key)).toEqual(['rooms', 'extras', 'service', 'tax']); // الأصفار تختفي
    expect(sum(rows)).toBe(r.total_minor);
    expect(included).toEqual([]);
  });

  test('الأسعار الشاملة: الخدمة والضريبة «منها» ولا تُجمع', () => {
    const r = {
      rooms_minor: 100_000, extra_guest_minor: 0, meal_minor: 0, extras_minor: 20_000, discount_minor: 10_000,
      service_charge_minor: 9_000, tax_minor: 11_000, city_fee_minor: 5_000, total_minor: 115_000,
    };
    const { rows, included } = totalsRows(r, { inclusive: true });
    expect(sum(rows)).toBe(r.total_minor); // 100000 + 20000 − 10000 + 5000
    expect(rows.find((row) => row.key === 'discount').minor).toBe(-10_000);
    expect(included.map((row) => row.key)).toEqual(['service', 'tax']);
  });
});

describe('جسم طلب الحجز', () => {
  const base = () => ({
    stay: { check_in: '2026-10-14', check_out: '2026-10-16' },
    lines: [newLine(0, { unit_type_id: 3, rate_plan_id: 7 })],
    guest: { kind: 'new' },
    guestValues: { full_name: ' منى أحمد ', phone: '٠١٠١٢٣٤٥٦٧٨', email: '', nationality: '', id_type: '', id_number: '' },
    promoCode: ' save10 ',
    details: { status: 'confirmed', source: 'phone', external_ref: '', expected_arrival: '', guest_notes: '', internal_notes: '', send_confirmation: true },
    deposit: { enabled: false, method: 'cash', amount_minor: null, reference: '' },
    override: { restrictions: false, blacklist: false },
  });

  test('نزيل جديد: الحقول الفارغة تُحذف ولا يُرسَل id_type فارغًا', () => {
    const payload = buildReservationPayload(base());
    expect(payload.guest).toEqual({ full_name: 'منى أحمد', phone: '01012345678' });
    expect(payload.guest).not.toHaveProperty('id_type');
    expect(payload.guest).not.toHaveProperty('birth_date');
    expect(payload.promo_code).toBe('SAVE10');
    for (const key of ['deposit', 'override', 'external_ref', 'expected_arrival', 'guest_notes', 'internal_notes']) {
      expect(payload).not.toHaveProperty(key);
    }
    expect(payload).toMatchObject({ check_in: '2026-10-14', check_out: '2026-10-16', status: 'confirmed', source: 'phone', send_confirmation: true });
  });

  test('الغرفة: لا unit_id ولا rate_plan_id فارغَين (السيرفر يرفض null في unit_id)', () => {
    const auto = buildReservationPayload(base()).rooms[0];
    expect(auto).toEqual({ unit_type_id: 3, adults: 2, children: 0, rate_plan_id: 7 });
    expect(auto).not.toHaveProperty('unit_id');

    const noPlan = buildReservationPayload({ ...base(), lines: [newLine(0, { unit_type_id: 3, rate_plan_id: null, unit_id: 21 })] }).rooms[0];
    expect(noPlan).not.toHaveProperty('rate_plan_id');
    expect(noPlan.unit_id).toBe(21);
  });

  test('نزيل مسجَّل: المعرّف فقط. وغرف متعدّدة بضيوف مختلفين', () => {
    const payload = buildReservationPayload({
      ...base(),
      guest: { kind: 'existing', data: { id: 12, full_name: 'س' } },
      lines: [newLine(0, { unit_type_id: 3, rate_plan_id: 7, adults: 2 }), newLine(1, { unit_type_id: 4, rate_plan_id: 8, adults: 1, children: 2 })],
    });
    expect(payload.guest).toEqual({ id: 12 });
    expect(payload.rooms.map((room) => [room.adults, room.children])).toEqual([[2, 0], [1, 2]]);
  });

  test('الدفعة المقدّمة والتجاوزات والبيانات الاختيارية تُرسَل حين تُفعَّل فقط', () => {
    const payload = buildReservationPayload({
      ...base(),
      details: { ...base().details, status: 'pending', external_ref: ' BK-1 ', expected_arrival: '18:30', guest_notes: ' سرير إضافي ', internal_notes: '' },
      deposit: { enabled: true, method: 'instapay', amount_minor: 50_000, reference: ' TX9 ' },
      override: { restrictions: true, blacklist: false },
    });
    expect(payload).toMatchObject({
      status: 'pending', external_ref: 'BK-1', expected_arrival: '18:30', guest_notes: 'سرير إضافي',
      deposit: { method: 'instapay', amount_minor: 50_000, reference: 'TX9' },
      override: { restrictions: true },
    });
    expect(payload.override).not.toHaveProperty('blacklist');
    expect(payload).not.toHaveProperty('internal_notes');

    // دفعة مفعّلة بمبلغ صفر لا تُرسَل
    const zero = buildReservationPayload({ ...base(), deposit: { enabled: true, method: 'cash', amount_minor: 0, reference: '' } });
    expect(zero).not.toHaveProperty('deposit');
  });

  test('inlineGuest: الهوية والرقم بأرقام لاتينية والنوع عند اختياره فقط', () => {
    expect(inlineGuest({ full_name: 'علي', phone: '', email: ' a@b.co ', nationality: 'مصري', id_type: 'national_id', id_number: '٢٩٨٠١٠١' }))
      .toEqual({ full_name: 'علي', email: 'a@b.co', nationality: 'مصري', id_type: 'national_id', id_number: '2980101' });
  });

  test('رسائل أخطاء الحجز', () => {
    const rooms = [{ room: 1, violations: [{ code: 'MIN_STAY', message: 'الحدّ الأدنى 3 ليالٍ' }] }];
    expect(restrictionLines(rooms, 2)).toEqual(['غرفة 2: الحدّ الأدنى 3 ليالٍ']);
    expect(restrictionLines(rooms, 1)).toEqual(['الحدّ الأدنى 3 ليالٍ']);
    expect(restrictionLines(undefined)).toEqual([]);
    expect(occupiedSummary([
      { guest_name: 'علي', reservation_code: 'NZ-1' }, { guest_name: 'علي', reservation_code: 'NZ-1' }, { guest_name: null, block_reason: 'maintenance' },
    ])).toBe('مشغولة بسبب: علي (NZ-1)، حجب على الوحدة');
    expect(occupiedSummary([])).toBe('');
  });
});

describe('الإجراءات المتاحة', () => {
  const act = (overrides, options = {}) => reservationActions(reservation(overrides), { today: TODAY, can: everything, ...options });

  test('معلّق: تأكيد وإلغاء، ولا دخول ولا فاتورة', () => {
    const actions = act({ status: 'pending' });
    expect(actions).toMatchObject({ confirm: true, cancel: true, checkIn: false, noShow: false, issueInvoice: false });
  });

  test('مؤكّد: الدخول حتى قبل المغادرة، وعدم الحضور بعد يوم الوصول فقط', () => {
    expect(act({ check_in: '2026-10-12' })).toMatchObject({ checkIn: true, noShow: false });
    expect(act({ check_in: '2026-10-20', check_out: '2026-10-22' })).toMatchObject({ checkIn: true, noShow: false });
    expect(act({ check_in: '2026-10-10', check_out: '2026-10-14' })).toMatchObject({ checkIn: true, noShow: true });
    expect(act({ check_in: '2026-10-10', check_out: '2026-10-12' })).toMatchObject({ checkIn: false, noShow: true }); // انتهت الفترة
  });

  test('مقيم: خروج ونقل وتعديل تواريخ، بلا إلغاء', () => {
    expect(act({ status: 'checked_in' })).toMatchObject({ checkOut: true, move: true, changeDates: true, cancel: false, checkIn: false });
  });

  test('ملغي: لا بنود ولا تعديل، لكن دفعة/مرتجع وفاتورة الغرامة ممكنة', () => {
    expect(act({ status: 'cancelled' })).toMatchObject({ addItem: false, changeDates: false, move: false, addPayment: true, issueInvoice: true });
  });

  test('فاتورة سارية تمنع إصدار أخرى؛ والملغاة لا', () => {
    expect(act({ invoices: [{ status: 'issued' }] }).issueInvoice).toBe(false);
    expect(act({ invoices: [{ status: 'void' }] }).issueInvoice).toBe(true);
  });

  test('الصلاحيات: مشاهد القراءة فقط لا يملك أي إجراء', () => {
    const viewer = act({}, { can: (permission) => permission.endsWith('.read') });
    expect(Object.values(viewer).some(Boolean)).toBe(false);
    const accountant = act({ status: 'checked_out' }, { can: (permission) => permission.startsWith('billing.') });
    expect(accountant).toMatchObject({ addPayment: true, voidPayment: true, issueInvoice: true, confirm: false, edit: false });
  });
});

describe('مراجعة الدخول والخروج', () => {
  test('وصول اليوم: الغرفة غير النظيفة والخارجة عن الخدمة', () => {
    const dirty = checkInReview(reservation({ segments: [segment({ housekeeping_status: 'dirty' })] }), TODAY);
    expect(dirty).toMatchObject({ early: false, ended: false, idMissing: false });
    expect(dirty.notReady).toHaveLength(1);
    expect(dirty.outOfOrder).toHaveLength(0);

    const broken = checkInReview(reservation({ segments: [segment({ unit_status: 'out_of_order', housekeeping_status: 'dirty' })] }), TODAY);
    expect(broken.outOfOrder).toHaveLength(1);
    expect(broken.notReady).toHaveLength(0); // الخارجة عن الخدمة مشكلة أكبر ولا تُعدّ مرّتين
  });

  test('وصول مبكّر: الليالي المضافة ووحدة أول ليلة', () => {
    const review = checkInReview(reservation({
      check_in: '2026-10-14', check_out: '2026-10-18',
      segments: [segment({ id: 1, unit_code: '101', check_in: '2026-10-14', check_out: '2026-10-16' }), segment({ id: 2, unit_code: '102', check_in: '2026-10-16', check_out: '2026-10-18' })],
    }), TODAY);
    expect(review).toMatchObject({ early: true, earlyNights: 2 });
    expect(review.units.map((unit) => unit.unit_code)).toEqual(['101']);
  });

  test('انتهت الفترة، وهوية ناقصة', () => {
    expect(checkInReview(reservation({ check_in: '2026-10-08', check_out: '2026-10-12' }), TODAY).ended).toBe(true);
    expect(checkInReview(reservation({ guest_id_number: null }), TODAY).idMissing).toBe(true);
  });

  test('الخروج: الرصيد والخروج المبكّر عند حدوده', () => {
    const r = (check_in, check_out, balance_minor = 0) => reservation({ check_in, check_out, balance_minor });
    expect(checkOutReview(r('2026-10-10', '2026-10-15', 5_000), TODAY)).toMatchObject({ balance: 5_000, remainingNights: 3, canDepartEarly: true });
    expect(checkOutReview(r('2026-10-12', '2026-10-15'), TODAY).canDepartEarly).toBe(false); // يوم الوصول نفسه
    expect(checkOutReview(r('2026-10-10', '2026-10-12'), TODAY)).toMatchObject({ remainingNights: 0, canDepartEarly: false }); // يوم المغادرة
    expect(checkOutReview(r('2026-10-10', '2026-10-15', -3_000), TODAY).balance).toBe(0); // زيادة مدفوعة ليست رصيدًا
  });
});

describe('نقل الغرفة والدفعات والخصم', () => {
  const two = reservation({
    status: 'checked_in',
    segments: [segment({ id: 1, check_in: '2026-10-09', check_out: '2026-10-12' }), segment({ id: 2, check_in: '2026-10-12', check_out: '2026-10-16' })],
  });

  test('الجزء الافتراضي: ما يشغله النزيل اليوم ثم أقرب قادم', () => {
    expect(defaultMoveSegment(two, TODAY).id).toBe(2);
    expect(defaultMoveSegment(two, '2026-10-10').id).toBe(1);
    expect(defaultMoveSegment(two, '2026-11-01').id).toBe(1); // فاتت كلها: الأول
    expect(defaultMoveSegment(reservation({ segments: [] }), TODAY)).toBeNull();
  });

  test('نافذة النقل: المقيم لا ينقل ليالي فاتت', () => {
    const seg = two.segments[1];
    expect(moveWindow(two, seg, '2026-10-13')).toEqual({ min: '2026-10-13', max: '2026-10-15' });
    expect(moveWindow({ ...two, status: 'confirmed' }, seg, '2026-10-13')).toEqual({ min: '2026-10-12', max: '2026-10-15' });
    // جزء فات كله: النافذة فارغة (min > max)
    const past = moveWindow(two, two.segments[0], TODAY);
    expect(past.min > past.max).toBe(true);
  });

  test('suggestedAmount: المتبقي للدفعة، والزائد للمرتجع', () => {
    expect(suggestedAmount('payment', { balance_minor: 5_000 })).toBe(5_000);
    expect(suggestedAmount('payment', { balance_minor: 0 })).toBeNull();
    expect(suggestedAmount('payment', { balance_minor: -100 })).toBeNull();
    expect(suggestedAmount('refund', { paid_minor: 30_000, total_minor: 20_000 })).toBe(10_000);
    expect(suggestedAmount('refund', { paid_minor: 10_000, total_minor: 20_000 })).toBeNull();
  });

  test('promoDiscountMinor: الخصم الترويجي = خصم الحجز − الخصومات اليدوية السارية', () => {
    const r = (overrides) => reservation({
      promo_code_id: 1, discount_minor: 15_000,
      items: [{ type: 'discount', amount_minor: -5_000, voided_at: null }, { type: 'charge', amount_minor: 9_000, voided_at: null }], ...overrides,
    });
    expect(promoDiscountMinor(r())).toBe(10_000);
    expect(promoDiscountMinor(r({ items: [{ type: 'discount', amount_minor: -5_000, voided_at: '2026-10-12T10:00:00Z' }] }))).toBe(15_000);
    expect(promoDiscountMinor(r({ promo_code_id: null }))).toBe(0);
    expect(promoDiscountMinor(r({ discount_minor: 4_000 }))).toBe(0); // لا يهبط تحت الصفر
  });
});
