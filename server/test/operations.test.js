import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { query, queryOne } from '../src/config/db.js';
import {
  API, bearer, bootstrapOwner, login, makeApp, resetDatabase, seedUser, shutdown,
} from './helpers.js';
import {
  TODAY, day, get, makeHotel, mustBook, post,
} from './fixtures.js';

const { http } = makeApp();
let ctx;
let hotel;

/** PNG صالح بأول بايتات صحيحة (يكفي لفحص النوع الحقيقي) */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

const as = async (email, role) => {
  await seedUser({ organizationId: ctx.organizationId, role, email, propertyIds: [hotel.property.id], fullName: email.split('@')[0] });
  return { ...(await login(http, email)), id: (await queryOne('SELECT id FROM users WHERE email = ?', [email])).id };
};

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http);
  hotel = await makeHotel(http, ctx.token, { rooms: 4 });
});
after(shutdown);

describe('مهام التنظيف', () => {
  let cleanerA;
  let cleanerB;
  let task;

  before(async () => {
    cleanerA = await as('a@hk.local', 'housekeeping');
    cleanerB = await as('b@hk.local', 'housekeeping');
  });

  test('المشرف يُنشئ ويُسند، فيصل الموظفَ إشعار', async () => {
    const response = await post(http, hotel, '/housekeeping/tasks', { unit_id: hotel.units[0].id, type: 'deep_clean', priority: 'high', assigned_to: cleanerA.id });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    task = response.body.data;
    assert.equal(task.assigned_to, cleanerA.id);
    assert.equal(task.due_date, TODAY);

    const push = await query("SELECT payload FROM notification_outbox WHERE channel = 'push' AND to_address = ?", [String(cleanerA.id)]);
    assert.ok(push.some((row) => JSON.stringify(row.payload).includes('مهمة تنظيف جديدة')));
  });

  test('عامل التنظيف لا يفتح مهام غيره ولا ينشئ مهامًا', async () => {
    const stolen = await http.post(`${hotel.base}/housekeeping/tasks/${task.id}/start`).set(bearer(cleanerB.token));
    assert.equal(stolen.status, 403);
    assert.equal(stolen.body.code, 'NOT_YOUR_TASK');
    const create = await http.post(`${hotel.base}/housekeeping/tasks`).set(bearer(cleanerB.token)).send({ unit_id: hotel.units[0].id });
    assert.equal(create.status, 403);
  });

  test('الدورة: بدء ← إنهاء ← فحص، وحالة الغرفة تتبعها', async () => {
    const unitStatus = async () => (await queryOne('SELECT housekeeping_status AS s FROM units WHERE id = ?', [hotel.units[0].id])).s;

    const started = await http.post(`${hotel.base}/housekeeping/tasks/${task.id}/start`).set(bearer(cleanerA.token));
    assert.equal(started.body.data.status, 'in_progress');
    assert.equal(await unitStatus(), 'cleaning');

    const done = await http.post(`${hotel.base}/housekeeping/tasks/${task.id}/complete`).set(bearer(cleanerA.token)).send({ note: 'تمّ تغيير الملاءات' });
    assert.equal(done.body.data.status, 'done');
    assert.equal(done.body.data.note, 'تمّ تغيير الملاءات');
    assert.equal(await unitStatus(), 'clean');

    // الفحص النهائي اعتماد إشرافي
    const selfVerify = await http.post(`${hotel.base}/housekeeping/tasks/${task.id}/verify`).set(bearer(cleanerA.token));
    assert.equal(selfVerify.status, 403);
    const verified = await post(http, hotel, `/housekeeping/tasks/${task.id}/verify`);
    assert.equal(verified.body.data.status, 'verified');
    assert.equal(await unitStatus(), 'inspected');

    const again = await http.post(`${hotel.base}/housekeeping/tasks/${task.id}/complete`).set(bearer(cleanerA.token));
    assert.equal(again.status, 409);
  });

  test('تغيير حالة غرفة مباشرة: «تم الفحص» للمشرف فقط', async () => {
    const unit = hotel.units[1].id;
    const clean = await http.patch(`${hotel.base}/units/${unit}/housekeeping`).set(bearer(cleanerA.token)).send({ status: 'clean' });
    assert.equal(clean.status, 200);
    const inspected = await http.patch(`${hotel.base}/units/${unit}/housekeeping`).set(bearer(cleanerA.token)).send({ status: 'inspected' });
    assert.equal(inspected.status, 403);
  });

  test('الموظف يرى مهامه وغير المُسنَدة فقط', async () => {
    await post(http, hotel, '/housekeeping/tasks', { unit_id: hotel.units[2].id, assigned_to: cleanerA.id }).expect(201);
    await post(http, hotel, '/housekeeping/tasks', { unit_id: hotel.units[3].id, assigned_to: cleanerB.id }).expect(201);
    await post(http, hotel, '/housekeeping/tasks', { unit_id: hotel.units[1].id }).expect(201);

    const mineA = await http.get(`${hotel.base}/housekeeping/tasks?open=true`).set(bearer(cleanerA.token));
    const units = mineA.body.data.map((t) => t.unit_code).sort();
    assert.deepEqual(units, ['102', '103'], 'مهمة 103 له، و102 غير مُسنَدة، و104 للزميل');
  });
});

