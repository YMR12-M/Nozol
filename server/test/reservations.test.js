import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { query, queryOne } from '../src/config/db.js';
import {
  API, bearer, bootstrapOwner, login, makeApp, resetDatabase, seedOrganization, seedUser, shutdown,
} from './helpers.js';
import {
  TODAY, book, day, get, makeHotel, mustBook, post,
} from './fixtures.js';

const { http } = makeApp();
let ctx;

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http);
});
after(shutdown);

const nightsLocked = async (propertyId) => (await queryOne(
  'SELECT COUNT(*) AS n FROM unit_nights n JOIN units u ON u.id = n.unit_id WHERE u.property_id = ?',
  [propertyId],
)).n;

describe('إنشاء الحجز والتسعير', () => {
  let hotel;
  before(async () => { hotel = await makeHotel(http, ctx.token); });

  test('حجز بسيط: وحدة تلقائية، كود تسلسلي، إجمالي الليالي، قفل الليالي', async () => {
    const reservation = await mustBook(http, hotel);
    assert.equal(reservation.code, 'NZ-000001');
    assert.match(reservation.public_code, /^[2-9A-HJ-NP-Z]{8}$/);
    assert.equal(reservation.status, 'confirmed');
    assert.equal(reservation.nights, 3);
    assert.equal(reservation.total_minor, 300_000);
    assert.equal(reservation.balance_minor, 300_000);
    assert.equal(reservation.segments.length, 1);
    assert.equal(reservation.segments[0].nights.length, 3);
    assert.equal(await nightsLocked(hotel.property.id), 3);
  });

  test('الكود التالي يتزايد، والنزيل العائد (نفس الهاتف) لا يتكرّر', async () => {
    const second = await mustBook(http, hotel, { check_in: day(20), check_out: day(21) });
    assert.equal(second.code, 'NZ-000002');
    const guests = await query('SELECT id FROM guests WHERE property_id = ?', [hotel.property.id]);
    assert.equal(guests.length, 1, 'نفس رقم الهاتف = نفس النزيل');
  });

  test('رسوم الأفراد: بالغ زائد وطفل', async () => {
    const reservation = await mustBook(http, hotel, {
      check_in: day(30), check_out: day(32), adults: 3, children: 1,
      rooms: [{ unit_type_id: hotel.type.id }],
    });
    // الليلة: 1000 + بالغ زائد 200 + طفل (لا أطفال مجانًا) 100 = 1300 ← ليلتان = 2600
    assert.equal(reservation.total_minor, 260_000);
  });

  test('التواريخ: المغادرة قبل الوصول، الماضي، أكثر من 90 ليلة', async () => {
    const inverted = await book(http, hotel, { check_in: day(15), check_out: day(14) });
    assert.equal(inverted.status, 422);
    const past = await book(http, hotel, { check_in: day(-3), check_out: day(-1) });
    assert.equal(past.status, 422);
    assert.equal(past.body.code, 'PAST_DATE');
    const long = await book(http, hotel, { check_in: day(5), check_out: day(120) });
    assert.equal(long.status, 422);
  });

  test('سعة زائدة تُرفض بسبب القيود', async () => {
    const response = await book(http, hotel, { adults: 5, rooms: [{ unit_type_id: hotel.type.id }] });
    assert.equal(response.status, 422);
    assert.equal(response.body.code, 'STAY_RESTRICTED');
  });
});

describe('منع الحجز المزدوج', () => {
  test('لا وحدات فاضية → 409', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 2 });
    await mustBook(http, hotel, { phone: undefined });
    await mustBook(http, hotel, { guest: { full_name: 'ثاني', phone: '01011111111' } });
    const third = await book(http, hotel, { guest: { full_name: 'ثالث', phone: '01022222222' } });
    assert.equal(third.status, 409);
    assert.equal(third.body.code, 'NO_AVAILABILITY');
    assert.equal(await nightsLocked(hotel.property.id), 6);
  });

  test('تزامن: 8 طلبات في نفس اللحظة على 3 غرف ← 3 ينجحون بالضبط ولا حجز مزدوج', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 3 });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      book(http, hotel, { guest: { full_name: `نزيل ${i}`, phone: `0100000000${i}` } })));

    const ok = results.filter((r) => r.status === 201);
    const failed = results.filter((r) => r.status !== 201);
    assert.equal(ok.length, 3, `النجاح لازم 3 بالضبط: ${results.map((r) => r.status).join(',')}`);
    assert.ok(failed.every((r) => r.status === 409), 'كل الفاشل 409 (لا 500)');

    // كل وحدة حُجزت مرّة واحدة لكل ليلة
    const dup = await query(
      `SELECT unit_id, night, COUNT(*) AS n FROM unit_nights n JOIN units u ON u.id = n.unit_id
        WHERE u.property_id = ? GROUP BY unit_id, night HAVING n > 1`,
      [hotel.property.id],
    );
    assert.equal(dup.length, 0);
    const units = new Set(ok.map((r) => r.body.data.segments[0].unit_id));
    assert.equal(units.size, 3, '3 حجوزات على 3 وحدات مختلفة');
  });

  test('اختيار غرفة بعينها مشغولة → 409 مع من يشغلها', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 2 });
    const first = await mustBook(http, hotel, { rooms: [{ unit_type_id: hotel.type.id, unit_id: hotel.units[0].id }] });
    const clash = await book(http, hotel, {
      guest: { full_name: 'آخر', phone: '01033333333' },
      check_in: day(11), check_out: day(12),
      rooms: [{ unit_type_id: hotel.type.id, unit_id: hotel.units[0].id }],
    });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'UNIT_NOT_AVAILABLE');
    assert.equal(clash.body.errors.occupied[0].reservation_code, first.code);
  });

  test('الأنسب: الغرفة الملاصقة لحجز قبلها أولًا (لا تفتيت)', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 3 });
    // الحجز الأول على 102 صراحةً (10 → 12)
    await mustBook(http, hotel, { check_in: day(10), check_out: day(12), rooms: [{ unit_type_id: hotel.type.id, unit_id: hotel.units[1].id }] });
    // التالي يبدأ يوم 12: الأنسب 102 (ملاصقة) لا 101 (فاضية تمامًا)
    const next = await mustBook(http, hotel, { guest: { full_name: 'ثاني', phone: '01044444444' }, check_in: day(12), check_out: day(14) });
    assert.equal(next.segments[0].unit_code, '102');
  });

  test('حجز بغرفتين: كلّهن أو لا شيء', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 2 });
    await mustBook(http, hotel, { check_in: day(10), check_out: day(12) }); // تشغل غرفة
    const triple = await book(http, hotel, {
      guest: { full_name: 'عائلة', phone: '01055555555' }, check_in: day(10), check_out: day(12),
      rooms: [{ unit_type_id: hotel.type.id }, { unit_type_id: hotel.type.id }],
    });
    assert.equal(triple.status, 409);
    // لم يتسرّب أي حجز ولا ليالٍ مقفولة من المحاولة الفاشلة
    const reservations = await query('SELECT id FROM reservations WHERE property_id = ?', [hotel.property.id]);
    assert.equal(reservations.length, 1);
    assert.equal(await nightsLocked(hotel.property.id), 2);

    const double = await mustBook(http, hotel, {
      guest: { full_name: 'عائلة', phone: '01055555555' }, check_in: day(20), check_out: day(22),
      rooms: [{ unit_type_id: hotel.type.id }, { unit_type_id: hotel.type.id }],
    });
    assert.equal(double.segments.length, 2);
    assert.equal(double.total_minor, 400_000);
  });
});

