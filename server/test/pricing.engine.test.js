import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTotals, depositDue, evaluateStay, nightlyRoomPrice, priceUnitStay, promoDiscount,
  reservationLines, validatePromo,
} from '../src/modules/pricing/engine.js';

// 2026-10-04 أحد · 08 خميس · 09 جمعة · 10 سبت
const unitType = {
  base_price_minor: 100_000, // 1000 جنيه
  base_adults: 2, free_children: 1,
  max_adults: 3, max_children: 2, max_occupancy: 4,
  extra_adult_minor: 20_000, extra_child_minor: 10_000,
};
const FRI_SAT = (1 << 5) | (1 << 6);

const rule = (overrides) => ({
  id: 1, rate_plan_id: null, kind: 'set_price', price_minor: 0, percent_bps: 0,
  start_date: '2026-01-01', end_date: '2026-12-31', dow_mask: 127, priority: 0, is_active: 1,
  min_stay: null, max_stay: null, closed_to_arrival: 0, closed_to_departure: 0, stop_sell: 0,
  ...overrides,
});

const price = (extra = {}) => priceUnitStay({
  unitType, rules: [], checkIn: '2026-10-05', checkOut: '2026-10-08', adults: 2, children: 0, ...extra,
});

describe('سعر الليلة', () => {
  test('بلا قواعد: السعر الأساسي × عدد الليالي', () => {
    const stay = price();
    assert.equal(stay.nights.length, 3);
    assert.equal(stay.rooms_minor, 300_000);
    assert.deepEqual(stay.violations, []);
  });

  test('قاعدة موسمية تحدّد سعرًا للمدى فقط', () => {
    const stay = price({
      checkIn: '2026-10-04', checkOut: '2026-10-08',
      rules: [rule({ start_date: '2026-10-05', end_date: '2026-10-06', price_minor: 150_000 })],
    });
    assert.deepEqual(stay.nights.map((n) => n.room_minor), [100_000, 150_000, 150_000, 100_000]);
  });

  test('قاعدة نسبية على الجمعة والسبت فقط', () => {
    const stay = price({
      checkIn: '2026-10-08', checkOut: '2026-10-11',
      rules: [rule({ kind: 'percent_adjust', percent_bps: 2000, dow_mask: FRI_SAT })],
    });
    assert.deepEqual(stay.nights.map((n) => n.room_minor), [100_000, 120_000, 120_000]);
    assert.equal(stay.rooms_minor, 340_000);
  });

  test('تتعارض القواعد: الأعلى أولوية تفوز وحدها (لا تجمع)', () => {
    const stay = price({
      rules: [
        rule({ id: 1, price_minor: 90_000, priority: 1 }),
        rule({ id: 2, price_minor: 130_000, priority: 5 }),
      ],
    });
    assert.equal(stay.nights[0].room_minor, 130_000);
    assert.equal(stay.nights[0].rule_id, 2);
  });

  test('عند تساوي الأولوية: الخاصة بخطة السعر تفوز على العامّة', () => {
    const plan = { id: 7, meal_adult_minor: 0, meal_child_minor: 0, discount_bps: 0 };
    const rules = [
      rule({ id: 1, price_minor: 90_000, priority: 3 }),
      rule({ id: 2, price_minor: 110_000, priority: 3, rate_plan_id: 7 }),
    ];
    assert.equal(price({ rules, ratePlan: plan }).nights[0].room_minor, 110_000);
    assert.equal(price({ rules }).nights[0].room_minor, 90_000, 'بدون الخطة: العامّة فقط');
    assert.equal(price({ rules, ratePlan: { ...plan, id: 8 } }).nights[0].room_minor, 90_000, 'خطة أخرى لا تلتقط قاعدة غيرها');
  });

  test('قاعدة معطّلة لا تُطبَّق', () => {
    assert.equal(price({ rules: [rule({ price_minor: 1, is_active: 0 })] }).nights[0].room_minor, 100_000);
  });

  test('قاعدة قيود فقط لا تغيّر السعر', () => {
    const stay = price({ rules: [rule({ kind: 'restriction_only', min_stay: 2 })] });
    assert.equal(stay.rooms_minor, 300_000);
  });

  test('خصم خطة السعر (غير قابل للاسترداد) على الغرفة', () => {
    const plan = { id: 1, meal_adult_minor: 0, meal_child_minor: 0, discount_bps: 1000 };
    assert.equal(nightlyRoomPrice({ rule: null, unitType, ratePlan: plan }), 90_000);
    assert.equal(price({ ratePlan: plan }).rooms_minor, 270_000);
  });
});

