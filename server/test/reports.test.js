import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, money } from '../src/utils/csv.js';
import { dayBoundsUtc, zonedToUtc } from '../src/utils/dates.js';
import {
  API, bearer, bootstrapOwner, makeApp, resetDatabase, shutdown,
} from './helpers.js';
import {
  TODAY, day, get, makeHotel, mustBook, post,
} from './fixtures.js';

const { http } = makeApp();
let ctx;
let hotel;

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http);
});
after(shutdown);

describe('مساعدات التوقيت والتصدير', () => {
  test('لحظة UTC لوقت على جدار القاهرة: صيفًا +3 وشتاءً +2', () => {
    assert.equal(zonedToUtc('2026-07-14', '14:00', 'Africa/Cairo').toISOString(), '2026-07-14T11:00:00.000Z');
    assert.equal(zonedToUtc('2026-01-14', '14:00', 'Africa/Cairo').toISOString(), '2026-01-14T12:00:00.000Z');
    assert.equal(zonedToUtc('2026-07-14', '14:00', 'UTC').toISOString(), '2026-07-14T14:00:00.000Z');
  });

  test('حدود اليوم بتوقيت المنشأة', () => {
    const { start, end } = dayBoundsUtc('2026-07-14', 'Africa/Cairo');
    assert.equal(start.toISOString(), '2026-07-13T21:00:00.000Z');
    assert.equal(end.toISOString(), '2026-07-14T21:00:00.000Z');
  });

  test('CSV: BOM، اقتباس الفواصل والاقتباسات، وتعطيل حقن الصيغ', () => {
    const csv = toCsv(
      [{ name: 'أحمد, علي', note: 'قال "مرحبًا"' }, { name: '=HYPERLINK("http://evil","x")', note: '+1+1' }, { name: '@SUM(A1)', note: '-2' }],
      [{ header: 'الاسم', value: (r) => r.name }, { header: 'ملاحظة', value: (r) => r.note }],
    );
    assert.ok(csv.startsWith('﻿'));
    // trim() يحذف BOM لأنه يُعدّ مسافة بيضاء، فنقصّه أولًا بعد التأكّد من وجوده
    const lines = csv.slice(1).trim().split('\r\n');
    assert.equal(lines[0], 'الاسم,ملاحظة');
    assert.equal(lines[1], '"أحمد, علي","قال ""مرحبًا"""');
    assert.ok(lines[2].startsWith(`"'=HYPERLINK`), 'الصيغة تُعرَض نصًّا');
    assert.ok(lines[2].includes(",'+1+1"));
    assert.ok(lines[3].startsWith("'@SUM"));
    assert.equal(money(12345), '123.45');
    assert.equal(money(null), '');
  });
});