describe('الإلغاء وعدم الحضور', () => {
  let hotel;
  before(async () => { hotel = await makeHotel(http, ctx.token, { rooms: 1 }); });

  test('الإلغاء يحرّر الليالي، ويصفّر الإيراد، وتبقى الغرامة والمرتجع المستحق', async () => {
    const reservation = await mustBook(http, hotel);
    await post(http, hotel, `/reservations/${reservation.id}/payments`, { method: 'cash', amount_minor: 100_000 }).expect(201);

    const cancel = await post(http, hotel, `/reservations/${reservation.id}/cancel`, { reason: 'ظرف طارئ', fee_minor: 30_000 });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.data.reservation.status, 'cancelled');
    assert.equal(cancel.body.data.reservation.total_minor, 30_000, 'الإيراد صفر والغرامة فقط');
    assert.equal(cancel.body.data.refund_due_minor, 70_000);
    assert.equal(await nightsLocked(hotel.property.id), 0);

    // الوحدة عادت للبيع
    const again = await book(http, hotel, { guest: { full_name: 'تاني', phone: '01066666666' } });
    assert.equal(again.status, 201);
  });

  test('لا إلغاء لحجز مقيم أو مُلغى مسبقًا', async () => {
    const reservations = await query("SELECT id FROM reservations WHERE property_id = ? AND status = 'cancelled'", [hotel.property.id]);
    const twice = await post(http, hotel, `/reservations/${reservations[0].id}/cancel`, { reason: 'تاني' });
    assert.equal(twice.status, 409);
    assert.equal(twice.body.code, 'BAD_STATUS');
  });

  test('سبب الإلغاء مطلوب', async () => {
    const reservation = await mustBook(http, hotel, { guest: { full_name: 'ثالث', phone: '01077777777' }, check_in: day(40), check_out: day(41) });
    const response = await post(http, hotel, `/reservations/${reservation.id}/cancel`, {});
    assert.equal(response.status, 422);
    assert.ok(response.body.errors.reason);
  });

  test('عدم الحضور بعد يوم الوصول فقط', async () => {
    const future = await mustBook(http, hotel, { guest: { full_name: 'رابع', phone: '01088888888' }, check_in: day(50), check_out: day(51) });
    const early = await post(http, hotel, `/reservations/${future.id}/no-show`, {});
    assert.equal(early.status, 409);
    assert.equal(early.body.code, 'TOO_EARLY');
  });
});