describe('رسوم الأفراد والوجبات', () => {
  test('بالغ زائد وطفل زائد عن المشمول مجانًا', () => {
    // 3 بالغين (واحد زائد = 200) + طفلان (واحد مجاني، واحد = 100) → 300 جنيه/ليلة
    const stay = price({ adults: 3, children: 2 });
    assert.equal(stay.nights[0].extra_guest_minor, 30_000);
    assert.equal(stay.extra_guest_minor, 90_000);
  });

  test('وجبات الخطة للفرد في الليلة', () => {
    const plan = { id: 1, meal_adult_minor: 5_000, meal_child_minor: 2_500, discount_bps: 0 };
    const stay = price({ adults: 2, children: 1, ratePlan: plan });
    assert.equal(stay.nights[0].meal_minor, 12_500);
    assert.equal(stay.meal_minor, 37_500);
  });

  test('سعة زائدة تُسجَّل مخالفة', () => {
    const { violations } = evaluateStay({
      rules: [], unitType, checkIn: '2026-10-05', checkOut: '2026-10-07', adults: 4, children: 0,
    });
    assert.ok(violations.some((v) => v.code === 'OVER_CAPACITY'));
  });
});

describe('القيود', () => {
  const stay = (rules, checkIn, checkOut) => evaluateStay({
    rules, unitType, checkIn, checkOut, adults: 2, children: 0,
  });

  test('الحدّ الأدنى للإقامة يُقرأ من يوم الوصول', () => {
    const rules = [rule({ start_date: '2026-10-05', end_date: '2026-10-10', min_stay: 3 })];
    assert.equal(stay(rules, '2026-10-06', '2026-10-08').violations[0].code, 'MIN_STAY');
    assert.deepEqual(stay(rules, '2026-10-06', '2026-10-09').violations, []);
    // وصول خارج المدى: لا قيد حتى لو الإقامة تدخل فيه
    assert.deepEqual(stay(rules, '2026-10-04', '2026-10-06').violations, []);
  });

  test('إغلاق الوصول والمغادرة', () => {
    const cta = [rule({ start_date: '2026-10-09', end_date: '2026-10-09', closed_to_arrival: 1 })];
    assert.equal(stay(cta, '2026-10-09', '2026-10-11').violations[0].code, 'CLOSED_TO_ARRIVAL');
    assert.deepEqual(stay(cta, '2026-10-08', '2026-10-11').violations, []);

    const ctd = [rule({ start_date: '2026-10-12', end_date: '2026-10-12', closed_to_departure: 1 })];
    assert.equal(stay(ctd, '2026-10-10', '2026-10-12').violations[0].code, 'CLOSED_TO_DEPARTURE');
  });

  test('إيقاف البيع في ليلة داخل الإقامة يذكر التاريخ', () => {
    const rules = [rule({ start_date: '2026-10-07', end_date: '2026-10-07', stop_sell: 1 })];
    const result = stay(rules, '2026-10-06', '2026-10-09');
    assert.equal(result.violations[0].code, 'STOP_SELL');
    assert.deepEqual(result.violations[0].dates, ['2026-10-07']);
    // ليلة المغادرة ليست ليلة إقامة
    assert.deepEqual(stay(rules, '2026-10-05', '2026-10-07').violations, []);
  });

  test('الحدّ الأقصى للإقامة', () => {
    const rules = [rule({ max_stay: 2 })];
    assert.equal(stay(rules, '2026-10-05', '2026-10-09').violations[0].code, 'MAX_STAY');
  });
});