describe('لوحة الغرف والتوليد التلقائي', () => {
  let board;
  before(async () => {
    const h = await makeHotel(http, ctx.token, { rooms: 4 });
    // 101 مقيم · 102 يصل اليوم · 103 فاضية · 104 يغادر اليوم
    const stay = await mustBook(http, h, { guest: { full_name: 'مقيم', phone: '01011112222' }, check_in: TODAY, check_out: day(3), rooms: [{ unit_type_id: h.type.id, unit_id: h.units[0].id }] });
    await post(http, h, `/reservations/${stay.id}/check-in`).expect(200);
    await mustBook(http, h, { guest: { full_name: 'قادم', phone: '01022223333' }, check_in: TODAY, check_out: day(2), rooms: [{ unit_type_id: h.type.id, unit_id: h.units[1].id }] });
    const leaving = await mustBook(http, h, {
      guest: { full_name: 'مغادر', phone: '01033334444' }, check_in: day(-2), check_out: day(1),
      rooms: [{ unit_type_id: h.type.id, unit_id: h.units[3].id }], override: { past: true },
    });
    await post(http, h, `/reservations/${leaving.id}/check-in`).expect(200);
    // نُقصّر الإقامة لتنتهي اليوم (لا يُسجَّل دخول لحجز تنتهي مدّته اليوم، فنُنهيه بعد الدخول)
    await post(http, h, `/reservations/${leaving.id}/change-dates`, { check_in: day(-2), check_out: TODAY }).expect(200);
    hotel = h;
    board = (await get(http, h, '/housekeeping/board')).body.data;
  });

  test('حالة كل غرفة الآن', () => {
    const by = Object.fromEntries(board.map((unit) => [unit.code, unit]));
    assert.equal(by['101'].occupancy, 'occupied');
    assert.equal(by['101'].guest_name, 'مقيم');
    assert.equal(by['102'].occupancy, 'arriving');
    assert.equal(by['103'].occupancy, 'vacant');
    assert.equal(by['104'].occupancy, 'departing');
  });

  test('توليد مهام الإقامة: للمقيمين فقط، وآمن للتكرار', async () => {
    const first = await post(http, hotel, '/housekeeping/generate', {});
    assert.equal(first.body.data.created, 1, 'غرفة 101 فقط (104 تغادر اليوم)');
    const second = await post(http, hotel, '/housekeeping/generate', {});
    assert.equal(second.body.data.created, 0);
    const tasks = await get(http, hotel, '/housekeeping/tasks');
    assert.equal(tasks.body.data.filter((t) => t.type === 'stayover_clean').length, 1);
  });
});