describe('المدفوعات والورديات', () => {
  let hotel;
  let reservation;
  before(async () => {
    hotel = await makeHotel(http, ctx.token, { rooms: 2 });
    reservation = await mustBook(http, hotel);
  });

  test('دفعات متتالية تحدّث المدفوع والرصيد، والمرتجع لا يتجاوز المدفوع', async () => {
    const shift = await post(http, hotel, '/shifts/open', { opening_float_minor: 50_000 });
    assert.equal(shift.status, 201);

    const first = await post(http, hotel, `/reservations/${reservation.id}/payments`, { method: 'cash', amount_minor: 100_000 });
    assert.equal(first.status, 201);
    assert.equal(first.body.data.totals.paid_minor, 100_000);
    await post(http, hotel, `/reservations/${reservation.id}/payments`, { method: 'card', amount_minor: 50_000, reference: 'POS-1' }).expect(201);

    const tooMuch = await post(http, hotel, `/reservations/${reservation.id}/payments`, { type: 'refund', method: 'cash', amount_minor: 200_000 });
    assert.equal(tooMuch.status, 422);
    assert.equal(tooMuch.body.code, 'REFUND_EXCEEDS_PAID');

    const refund = await post(http, hotel, `/reservations/${reservation.id}/payments`, { type: 'refund', method: 'cash', amount_minor: 20_000 });
    assert.equal(refund.body.data.totals.paid_minor, 130_000);

    const detail = await get(http, hotel, `/reservations/${reservation.id}`);
    assert.equal(detail.body.data.balance_minor, 170_000);
  });

  test('إغلاق الوردية: المتوقّع = العهدة + النقد الداخل − المرتجع، والبطاقة لا تدخل النقد', async () => {
    const current = await get(http, hotel, '/shifts/current');
    assert.equal(current.body.data.expected_cash_minor, 50_000 + 100_000 - 20_000);

    const close = await post(http, hotel, '/shifts/close', { counted_cash_minor: 125_000, note: 'عجز 50' });
    assert.equal(close.status, 200);
    assert.equal(close.body.data.expected_cash_minor, 130_000);
    assert.equal(close.body.data.difference_minor, -5_000);
    assert.deepEqual(close.body.data.by_method.map((m) => m.method).sort(), ['card', 'cash']);

    const none = await get(http, hotel, '/shifts/current');
    assert.equal(none.body.data, null);
  });

  test('لا إلغاء لدفعة في وردية مقفولة، وإلغاء دفعة بلا وردية يعيد الرصيد', async () => {
    const [closed] = await query("SELECT id FROM payments WHERE reservation_id = ? AND method = 'cash' AND type = 'payment'", [reservation.id]);
    const blocked = await post(http, hotel, `/reservations/${reservation.id}/payments/${closed.id}/void`, { reason: 'خطأ إدخال' });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'SHIFT_CLOSED');

    const free = await post(http, hotel, `/reservations/${reservation.id}/payments`, { method: 'cash', amount_minor: 10_000 });
    const void1 = await post(http, hotel, `/reservations/${reservation.id}/payments/${free.body.data.payment.id}/void`, { reason: 'اتسجّلت بالغلط' });
    assert.equal(void1.status, 200);
    assert.equal(void1.body.data.totals.paid_minor, 130_000);
    const again = await post(http, hotel, `/reservations/${reservation.id}/payments/${free.body.data.payment.id}/void`, { reason: 'تاني' });
    assert.equal(again.status, 409);
  });

  test('الاستقبال لا يلغي دفعات (billing.void للمحاسب والمدير)', async () => {
    await seedUser({ organizationId: ctx.organizationId, role: 'front_desk', email: 'fd@pay.local', propertyIds: [hotel.property.id] });
    const desk = await login(http, 'fd@pay.local');
    const [payment] = await query('SELECT id FROM payments WHERE reservation_id = ? LIMIT 1', [reservation.id]);
    const response = await http.post(`${hotel.base}/reservations/${reservation.id}/payments/${payment.id}/void`)
      .set(bearer(desk.token)).send({ reason: 'محاولة' });
    assert.equal(response.status, 403);
  });
});

describe('بنود الفاتورة والضرائب', () => {
  test('خدمة من الكتالوج + خصم + رسم، وإلغاء بند يعيد الحساب', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 1 });
    const service = await post(http, hotel, '/services', { name_ar: 'غسيل', price_minor: 5_000 });
    assert.equal(service.status, 201);

    const reservation = await mustBook(http, hotel, { check_in: day(10), check_out: day(11) });
    const added = await post(http, hotel, `/reservations/${reservation.id}/items`, { kind: 'service', service_id: service.body.data.id, quantity: 3 });
    assert.equal(added.status, 201);
    assert.equal(added.body.data.totals.total_minor, 100_000 + 15_000);

    const discount = await post(http, hotel, `/reservations/${reservation.id}/items`, { kind: 'discount', description: 'مجاملة', amount_minor: 10_000 });
    assert.equal(discount.body.data.totals.total_minor, 105_000);

    const voided = await post(http, hotel, `/reservations/${reservation.id}/items/${added.body.data.item.id}/void`, { reason: 'ما استخدمش الخدمة' });
    assert.equal(voided.body.data.totals.total_minor, 90_000);
  });

  test('ضريبة 14% وخدمة 12%', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 1, propertyOverrides: { tax_bps: 1400, service_charge_bps: 1200 } });
    const reservation = await mustBook(http, hotel, { check_in: day(10), check_out: day(11) });
    assert.equal(reservation.rooms_minor, 100_000);
    assert.equal(reservation.service_charge_minor, 12_000);
    assert.equal(reservation.tax_minor, 14_000);
    assert.equal(reservation.total_minor, 126_000);
  });
});