describe('الكود الترويجي', () => {
  const promo = {
    is_active: 1, discount_type: 'percent', value: 1000, min_nights: 2,
    valid_from: '2026-09-01', valid_to: '2026-10-31', stay_from: null, stay_to: null,
    max_uses: 10, uses_count: 3,
  };
  const check = (overrides = {}, dates = {}) => validatePromo({
    promo: { ...promo, ...overrides }, today: '2026-10-04', checkIn: '2026-11-05', checkOut: '2026-11-08', ...dates,
  });

  test('صالح', () => assert.equal(check().valid, true));

  test('رفض بسبب كل شرط على حدة', () => {
    assert.equal(check({ valid_to: '2026-10-01' }).code, 'PROMO_EXPIRED');
    assert.equal(check({ valid_from: '2026-10-05' }).code, 'PROMO_EXPIRED');
    assert.equal(check({ is_active: 0 }).code, 'PROMO_INVALID');
    assert.equal(check({ min_nights: 5 }).code, 'PROMO_MIN_NIGHTS');
    assert.equal(check({ uses_count: 10 }).code, 'PROMO_EXHAUSTED');
    assert.equal(check({ stay_from: '2026-12-01', stay_to: '2026-12-31' }).code, 'PROMO_STAY_WINDOW');
    assert.equal(validatePromo({ promo: null, today: '2026-10-04', checkIn: '2026-11-05', checkOut: '2026-11-08' }).code, 'PROMO_INVALID');
  });

  test('نافذة الإقامة: كل الليالي داخلها (آخر ليلة قبل المغادرة)', () => {
    const windowed = { stay_from: '2026-11-05', stay_to: '2026-11-07' };
    assert.equal(check(windowed).valid, true);
    assert.equal(check(windowed, { checkOut: '2026-11-09' }).code, 'PROMO_STAY_WINDOW');
  });

  test('حساب الخصم: نسبة ومبلغ ثابت لا يتجاوز الأساس', () => {
    assert.equal(promoDiscount({ promo, base: 300_000 }), 30_000);
    assert.equal(promoDiscount({ promo: { discount_type: 'fixed', value: 50_000 }, base: 300_000 }), 50_000);
    assert.equal(promoDiscount({ promo: { discount_type: 'fixed', value: 500_000 }, base: 300_000 }), 300_000);
    assert.equal(promoDiscount({ promo: null, base: 300_000 }), 0);
  });
});

