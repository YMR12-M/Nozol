import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { query, queryOne } from '../src/config/db.js';
import { API, bearer, bootstrapOwner, makeApp, resetDatabase, shutdown } from './helpers.js';
import { day, get, makeHotel, mustBook, post } from './fixtures.js';

const { http } = makeApp();
let ctx;
let hotel;
let slug;
const base = () => `${API}/public/properties/${slug}`;

const guest = (overrides = {}) => ({ full_name: 'سارة أحمد', phone: '01012345678', email: 'sara@example.com', ...overrides });
const bookingBody = (overrides = {}) => ({
  guest: guest(),
  check_in: day(10),
  check_out: day(12),
  rooms: [{ unit_type_id: hotel.type.id, adults: 2, children: 0 }],
  accept_terms: true,
  ...overrides,
});

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http);
  hotel = await makeHotel(http, ctx.token, {
    rooms: 3,
    propertyOverrides: { email: 'front@hotel.test', phone: '0221234567', deposit_percent: 30, hold_hours: 24 },
  });
  slug = hotel.property.slug;
  await http.patch(hotel.base).set(bearer(ctx.token)).send({ public_booking_enabled: true }).expect(200);
});
after(shutdown);

describe('المعلومات والتوافر', () => {
  test('معلومات المنشأة بلا مصادقة، وبلا حقول داخلية', async () => {
    const response = await http.get(base());
    assert.equal(response.status, 200);
    const info = response.body.data;
    assert.equal(info.slug, slug);
    assert.equal(info.unit_types.length, 1);
    assert.equal(info.unit_types[0].base_price_minor, 100_000);
    for (const secret of ['id', 'uuid', 'organization_id', 'invoice_prefix', 'booking_prefix', 'status']) {
      assert.equal(info[secret], undefined, `لا نكشف ${secret}`);
    }
  });

  test('منشأة غير مفتوحة للحجز أو غير موجودة = 404 متطابق', async () => {
    const closed = await makeHotel(http, ctx.token, { rooms: 1 });
    const hidden = await http.get(`${API}/public/properties/${closed.property.slug}`);
    const missing = await http.get(`${API}/public/properties/nope-nope`);
    assert.equal(hidden.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual([hidden.body.message, hidden.body.code], [missing.body.message, missing.body.code]);
  });

  test('البحث العام: عروض قابلة للحجز فقط مع الأسعار', async () => {
    const response = await http.get(`${base()}/availability?check_in=${day(10)}&check_out=${day(12)}&adults=2`);
    assert.equal(response.status, 200);
    const [result] = response.body.data.results;
    assert.equal(result.available_units, 3);
    assert.equal(result.plans[0].totals.total_minor, 200_000);
  });

  test('عرض مخالف للقيود لا يظهر للضيف (يظهر للموظف مع السبب)', async () => {
    await post(http, hotel, '/price-rules', {
      unit_type_ids: [hotel.type.id], name: 'حد أدنى', start_date: day(60), end_date: day(70), kind: 'restriction_only', min_stay: 3,
    }).expect(201);
    const guestView = await http.get(`${base()}/availability?check_in=${day(61)}&check_out=${day(62)}&adults=2`);
    assert.equal(guestView.body.data.results.length, 0);
    const staffView = await get(http, hotel, `/availability?check_in=${day(61)}&check_out=${day(62)}&adults=2`);
    assert.equal(staffView.body.data.results[0].plans[0].bookable, false);
  });
});

describe('الحجز العام', () => {
  let created;

  test('حجز معلّق بمهلة وعربون، مع إشعارات للضيف والموظفين', async () => {
    const response = await http.post(`${base()}/bookings`).send(bookingBody());
    assert.equal(response.status, 201, JSON.stringify(response.body));
    created = response.body.data;
    assert.equal(created.status, 'pending');
    assert.equal(created.total_minor, 200_000);
    assert.equal(created.deposit_due_minor, 60_000, '30% عربون');
    assert.ok(created.hold_expires_at);
    assert.equal(created.guest_name, 'سارة أحمد');
    assert.equal(created.property.name_ar, hotel.property.name_ar);

    const templates = (await query('SELECT template, channel FROM notification_outbox WHERE property_id = ?', [hotel.property.id]))
      .map((row) => `${row.channel}:${row.template}`);
    assert.ok(templates.includes('email:booking_pending'), 'تأكيد استلام للضيف');
    assert.ok(templates.includes('email:new_booking_staff'), 'بريد للمنشأة');
    assert.ok(templates.includes('push:push'), 'Push للمالك');

    const source = await queryOne('SELECT source, status FROM reservations WHERE code = ?', [created.code]);
    assert.deepEqual([source.source, source.status], ['website', 'pending']);
  });

  test('حقول إجبارية: الموافقة على السياسة، وفخّ الروبوتات', async () => {
    const noTerms = await http.post(`${base()}/bookings`).send(bookingBody({ accept_terms: false }));
    assert.equal(noTerms.status, 422);
    const bot = await http.post(`${base()}/bookings`).send(bookingBody({ website: 'http://spam.example' }));
    assert.equal(bot.status, 422);
  });

  test('نزيل في القائمة السوداء: رسالة عامة لا تكشف السبب', async () => {
    const blacklisted = await post(http, hotel, '/guests', { full_name: 'ممنوع', phone: '01099998888', is_blacklisted: true });
    assert.equal(blacklisted.status, 201);
    const response = await http.post(`${base()}/bookings`).send(bookingBody({ guest: guest({ full_name: 'ممنوع', phone: '01099998888' }), check_in: day(30), check_out: day(31) }));
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'BOOKING_UNAVAILABLE');
    assert.ok(!response.body.message.includes('سوداء'));
  });

  test('ما نفد لا يُباع: الغرف تنتهي ثم 409', async () => {
    for (let i = 0; i < 2; i += 1) {
      await http.post(`${base()}/bookings`).send(bookingBody({ guest: guest({ full_name: `ضيف ${i}`, phone: `0102000000${i}`, email: undefined }), check_in: day(40), check_out: day(41) })).expect(201);
    }
    const third = await http.post(`${base()}/bookings`).send(bookingBody({ guest: guest({ full_name: 'ضيف ثالث', phone: '01020000009', email: undefined }), check_in: day(40), check_out: day(41) }));
    assert.equal(third.status, 201, 'الغرفة الثالثة متاحة');
    const fourth = await http.post(`${base()}/bookings`).send(bookingBody({ guest: guest({ full_name: 'ضيف رابع', phone: '01020000010', email: undefined }), check_in: day(40), check_out: day(41) }));
    assert.equal(fourth.status, 409);
    assert.equal(fourth.body.code, 'NO_AVAILABILITY');
  });

  test('الاطّلاع: الكود + آخر 4 أرقام الهاتف، والخطأ بنفس الرسالة', async () => {
    const found = await http.get(`${base()}/bookings/${created.public_code}?phone=5678`);
    assert.equal(found.status, 200);
    assert.equal(found.body.data.code, created.code);
    assert.equal(found.body.data.can_cancel, true);
    assert.equal(found.body.data.rooms.length, 1);

    const wrongPhone = await http.get(`${base()}/bookings/${created.public_code}?phone=0000`);
    const wrongCode = await http.get(`${base()}/bookings/ZZZZZZZZ?phone=5678`);
    assert.equal(wrongPhone.status, 404);
    assert.equal(wrongCode.status, 404);
    assert.deepEqual([wrongPhone.body.message, wrongPhone.body.code], [wrongCode.body.message, wrongCode.body.code]);
    assert.equal((await http.get(`${base()}/bookings/${created.public_code}?phone=12`)).status, 422);
  });

  test('الإلغاء الحرّ داخل المهلة يُحرّر الليالي ويُنبّه الموظفين', async () => {
    const cancel = await http.post(`${base()}/bookings/${created.public_code}/cancel`).send({ phone: '5678', reason: 'غيّرنا الخطة' });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.data.status, 'cancelled');

    const nights = await queryOne(
      'SELECT COUNT(*) AS n FROM unit_nights n JOIN reservation_units ru ON ru.id = n.reservation_unit_id JOIN reservations r ON r.id = ru.reservation_id WHERE r.code = ?',
      [created.code],
    );
    assert.equal(nights.n, 0);
    const again = await http.post(`${base()}/bookings/${created.public_code}/cancel`).send({ phone: '5678' });
    assert.equal(again.status, 409);
  });
});