describe('دخول وخروج النزيل', () => {
  let hotel;
  before(async () => { hotel = await makeHotel(http, ctx.token, { rooms: 2 }); });

  test('الدخول قبل الموعد مرفوض، ومع «وصول مبكر» يُنقل الوصول لليوم وتُسعَّر الليالي', async () => {
    const reservation = await mustBook(http, hotel, { check_in: day(2), check_out: day(4) });
    const early = await post(http, hotel, `/reservations/${reservation.id}/check-in`, {});
    assert.equal(early.status, 409);
    assert.equal(early.body.code, 'TOO_EARLY');

    const forced = await post(http, hotel, `/reservations/${reservation.id}/check-in`, { early: true });
    assert.equal(forced.status, 200);
    assert.equal(forced.body.data.reservation.status, 'checked_in');
    assert.equal(forced.body.data.reservation.check_in, TODAY);
    assert.equal(forced.body.data.reservation.nights, 4);
    assert.equal(forced.body.data.reservation.total_minor, 400_000);
    assert.equal(forced.body.data.warnings[0].code, 'GUEST_ID_MISSING');
  });

  test('الدخول لغرفة غير نظيفة يتطلّب تأكيدًا، وغير النشطة مرفوضة', async () => {
    const reservation = await mustBook(http, hotel, {
      guest: { full_name: 'نزيل تاني', phone: '01012121212' }, check_in: TODAY, check_out: day(1),
      rooms: [{ unit_type_id: hotel.type.id, unit_id: hotel.units[1].id }],
    });
    await http.patch(`${hotel.base}/units/${hotel.units[1].id}/housekeeping`).set(bearer(hotel.token)).send({ status: 'dirty' }).expect(200);

    const blocked = await post(http, hotel, `/reservations/${reservation.id}/check-in`, {});
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'UNIT_NOT_READY');

    const forced = await post(http, hotel, `/reservations/${reservation.id}/check-in`, { force_dirty: true });
    assert.equal(forced.status, 200);
  });

  test('الخروج: الرصيد المستحق يمنعه، والمدير يتجاوز، وتتحوّل الغرفة للتنظيف', async () => {
    const [stay] = await query("SELECT id FROM reservations WHERE property_id = ? AND status = 'checked_in' ORDER BY id LIMIT 1", [hotel.property.id]);
    const due = await post(http, hotel, `/reservations/${stay.id}/check-out`, {});
    assert.equal(due.status, 409);
    assert.equal(due.body.code, 'BALANCE_DUE');
    assert.equal(due.body.errors.balance_minor, 400_000);

    await post(http, hotel, `/reservations/${stay.id}/payments`, { method: 'cash', amount_minor: 400_000 }).expect(201);
    const out = await post(http, hotel, `/reservations/${stay.id}/check-out`, { early_departure: true });
    assert.equal(out.status, 200);
    assert.equal(out.body.data.reservation.status, 'checked_out');
    // خروج مبكّر: اتقصّرت الإقامة لليوم وحُرِّرت الليالي (اليوم > الوصول؟ الوصول = اليوم فلا تقصير)
    const [task] = await query("SELECT type, status, due_date FROM housekeeping_tasks WHERE reservation_id = ?", [stay.id]);
    assert.equal(task.type, 'checkout_clean');
    assert.equal(task.status, 'pending');
    const unit = await queryOne(
      'SELECT u.housekeeping_status FROM reservation_units ru JOIN units u ON u.id = ru.unit_id WHERE ru.reservation_id = ? LIMIT 1',
      [stay.id],
    );
    assert.equal(unit.housekeeping_status, 'dirty');

    const guest = await queryOne('SELECT total_stays, total_spent_minor FROM guests WHERE id = (SELECT guest_id FROM reservations WHERE id = ?)', [stay.id]);
    assert.equal(guest.total_stays, 1);
    assert.equal(guest.total_spent_minor, 400_000);
  });

  test('المغادرة برصيد غير مسدّد: المدير فقط', async () => {
    const [other] = await query("SELECT id FROM reservations WHERE property_id = ? AND status = 'checked_in' ORDER BY id LIMIT 1", [hotel.property.id]);
    await seedUser({ organizationId: ctx.organizationId, role: 'front_desk', email: 'fd@out.local', propertyIds: [hotel.property.id] });
    const desk = await login(http, 'fd@out.local');
    const blocked = await http.post(`${hotel.base}/reservations/${other.id}/check-out`).set(bearer(desk.token)).send({ allow_unpaid: true });
    assert.equal(blocked.status, 403);
    const allowed = await post(http, hotel, `/reservations/${other.id}/check-out`, { allow_unpaid: true });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.data.warnings.find((w) => w.code === 'UNPAID_BALANCE').balance_minor, 100_000);
  });
});