describe('الإشغال والإيراد', () => {
  before(async () => {
    hotel = await makeHotel(http, ctx.token, { rooms: 4 });
    // أ: 10→12 (ليلتان) · ب: 11→13 (ليلتان) · ملغى لا يُحتسب · معلّق لا يُحتسب
    await mustBook(http, hotel, { guest: { full_name: 'أ أحمد', phone: '01010000001' }, check_in: day(10), check_out: day(12), source: 'direct' });
    await mustBook(http, hotel, { guest: { full_name: 'ب بهاء', phone: '01010000002' }, check_in: day(11), check_out: day(13), source: 'phone' });
    const cancelled = await mustBook(http, hotel, { guest: { full_name: 'ج جمال', phone: '01010000003' }, check_in: day(10), check_out: day(12) });
    await post(http, hotel, `/reservations/${cancelled.id}/cancel`, { reason: 'تجربة' }).expect(200);
    await mustBook(http, hotel, { guest: { full_name: 'د دعاء', phone: '01010000004' }, check_in: day(10), check_out: day(11), status: 'pending' });
    // الوحدة 104 محجوبة ليلة 11 (تخرج من المقام لا تُحسب خسارة إشغال)
    await post(http, hotel, `/units/${hotel.units[3].id}/blocks`, { start_date: day(11), end_date: day(12), reason: 'maintenance' }).expect(201);
  });

  test('الإشغال اليومي وADR وRevPAR والمقام بعد الحجب', async () => {
    const response = await get(http, hotel, `/reports/occupancy?from=${day(10)}&to=${day(12)}`);
    assert.equal(response.status, 200);
    const [d10, d11, d12] = response.body.data.days;

    assert.deepEqual([d10.occupied, d10.available], [1, 4], 'ليلة 10: حجز أ فقط (المعلّق لا يُحسب)');
    assert.deepEqual([d11.occupied, d11.available], [2, 3], 'ليلة 11: أ وب، والمتاح 3 بعد الحجب');
    assert.deepEqual([d12.occupied, d12.available], [1, 4], 'ليلة 12: ب فقط');
    assert.equal(d11.occupancy_pct, 66.7);

    const summary = response.body.data.summary;
    assert.equal(summary.occupied_nights, 4);
    assert.equal(summary.available_nights, 11);
    assert.equal(summary.occupancy_pct, 36.4);
    assert.equal(summary.room_revenue_minor, 400_000);
    assert.equal(summary.adr_minor, 100_000);
    assert.equal(summary.revpar_minor, Math.round(400_000 / 11));
  });

  test('الإيراد بالاستحقاق حسب المصدر والنوع، والنقدية والمصروفات منفصلة', async () => {
    const [first] = (await get(http, hotel, '/reservations?status=confirmed&order=asc')).body.data;
    await post(http, hotel, '/shifts/open', { opening_float_minor: 0 });
    await post(http, hotel, `/reservations/${first.id}/payments`, { method: 'cash', amount_minor: 120_000 }).expect(201);
    await post(http, hotel, `/reservations/${first.id}/payments`, { method: 'card', amount_minor: 30_000 }).expect(201);
    await post(http, hotel, `/reservations/${first.id}/payments`, { type: 'refund', method: 'cash', amount_minor: 10_000 }).expect(201);
    await post(http, hotel, '/expenses', { category: 'نظافة', description: 'مناديل ومنظفات', amount_minor: 25_000, spent_on: TODAY, method: 'cash' }).expect(201);
    await post(http, hotel, `/reservations/${first.id}/items`, { kind: 'charge', description: 'ميني بار', unit_price_minor: 4_000, quantity: 1 }).expect(201);

    const range = `from=${day(0)}&to=${day(30)}`;
    const response = await get(http, hotel, `/reports/revenue?${range}`);
    assert.equal(response.status, 200);
    const data = response.body.data;

    assert.equal(data.accrual.room_revenue_minor, 400_000);
    assert.equal(data.accrual.extras_minor, 4_000);
    assert.equal(data.accrual.total_minor, 404_000);
    assert.deepEqual(data.by_source.map((s) => [s.source, s.nights, s.room_minor]).sort(), [['direct', 2, 200_000], ['phone', 2, 200_000]]);
    assert.equal(data.by_unit_type[0].nights, 4);

    assert.equal(data.cash.received_minor, 150_000);
    assert.equal(data.cash.refunded_minor, 10_000);
    assert.equal(data.cash.net_minor, 140_000);
    assert.equal(data.expenses.total_minor, 25_000);
    assert.equal(data.net_cash_minor, 115_000);
  });

  test('التوقّع: المؤكّد والمعلّق منفصلان والحجب يخرج من المتاح', async () => {
    const response = await get(http, hotel, '/reports/forecast?days=14');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.days.length, 14);
    const at = (n) => response.body.data.days.find((d) => d.day === day(n));
    assert.deepEqual([at(10).confirmed, at(10).pending, at(10).free], [1, 1, 2]);
    assert.equal(at(11).available, 3);
    assert.equal(at(13).confirmed, 0);
  });

  test('المدى الأكبر من سنة أو المقلوب مرفوض', async () => {
    assert.equal((await get(http, hotel, `/reports/occupancy?from=${day(0)}&to=${day(500)}`)).status, 400);
    assert.equal((await get(http, hotel, `/reports/occupancy?from=${day(5)}&to=${day(1)}`)).status, 422);
  });
});