describe('سياسة الإلغاء', () => {
  test('بعد انتهاء المهلة المجانية: 409 مع موعدها', async () => {
    const booking = await mustBook(http, hotel, { guest: { full_name: 'قريب', phone: '01033334444' }, check_in: day(1), check_out: day(2), status: 'confirmed' });
    const phone4 = '4444';
    const response = await http.post(`${base()}/bookings/${booking.public_code}/cancel`).send({ phone: phone4 });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'CANCEL_WINDOW_CLOSED');
    assert.ok(response.body.errors.free_cancel_until);
  });

  test('السعر غير القابل للاسترداد لا يُلغى إلكترونيًّا', async () => {
    const plan = await post(http, hotel, '/rate-plans', { code: 'NR', name_ar: 'غير قابل للاسترداد', is_refundable: false, discount_bps: 1000, is_public: true });
    assert.equal(plan.status, 201);
    const booking = await http.post(`${base()}/bookings`).send(bookingBody({
      guest: guest({ full_name: 'سعر خاص', phone: '01055556666', email: undefined }),
      check_in: day(50), check_out: day(52),
      rooms: [{ unit_type_id: hotel.type.id, rate_plan_id: plan.body.data.id, adults: 2, children: 0 }],
    }));
    assert.equal(booking.status, 201, JSON.stringify(booking.body));
    assert.equal(booking.body.data.total_minor, 180_000, 'خصم 10%');
    assert.equal(booking.body.data.can_cancel, false);

    const cancel = await http.post(`${base()}/bookings/${booking.body.data.public_code}/cancel`).send({ phone: '6666' });
    assert.equal(cancel.status, 409);
    assert.equal(cancel.body.code, 'NON_REFUNDABLE');
  });

  test('خطة غير علنية لا يحجز بها الضيف', async () => {
    const plan = await post(http, hotel, '/rate-plans', { code: 'STAFF', name_ar: 'للموظفين فقط', is_public: false });
    const response = await http.post(`${base()}/bookings`).send(bookingBody({
      guest: guest({ phone: '01077778888', email: undefined }), check_in: day(80), check_out: day(81),
      rooms: [{ unit_type_id: hotel.type.id, rate_plan_id: plan.body.data.id, adults: 2, children: 0 }],
    }));
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'BAD_RATE_PLAN');
  });
});

describe('CORS', () => {
  test('الواجهة العامة تقبل أي موقع (الـ widget) بلا كوكي، والخاصة تقبل نطاقاتنا فقط', async () => {
    const pub = await http.get(base()).set('Origin', 'https://some-hotel-site.com');
    assert.equal(pub.status, 200);
    assert.equal(pub.headers['access-control-allow-origin'], 'https://some-hotel-site.com');
    assert.equal(pub.headers['access-control-allow-credentials'], undefined);

    const priv = await http.get(`${API}/auth/me`).set('Origin', 'https://evil.example');
    assert.equal(priv.status, 403);
    assert.equal(priv.body.code, 'CORS');

    const ours = await http.get(`${API}/auth/me`).set('Origin', 'http://localhost:5180');
    assert.equal(ours.headers['access-control-allow-origin'], 'http://localhost:5180');
    assert.equal(ours.headers['access-control-allow-credentials'], 'true');
  });
});