describe('تعديل التواريخ ونقل الغرفة', () => {
  test('تمديد وتقصير مع إعادة التسعير، وتعارض الليالي المضافة', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 2 });
    const a = await mustBook(http, hotel, { check_in: day(10), check_out: day(12), rooms: [{ unit_type_id: hotel.type.id, unit_id: hotel.units[0].id }] });
    await mustBook(http, hotel, { guest: { full_name: 'تالي', phone: '01099999999' }, check_in: day(13), check_out: day(15), rooms: [{ unit_type_id: hotel.type.id, unit_id: hotel.units[0].id }] });

    // تمديد ليلة (12 → 13) ممكن، ثم أخرى (13 → 14) تصطدم بالحجز التالي
    const extend = await post(http, hotel, `/reservations/${a.id}/change-dates`, { check_in: day(10), check_out: day(13) });
    assert.equal(extend.status, 200);
    assert.equal(extend.body.data.total_minor, 300_000);
    const clash = await post(http, hotel, `/reservations/${a.id}/change-dates`, { check_in: day(10), check_out: day(14) });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'UNIT_NOT_AVAILABLE');

    // allow_reassign ينقل لوحدة فاضية من نفس النوع
    const moved = await post(http, hotel, `/reservations/${a.id}/change-dates`, { check_in: day(10), check_out: day(14), allow_reassign: true });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.data.segments[0].unit_code, '102');
    assert.equal(moved.body.data.total_minor, 400_000);

    // تقصير: الليالي تتحرّر والمبلغ ينقص
    const shorten = await post(http, hotel, `/reservations/${a.id}/change-dates`, { check_in: day(11), check_out: day(13) });
    assert.equal(shorten.status, 200);
    assert.equal(shorten.body.data.nights, 2);
    assert.equal(shorten.body.data.total_minor, 200_000);
    const locked = await query(
      "SELECT n.night FROM unit_nights n JOIN reservation_units ru ON ru.id = n.reservation_unit_id WHERE ru.reservation_id = ? ORDER BY n.night",
      [a.id],
    );
    assert.deepEqual(locked.map((row) => row.night), [day(11), day(12)]);
  });

  test('الأسعار القديمة تُحفَظ عند التمديد (الليالي المضافة فقط بالسعر الجديد)', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 1 });
    const reservation = await mustBook(http, hotel, { check_in: day(10), check_out: day(12) });
    // ارتفع سعر النوع بعد الحجز
    await http.patch(`${hotel.base}/unit-types/${hotel.type.id}`).set(bearer(hotel.token)).send({ base_price_minor: 150_000 }).expect(200);
    const extended = await post(http, hotel, `/reservations/${reservation.id}/change-dates`, { check_in: day(10), check_out: day(13) });
    assert.equal(extended.body.data.total_minor, 100_000 * 2 + 150_000);
  });

  test('نقل غرفة كامل ونقل مقسوم لنزيل مقيم', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 3 });
    const upcoming = await mustBook(http, hotel, { check_in: day(10), check_out: day(12), rooms: [{ unit_type_id: hotel.type.id, unit_id: hotel.units[0].id }] });
    const whole = await post(http, hotel, `/reservations/${upcoming.id}/move`, { segment_id: upcoming.segments[0].id, to_unit_id: hotel.units[2].id });
    assert.equal(whole.status, 200);
    assert.equal(whole.body.data.reservation.segments.length, 1);
    assert.equal(whole.body.data.reservation.segments[0].unit_code, '103');
    const old = await queryOne('SELECT COUNT(*) AS n FROM unit_nights WHERE unit_id = ?', [hotel.units[0].id]);
    assert.equal(old.n, 0, 'الغرفة القديمة تحرّرت');

    // مقيم من اليوم لـ 4 ليالٍ، ينتقل بعد ليلتين
    const stay = await mustBook(http, hotel, {
      guest: { full_name: 'مقيم', phone: '01070707070' }, check_in: TODAY, check_out: day(4),
      rooms: [{ unit_type_id: hotel.type.id, unit_id: hotel.units[0].id }],
    });
    await post(http, hotel, `/reservations/${stay.id}/check-in`, {}).expect(200);
    const split = await post(http, hotel, `/reservations/${stay.id}/move`, {
      segment_id: stay.segments[0].id, to_unit_id: hotel.units[1].id, effective_date: day(2),
    });
    assert.equal(split.status, 200, JSON.stringify(split.body));
    const segments = split.body.data.reservation.segments;
    assert.equal(segments.length, 2);
    assert.deepEqual(segments.map((s) => [s.unit_code, s.check_in, s.check_out]), [
      ['101', TODAY, day(2)], ['102', day(2), day(4)],
    ]);
    assert.equal(split.body.data.reservation.total_minor, 400_000, 'السعر لا يتغيّر بنقل نفس النوع');

    // لا نقل لليالٍ فاتت: نزيل دخل منذ يومين (بتجاوز المدير لتسجيل أثر رجعي)
    const veteran = await mustBook(http, hotel, {
      guest: { full_name: 'نزيل قديم', phone: '01060606060' }, check_in: day(-2), check_out: day(2),
      rooms: [{ unit_type_id: hotel.type.id, unit_id: hotel.units[2].id }],
      override: { past: true },
    });
    await post(http, hotel, `/reservations/${veteran.id}/check-in`, {}).expect(200);
    const past = await post(http, hotel, `/reservations/${veteran.id}/move`, {
      segment_id: veteran.segments[0].id, to_unit_id: hotel.units[0].id, effective_date: day(-1),
    });
    assert.equal(past.status, 409);
    assert.equal(past.body.code, 'PAST_NIGHTS');
  });

  test('نقل إلى غرفة مشغولة لا يمسّ القديمة', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 2 });
    const a = await mustBook(http, hotel, { check_in: day(10), check_out: day(12), rooms: [{ unit_type_id: hotel.type.id, unit_id: hotel.units[0].id }] });
    await mustBook(http, hotel, { guest: { full_name: 'نزيل ب', phone: '01081818181' }, check_in: day(11), check_out: day(13), rooms: [{ unit_type_id: hotel.type.id, unit_id: hotel.units[1].id }] });

    const blocked = await post(http, hotel, `/reservations/${a.id}/move`, { segment_id: a.segments[0].id, to_unit_id: hotel.units[1].id });
    assert.equal(blocked.status, 409);
    const still = await get(http, hotel, `/reservations/${a.id}`);
    assert.equal(still.body.data.segments[0].unit_code, '101');
    assert.equal((await queryOne('SELECT COUNT(*) AS n FROM unit_nights WHERE unit_id = ?', [hotel.units[0].id])).n, 2);
  });
});