describe('طلبات الصيانة', () => {
  let desk;
  before(async () => {
    hotel = await makeHotel(http, ctx.token, { rooms: 2 });
    desk = await as('desk@maint.local', 'front_desk');
  });

  test('بلاغ مع حجب الغرفة عن البيع طوال الإصلاح', async () => {
    const response = await http.post(`${hotel.base}/maintenance`).set(bearer(desk.token)).send({
      unit_id: hotel.units[0].id, title: 'تسريب في الحمّام', priority: 'high',
      block_unit: { start_date: day(5), end_date: day(8) },
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.unit_code, '101');

    const search = await get(http, hotel, `/availability?check_in=${day(5)}&check_out=${day(8)}&adults=2`);
    assert.equal(search.body.data.results[0].available_units, 1, 'غرفة واحدة فقط متاحة');
    const alerts = await query("SELECT payload FROM notification_outbox WHERE channel = 'push'");
    assert.ok(alerts.some((row) => JSON.stringify(row.payload).includes('عطل مهم')), 'المدير يُنبَّه للأعطال المهمة');
  });

  test('الحجب فوق حجز قائم مرفوض مع تفاصيل المشغول', async () => {
    const booked = await mustBook(http, hotel, { check_in: day(20), check_out: day(22), rooms: [{ unit_type_id: hotel.type.id, unit_id: hotel.units[1].id }] });
    const response = await http.post(`${hotel.base}/maintenance`).set(bearer(desk.token)).send({
      unit_id: hotel.units[1].id, title: 'مكيّف', block_unit: { start_date: day(21), end_date: day(23) },
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'NIGHTS_OCCUPIED');
    assert.equal(response.body.errors.occupied[0].reservation_code, booked.code);
    // لم يُسجَّل طلب نصف مكتمل
    const leaked = await query("SELECT id FROM maintenance_requests WHERE title = 'مكيّف'");
    assert.equal(leaked.length, 0);
  });

  test('الإصلاح: تحديث الحالة والتكلفة، واكتمال يضع وقت الحلّ ويعيد فتحه يمسحه', async () => {
    const [req] = (await get(http, hotel, '/maintenance?open=true')).body.data;
    const resolved = await http.patch(`${hotel.base}/maintenance/${req.id}`).set(bearer(desk.token)).send({ status: 'resolved', cost_minor: 35_000 });
    assert.equal(resolved.status, 200);
    assert.ok(resolved.body.data.resolved_at);
    assert.equal(resolved.body.data.cost_minor, 35_000);

    const reopened = await http.patch(`${hotel.base}/maintenance/${req.id}`).set(bearer(desk.token)).send({ status: 'in_progress' });
    assert.equal(reopened.body.data.resolved_at, null);
  });

  test('صور العطل: PNG حقيقي مقبول، ونص متنكّر في صورة مرفوض', async () => {
    const [req] = (await get(http, hotel, '/maintenance')).body.data;
    const good = await http.post(`${hotel.base}/maintenance/${req.id}/photos`).set(bearer(desk.token)).attach('photos', PNG, 'leak.png');
    assert.equal(good.status, 201, JSON.stringify(good.body));
    assert.equal(good.body.data[0].visibility, 'private');
    assert.equal(good.body.data[0].url, null, 'الخاص بلا رابط علني');

    const fake = await http.post(`${hotel.base}/maintenance/${req.id}/photos`).set(bearer(desk.token))
      .attach('photos', Buffer.from('<script>alert(1)</script> هذا ليس صورة أبدًا'), { filename: 'x.png', contentType: 'image/png' });
    assert.equal(fake.status, 400);
    assert.equal(fake.body.code, 'FILE_TYPE');

    // التحميل يمرّ عبر مسار مصادَق عليه ويتحقّق من الصلاحية
    const download = await http.get(`${hotel.base}/attachments/${good.body.data[0].id}/file`).set(bearer(desk.token));
    assert.equal(download.status, 200);
    assert.equal(download.headers['content-type'], 'image/png');
    assert.equal(download.headers['x-content-type-options'], 'nosniff');
    assert.equal((await http.get(`${hotel.base}/attachments/${good.body.data[0].id}/file`)).status, 401);
  });
});

describe('خصوصية مرفقات النزلاء', () => {
  test('صورة الهويّة لا يراها من لا يملك صلاحية النزلاء (التنظيف مثلًا)', async () => {
    const created = await post(http, hotel, '/guests', { full_name: 'نزيل بهوية', phone: '01077770000', id_type: 'national_id', id_number: '29901011234567' });
    const guestId = created.body.data.id;
    const upload = await http.post(`${hotel.base}/guests/${guestId}/documents`).set(bearer(ctx.token)).attach('documents', PNG, 'id.png');
    assert.equal(upload.status, 201);
    const docId = upload.body.data[0].id;

    const cleaner = await as('cleaner@priv.local', 'housekeeping');
    assert.equal((await http.get(`${hotel.base}/attachments/${docId}/file`).set(bearer(cleaner.token))).status, 403);
    assert.equal((await http.get(`${hotel.base}/guests/${guestId}`).set(bearer(cleaner.token))).status, 403);
    assert.equal((await http.get(`${hotel.base}/attachments/${docId}/file`).set(bearer(ctx.token))).status, 200);
    assert.equal(API, '/api/v1');
  });
});