describe('الإجماليات', () => {
  const lines = (amount = 100_000, flags = {}) => [{ type: 'room', amount_minor: amount, taxable: true, service_chargeable: true, ...flags }];
  const property = (overrides = {}) => ({
    tax_bps: 1400, service_charge_bps: 1200, tax_on_service_charge: 0, prices_include_tax: 0, city_fee_per_night_minor: 0, ...overrides,
  });

  test('حصري: الخدمة والضريبة على الأساس نفسه', () => {
    const totals = computeTotals({ lines: lines(), property: property() });
    assert.equal(totals.subtotal_minor, 100_000);
    assert.equal(totals.service_charge_minor, 12_000);
    assert.equal(totals.tax_minor, 14_000);
    assert.equal(totals.total_minor, 126_000);
  });

  test('حصري: الضريبة على الخدمة أيضًا', () => {
    const totals = computeTotals({ lines: lines(), property: property({ tax_on_service_charge: 1 }) });
    assert.equal(totals.service_charge_minor, 12_000);
    assert.equal(totals.tax_minor, 15_680); // 14% × 1120
    assert.equal(totals.total_minor, 127_680);
  });

  test('شامل: نستخلص الخدمة والضريبة من السعر المعروض بلا إضافة', () => {
    const plain = computeTotals({ lines: lines(126_000), property: property({ prices_include_tax: 1 }) });
    assert.equal(plain.subtotal_minor, 100_000);
    assert.equal(plain.service_charge_minor, 12_000);
    assert.equal(plain.tax_minor, 14_000);
    assert.equal(plain.total_minor, 126_000);

    const compound = computeTotals({ lines: lines(127_680), property: property({ prices_include_tax: 1, tax_on_service_charge: 1 }) });
    assert.equal(compound.subtotal_minor, 100_000);
    assert.equal(compound.service_charge_minor, 12_000);
    assert.equal(compound.tax_minor, 15_680);
    assert.equal(compound.total_minor, 127_680);
  });

  test('الخصم يُطرح قبل الخدمة والضريبة', () => {
    const items = [...lines(100_000), { type: 'discount', amount_minor: -10_000, taxable: true, service_chargeable: true }];
    const totals = computeTotals({ lines: items, property: property() });
    assert.equal(totals.subtotal_minor, 90_000);
    assert.equal(totals.service_charge_minor, 10_800);
    assert.equal(totals.tax_minor, 12_600);
    assert.equal(totals.breakdown.discount_minor, 10_000);
  });

  test('بند معفى من الضريبة والخدمة يمرّ كما هو', () => {
    const items = [...lines(100_000), { type: 'extra', amount_minor: 5_000, taxable: false, service_chargeable: false }];
    const totals = computeTotals({ lines: items, property: property() });
    assert.equal(totals.service_charge_minor, 12_000);
    assert.equal(totals.tax_minor, 14_000);
    assert.equal(totals.total_minor, 131_000);
  });

  test('رسم المدينة لكل وحدة-ليلة، بلا ضريبة ولا خدمة ولا خصم', () => {
    const totals = computeTotals({
      lines: lines(), unitNights: 6, property: property({ tax_bps: 0, service_charge_bps: 0, city_fee_per_night_minor: 500 }),
    });
    assert.equal(totals.city_fee_minor, 3_000);
    assert.equal(totals.total_minor, 103_000);
  });

  test('بلا ضرائب (الافتراضي): الإجمالي = مجموع البنود', () => {
    const totals = computeTotals({ lines: lines(), property: property({ tax_bps: 0, service_charge_bps: 0 }) });
    assert.equal(totals.total_minor, 100_000);
  });

  test('خاصيّة: صافي + خدمة + ضريبة + رسم = الإجمالي دائمًا، وفي الشامل الإجمالي = المعروض', () => {
    let seed = 20_261_004;
    const random = () => { seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296; return seed / 4_294_967_296; };

    for (let i = 0; i < 400; i += 1) {
      const prop = property({
        tax_bps: Math.round(random() * 2500),
        service_charge_bps: Math.round(random() * 2500),
        tax_on_service_charge: random() > 0.5 ? 1 : 0,
        prices_include_tax: random() > 0.5 ? 1 : 0,
      });
      const items = Array.from({ length: 1 + Math.floor(random() * 5) }, () => ({
        type: 'room',
        amount_minor: Math.round(random() * 2_000_000) - (random() > 0.85 ? 500_000 : 0),
        taxable: random() > 0.3,
        service_chargeable: random() > 0.3,
      }));
      const totals = computeTotals({ lines: items, unitNights: Math.floor(random() * 10), property: prop });

      assert.equal(
        totals.total_minor,
        totals.subtotal_minor + totals.service_charge_minor + totals.tax_minor + totals.city_fee_minor,
      );
      if (prop.prices_include_tax) {
        const shown = items.reduce((total, item) => total + item.amount_minor, 0);
        assert.equal(totals.subtotal_minor + totals.service_charge_minor + totals.tax_minor, shown);
      }
    }
  });
});

describe('بنود الحجز والعربون', () => {
  test('البنود الصفرية تُحذف، والخصم يدخل سالبًا، وأنواع بنود الفاتورة تُصنَّف', () => {
    const lines = reservationLines({
      stays: [{ rooms_minor: 300_000, extra_guest_minor: 0, meal_minor: 50_000 }],
      promoDiscountMinor: 30_000,
      folioItems: [
        { type: 'service', amount_minor: 20_000, taxable: 1, service_chargeable: 1 },
        { type: 'discount', amount_minor: -5_000, taxable: 1, service_chargeable: 1 },
        { type: 'fee', amount_minor: 10_000, taxable: 0, service_chargeable: 0 },
      ],
    });
    assert.deepEqual(lines.map((l) => l.type), ['room', 'meal', 'discount', 'extra', 'discount', 'fee']);
    assert.equal(lines.reduce((total, l) => total + l.amount_minor, 0), 345_000);
  });

  test('العربون بالنسبة', () => {
    assert.equal(depositDue(126_000, 30), 37_800);
    assert.equal(depositDue(126_001, 30), 37_800);
    assert.equal(depositDue(100_000, 0), 0);
  });
});