describe('قيود التسعير والخصومات', () => {
  test('حدّ أدنى للإقامة: يرفض الاستقبال، ويتجاوز المدير', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 2 });
    await post(http, hotel, '/price-rules', {
      unit_type_ids: [hotel.type.id], name: 'موسم', start_date: day(5), end_date: day(60), kind: 'restriction_only', min_stay: 3,
    }).expect(201);

    const short = await book(http, hotel, { check_in: day(10), check_out: day(11) });
    assert.equal(short.status, 422);
    assert.equal(short.body.code, 'STAY_RESTRICTED');
    assert.equal(short.body.errors.rooms[0].violations[0].code, 'MIN_STAY');

    await seedUser({ organizationId: ctx.organizationId, role: 'front_desk', email: 'fd@rules.local', propertyIds: [hotel.property.id] });
    const desk = await login(http, 'fd@rules.local');
    const denied = await http.post(`${hotel.base}/reservations`).set(bearer(desk.token)).send({
      guest: { full_name: 'نزيل ن', phone: '01090909090' }, check_in: day(10), check_out: day(11), adults: 2,
      rooms: [{ unit_type_id: hotel.type.id }], override: { restrictions: true },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'OVERRIDE_FORBIDDEN');

    const manager = await book(http, hotel, { check_in: day(10), check_out: day(11), override: { restrictions: true } });
    assert.equal(manager.status, 201);
  });

  test('قاعدة موسمية تغيّر السعر، والخصم الترويجي يُستهلك ويُسترجع بالإلغاء', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 2 });
    await post(http, hotel, '/price-rules', {
      unit_type_ids: [hotel.type.id], name: 'ذروة', start_date: day(10), end_date: day(10), kind: 'set_price', price_minor: 200_000, priority: 5,
    }).expect(201);
    await post(http, hotel, '/promo-codes', { code: 'save10', discount_type: 'percent', value: 1000, max_uses: 1 }).expect(201);

    const reservation = await mustBook(http, hotel, { check_in: day(10), check_out: day(12), promo_code: 'save10' });
    // ليلة ذروة 2000 + ليلة 1000 = 3000 − 10% = 2700
    assert.equal(reservation.rooms_minor, 300_000);
    assert.equal(reservation.discount_minor, 30_000);
    assert.equal(reservation.total_minor, 270_000);

    const exhausted = await book(http, hotel, { guest: { full_name: 'ثاني', phone: '01012012012' }, check_in: day(20), check_out: day(21), promo_code: 'save10' });
    assert.equal(exhausted.status, 422);
    assert.equal(exhausted.body.code, 'PROMO_EXHAUSTED');

    await post(http, hotel, `/reservations/${reservation.id}/cancel`, { reason: 'تجربة' }).expect(200);
    const reuse = await book(http, hotel, { guest: { full_name: 'ثالث', phone: '01013013013' }, check_in: day(20), check_out: day(21), promo_code: 'SAVE10' });
    assert.equal(reuse.status, 201, 'الكود رجع بعد الإلغاء');
  });

  test('نزيل في القائمة السوداء: يتطلّب تجاوز المدير', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 2 });
    const guest = await http.post(`${hotel.base}/guests`).set(bearer(hotel.token)).send({ full_name: 'ممنوع', phone: '01014014014', is_blacklisted: true });
    const blocked = await book(http, hotel, { guest: { id: guest.body.data.id } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'GUEST_BLACKLISTED');
    const forced = await book(http, hotel, { guest: { id: guest.body.data.id }, override: { blacklist: true } });
    assert.equal(forced.status, 201);
  });
});

describe('الحجوزات المعلّقة وانتهاء المهلة', () => {
  test('تُحرَّر بعد المهلة، ولا تُحرَّر لو فيها مال', async () => {
    const { expireHolds } = await import('../src/modules/reservations/reservations.service.js');
    const hotel = await makeHotel(http, ctx.token, { rooms: 2 });

    const free = await mustBook(http, hotel, { status: 'pending', check_in: day(10), check_out: day(12) });
    const paid = await mustBook(http, hotel, { status: 'pending', guest: { full_name: 'دفع', phone: '01015015015' }, check_in: day(10), check_out: day(12) });
    await post(http, hotel, `/reservations/${paid.id}/payments`, { method: 'bank_transfer', amount_minor: 50_000 }).expect(201);
    assert.ok(free.hold_expires_at);

    await query("UPDATE reservations SET hold_expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE property_id = ?", [hotel.property.id]);
    const expired = await expireHolds();
    assert.equal(expired, 1);

    assert.equal((await get(http, hotel, `/reservations/${free.id}`)).body.data.status, 'cancelled');
    assert.equal((await get(http, hotel, `/reservations/${paid.id}`)).body.data.status, 'pending');
    assert.equal(await nightsLocked(hotel.property.id), 2, 'ليالي الحجز المدفوع فقط');

    const confirmed = await post(http, hotel, `/reservations/${paid.id}/confirm`, {});
    assert.equal(confirmed.body.data.status, 'confirmed');
    assert.equal(confirmed.body.data.hold_expires_at, null);
  });
});

describe('الفواتير', () => {
  test('إصدار فاتورة مرقّمة بلقطة ثابتة، فاتورة واحدة سارية، وإلغاؤها لإعادة الإصدار', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 1 });
    const reservation = await mustBook(http, hotel, { check_in: day(10), check_out: day(12) });
    await post(http, hotel, `/reservations/${reservation.id}/items`, { kind: 'charge', description: 'ميني بار', unit_price_minor: 2_500, quantity: 2 }).expect(201);

    const issued = await post(http, hotel, `/reservations/${reservation.id}/invoices`, { bill_to_tax_id: '123456789' });
    assert.equal(issued.status, 201);
    assert.equal(issued.body.data.number, 'INV-000001');
    assert.equal(issued.body.data.total_minor, 205_000);
    assert.equal(issued.body.data.bill_to_name, 'نزيل اختبار');
    assert.ok(issued.body.data.lines.some((line) => line.description.startsWith('إقامة')));
    assert.ok(issued.body.data.lines.some((line) => line.description === 'ميني بار'));

    const duplicate = await post(http, hotel, `/reservations/${reservation.id}/invoices`, {});
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'INVOICE_EXISTS');

    await post(http, hotel, `/invoices/${issued.body.data.id}/void`, { reason: 'خطأ في الاسم' }).expect(200);
    const reissued = await post(http, hotel, `/reservations/${reservation.id}/invoices`, { bill_to_name: 'شركة الأمل' });
    assert.equal(reissued.body.data.number, 'INV-000002');
    assert.equal(reissued.body.data.bill_to_name, 'شركة الأمل');
  });

  test('لا فاتورة لحجز معلّق', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 1 });
    const pending = await mustBook(http, hotel, { status: 'pending' });
    const response = await post(http, hotel, `/reservations/${pending.id}/invoices`, {});
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'RESERVATION_PENDING');
  });
});