describe('لوحة اليوم', () => {
  let h;
  before(async () => {
    h = await makeHotel(http, ctx.token, { rooms: 3 });
    const arriving = await mustBook(h && http, h, { guest: { full_name: 'قادم اليوم', phone: '01020000001' }, check_in: TODAY, check_out: day(2) });
    const inHouse = await mustBook(http, h, { guest: { full_name: 'مقيم', phone: '01020000002' }, check_in: TODAY, check_out: day(3) });
    await post(http, h, `/reservations/${inHouse.id}/check-in`).expect(200);
    await mustBook(http, h, { guest: { full_name: 'معلّق', phone: '01020000003' }, check_in: day(5), check_out: day(6), status: 'pending' });
    await post(http, h, '/maintenance', { title: 'عطل عاجل', priority: 'urgent' }).expect(201);
    assert.ok(arriving.id);
  });

  test('الوصول والمقيمون والجاهزية والمستحقات', async () => {
    const response = await get(http, h, '/reports/today');
    assert.equal(response.status, 200);
    const data = response.body.data;
    assert.equal(data.date, TODAY);
    assert.equal(data.arrivals.length, 1);
    assert.equal(data.arrivals[0].guest_name, 'قادم اليوم');
    assert.equal(data.arrivals[0].units_not_ready, 0);
    assert.equal(data.stats.in_house, 1);
    assert.equal(data.stats.pending_bookings, 1);
    assert.equal(data.stats.occupied_tonight, 2);
    assert.equal(data.stats.occupancy_pct, 66.7);
    assert.equal(data.stats.urgent_maintenance, 1);
    assert.equal(data.stats.unpaid_in_house_minor, 300_000);
    assert.equal(data.housekeeping.clean, 3);
  });

  test('الاستقبال يرى اللوحة ولا يرى التقارير المالية', async () => {
    const { seedUser, login } = await import('./helpers.js');
    await seedUser({ organizationId: ctx.organizationId, role: 'front_desk', email: 'desk@rep.local', propertyIds: [h.property.id] });
    const desk = await login(http, 'desk@rep.local');
    assert.equal((await http.get(`${h.base}/reports/today`).set(bearer(desk.token))).status, 200);
    assert.equal((await http.get(`${h.base}/reports/revenue`).set(bearer(desk.token))).status, 403);
    assert.equal((await http.get(`${h.base}/reports/export/reservations.csv`).set(bearer(desk.token))).status, 403);
  });
});

describe('التصدير وسجل التدقيق', () => {
  test('CSV الحجوزات: ترميز Excel، وحقن الصيغ في اسم النزيل مُعطَّل', async () => {
    const h = await makeHotel(http, ctx.token, { rooms: 2 });
    await mustBook(http, h, { guest: { full_name: '=HYPERLINK("http://evil.example","اضغط")', phone: '01030000001' }, check_in: day(3), check_out: day(5) });

    const response = await http.get(`${h.base}/reports/export/reservations.csv?from=${day(0)}&to=${day(10)}`).set(bearer(h.token));
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/csv/);
    assert.match(response.headers['content-disposition'], /attachment; filename="reservations-/);
    assert.ok(response.text.startsWith('﻿كود الحجز,الحالة'));
    assert.ok(response.text.includes(`"'=HYPERLINK(""http://evil.example"",""اضغط"")"`));
    assert.ok(!/(^|,)=HYPERLINK/m.test(response.text), 'لا خلية تبدأ بصيغة');

    const audit = await get(http, h, '/audit-logs?action=report.export');
    assert.equal(audit.body.data.length, 1, 'مَن صدّر ملفًّا يُسجَّل');
  });

  test('سجل التدقيق: قبل/بعد، وتصفية بالكيان والإجراء، وللمدير فقط', async () => {
    const h = await makeHotel(http, ctx.token, { rooms: 1 });
    const reservation = await mustBook(http, h, { check_in: day(3), check_out: day(5) });
    await post(http, h, `/reservations/${reservation.id}/cancel`, { reason: 'سبب مسجّل', fee_minor: 5_000 }).expect(200);

    const logs = await get(http, h, `/audit-logs?entity=reservation&entity_id=${reservation.id}`);
    const actions = logs.body.data.map((row) => row.action);
    assert.deepEqual(actions, ['reservation.cancel', 'reservation.create']);
    const cancel = logs.body.data[0];
    const after = typeof cancel.after_json === 'string' ? JSON.parse(cancel.after_json) : cancel.after_json;
    assert.equal(after.reason, 'سبب مسجّل');
    assert.equal(after.fee_minor, 5_000);
    assert.equal(cancel.user_role, 'owner');

    const { seedUser, login } = await import('./helpers.js');
    await seedUser({ organizationId: ctx.organizationId, role: 'front_desk', email: 'desk@audit.local', propertyIds: [h.property.id] });
    const desk = await login(http, 'desk@audit.local');
    assert.equal((await http.get(`${h.base}/audit-logs`).set(bearer(desk.token))).status, 403);
    assert.equal(API, '/api/v1');
  });
});