describe('معاينة سعر الحجز الكامل', () => {
  let hotel;
  before(async () => {
    hotel = await makeHotel(http, ctx.token, {
      rooms: 4,
      propertyOverrides: { tax_bps: 1400, service_charge_bps: 1200, tax_on_service_charge: true, deposit_percent: 30 },
    });
    await post(http, hotel, '/promo-codes', { code: 'FIX200', discount_type: 'fixed', value: 20_000 }).expect(201);
  });

  test('تطابق الحجز المُنشأ بالقرش: غرفتان بضيوف مختلفين وخصم ثابت يُطبَّق مرّة واحدة على المجموع', async () => {
    const body = {
      check_in: day(10), check_out: day(12), promo_code: 'FIX200',
      rooms: [{ unit_type_id: hotel.type.id, adults: 2 }, { unit_type_id: hotel.type.id, adults: 3, children: 1 }],
    };
    const preview = await post(http, hotel, '/reservations/quote', body);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const quote = preview.body.data;

    const created = await mustBook(http, hotel, body);
    assert.equal(quote.totals.total_minor, created.total_minor);
    assert.equal(quote.totals.service_charge_minor, created.service_charge_minor);
    assert.equal(quote.totals.tax_minor, created.tax_minor);
    assert.equal(quote.totals.breakdown.discount_minor, 20_000, 'الخصم الثابت مرّة واحدة لا لكل غرفة');
    assert.equal(created.discount_minor, 20_000);
    assert.deepEqual(quote.promo, { code: 'FIX200', valid: true, discount_minor: 20_000 });
    assert.equal(quote.rooms.length, 2);
    assert.equal(quote.rooms[1].adults, 3);
    assert.equal(quote.bookable, true);

    // العربون المطلوب يطابق ما يحسبه السيرفر لحجز معلّق بنفس المدخلات
    const pending = await mustBook(http, hotel, { ...body, status: 'pending' });
    assert.equal(pending.deposit_due_minor, quote.deposit_due_minor);
  });

  test('لا ترمي عند القيود أو الكود المرفوض: تُرجع السبب لتعرضه الواجهة', async () => {
    await post(http, hotel, '/price-rules', {
      unit_type_ids: [hotel.type.id], name: 'حدّ أدنى', start_date: day(40), end_date: day(60), kind: 'restriction_only', min_stay: 3,
    }).expect(201);
    const response = await post(http, hotel, '/reservations/quote', {
      check_in: day(45), check_out: day(46), promo_code: 'nope', rooms: [{ unit_type_id: hotel.type.id }],
    });
    assert.equal(response.status, 200);
    const quote = response.body.data;
    assert.equal(quote.bookable, false);
    assert.equal(quote.violations[0].room, 0);
    assert.equal(quote.violations[0].violations[0].code, 'MIN_STAY');
    assert.equal(quote.rooms[0].bookable, false);
    assert.equal(quote.promo.valid, false);
    assert.equal(quote.promo.discount_minor, 0);
    assert.equal(quote.totals.breakdown.discount_minor, 0);
  });

  test('تواريخ ماضية تُرفض، والمشاهد يعاين، ومن لا يقرأ الحجوزات لا يعاين', async () => {
    const past = await post(http, hotel, '/reservations/quote', { check_in: day(-3), check_out: day(-1), rooms: [{ unit_type_id: hotel.type.id }] });
    assert.equal(past.status, 422);
    assert.equal(past.body.code, 'PAST_DATE');

    const body = { check_in: day(70), check_out: day(72), rooms: [{ unit_type_id: hotel.type.id }] };
    await seedUser({ organizationId: ctx.organizationId, role: 'viewer', email: 'viewer@quote.local', propertyIds: [hotel.property.id] });
    await seedUser({ organizationId: ctx.organizationId, role: 'housekeeping', email: 'hk@quote.local', propertyIds: [hotel.property.id] });
    const viewer = await login(http, 'viewer@quote.local');
    const housekeeping = await login(http, 'hk@quote.local');
    assert.equal((await http.post(`${hotel.base}/reservations/quote`).set(bearer(viewer.token)).send(body)).status, 200);
    assert.equal((await http.post(`${hotel.base}/reservations/quote`).set(bearer(housekeeping.token)).send(body)).status, 403);
  });
});

describe('التوافر والتقويم والقوائم', () => {
  let hotel;
  before(async () => {
    hotel = await makeHotel(http, ctx.token, { rooms: 3 });
    await mustBook(http, hotel, { check_in: day(10), check_out: day(12) });
    await mustBook(http, hotel, { guest: { full_name: 'نزيل ب', phone: '01016016016' }, check_in: day(11), check_out: day(14) });
  });

  test('بحث التوافر: العدد المتاح والأسعار والقيود', async () => {
    const response = await get(http, hotel, `/availability?check_in=${day(11)}&check_out=${day(12)}&adults=2`);
    assert.equal(response.status, 200);
    const [result] = response.body.data.results;
    assert.equal(result.available_units, 1, 'غرفتان مشغولتان ليلة 11');
    assert.equal(result.plans[0].totals.total_minor, 100_000);
    assert.equal(result.plans[0].bookable, true);

    const free = await get(http, hotel, `/availability?check_in=${day(30)}&check_out=${day(31)}&adults=2`);
    assert.equal(free.body.data.results[0].available_units, 3);
  });

  test('عرض سعر مع كود خصم غير صالح يشرح السبب ولا يطبّقه', async () => {
    const response = await post(http, hotel, '/quote', {
      unit_type_id: hotel.type.id, check_in: day(30), check_out: day(32), adults: 2, promo_code: 'NOPE',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.promo.valid, false);
    assert.equal(response.body.data.totals.total_minor, 200_000);
  });

  test('الوحدات الفاضية لنوع وتواريخ: الأنسب أولًا، واستثناء حجز بعينه عند تعديله', async () => {
    const units = (query) => get(http, hotel, `/availability/units?unit_type_id=${hotel.type.id}&${query}`);

    // ليلة 11: غرفتان مشغولتان من ثلاث
    const night11 = await units(`check_in=${day(11)}&check_out=${day(12)}`);
    assert.equal(night11.status, 200);
    assert.deepEqual(night11.body.data.map((unit) => unit.code), ['103']);
    assert.deepEqual(Object.keys(night11.body.data[0]).sort(), ['code', 'floor', 'housekeeping_status', 'id']);

    // ليلة 12: 101 فاضية وملاصقة لإشغالها السابق فتتقدّم على 103 الفارغة تمامًا (أقل تفتيتًا للتقويم)
    const night12 = await units(`check_in=${day(12)}&check_out=${day(13)}`);
    assert.deepEqual(night12.body.data.map((unit) => unit.code), ['101', '103']);

    assert.equal((await units(`check_in=${day(30)}&check_out=${day(31)}`)).body.data.length, 3);

    // ليلة 10 يشغلها الحجز الأول وحده؛ استثناؤه (تعديل الحجز) يعيد الغرف الثلاث فاضية
    const first = (await get(http, hotel, '/reservations?order=asc')).body.data[0];
    assert.equal((await units(`check_in=${day(10)}&check_out=${day(11)}`)).body.data.length, 2);
    assert.equal((await units(`check_in=${day(10)}&check_out=${day(11)}&exclude_reservation_id=${first.id}`)).body.data.length, 3);

    // نافذة غير منطقية أو نوع ناقص ← رفض
    assert.equal((await units(`check_in=${day(12)}&check_out=${day(12)}`)).status, 422);
    assert.equal((await get(http, hotel, `/availability/units?check_in=${day(12)}&check_out=${day(13)}`)).status, 422);
  });

  test('التقويم: مقاطع الإشغال مع الغرف', async () => {
    const response = await get(http, hotel, `/calendar?from=${day(9)}&to=${day(16)}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.units.length, 3);
    assert.equal(response.body.data.stays.length, 2);
    assert.equal(response.body.data.stays[0].reservation.guest_name, 'نزيل اختبار');
    const tooLong = await get(http, hotel, `/calendar?from=${day(0)}&to=${day(100)}`);
    assert.equal(tooLong.status, 400);
  });

  test('قائمة الحجوزات: فلاتر الحالة والبحث والمغادرون والوصول', async () => {
    const all = await get(http, hotel, '/reservations');
    assert.equal(all.body.meta.total, 2);
    assert.ok(all.body.data[0].unit_codes);

    const search = await get(http, hotel, '/reservations?q=01016016016');
    assert.equal(search.body.data.length, 1);
    assert.equal(search.body.data[0].guest_name, 'نزيل ب');

    const arriving = await get(http, hotel, `/reservations?arriving=${day(10)}`);
    assert.equal(arriving.body.data.length, 1);

    const stayOn = await get(http, hotel, `/reservations?stay_on=${day(11)}`);
    assert.equal(stayOn.body.data.length, 2);

    const byStatus = await get(http, hotel, '/reservations?status=cancelled,no_show');
    assert.equal(byStatus.body.data.length, 0);
  });
});

describe('العزل والصلاحيات', () => {
  test('منظّمة أخرى لا ترى الحجز، والمشاهد لا يكتب', async () => {
    const hotel = await makeHotel(http, ctx.token, { rooms: 1 });
    const reservation = await mustBook(http, hotel);

    const otherOrg = await seedOrganization('منافس');
    await seedUser({ organizationId: otherOrg, role: 'owner', email: 'rival@res.local' });
    const rival = await login(http, 'rival@res.local');
    const peek = await http.get(`${hotel.base}/reservations/${reservation.id}`).set(bearer(rival.token));
    assert.equal(peek.status, 404);

    await seedUser({ organizationId: ctx.organizationId, role: 'viewer', email: 'viewer@res.local', propertyIds: [hotel.property.id] });
    const viewer = await login(http, 'viewer@res.local');
    const read = await http.get(`${hotel.base}/reservations/${reservation.id}`).set(bearer(viewer.token));
    assert.equal(read.status, 200);
    const write = await http.post(`${hotel.base}/reservations/${reservation.id}/cancel`).set(bearer(viewer.token)).send({ reason: 'محاولة' });
    assert.equal(write.status, 403);
    assert.equal(API, '/api/v1');
  });
});
