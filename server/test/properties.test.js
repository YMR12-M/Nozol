import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../src/config/db.js';
import {
  API, bearer, bootstrapOwner, createProperty, login, makeApp, resetDatabase,
  seedOrganization, seedUser, shutdown,
} from './helpers.js';

const { http } = makeApp();
let ctx;

before(async () => {
  await resetDatabase();
  ctx = await bootstrapOwner(http);
});
after(shutdown);

describe('إنشاء المنشأة', () => {
  test('الاسم المختصر يُولَّد من الاسم الإنجليزي، والضرائب صفر افتراضيًا', async () => {
    const property = await createProperty(http, ctx.token, { name_ar: 'فندق النيل', name_en: 'Nile View Hotel' });
    assert.equal(property.slug, 'nile-view-hotel');
    assert.equal(property.tax_bps, 0);
    assert.equal(property.currency, 'EGP');
    assert.equal(property.timezone, 'Africa/Cairo');
    assert.equal(property.public_booking_enabled, 0);
  });

  test('تعارض الاسم المختصر يُحَلّ برقم، والمحجوز مرفوض', async () => {
    const again = await createProperty(http, ctx.token, { name_ar: 'نيل تاني', name_en: 'Nile View Hotel' });
    assert.equal(again.slug, 'nile-view-hotel-2');

    const clash = await http.post(`${API}/properties`).set(bearer(ctx.token))
      .send({ name_ar: 'نيل مكرّر', slug: 'nile-view-hotel' });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'SLUG_TAKEN');

    const reserved = await http.post(`${API}/properties`).set(bearer(ctx.token))
      .send({ name_ar: 'محجوز', slug: 'admin' });
    assert.equal(reserved.status, 400);
    assert.equal(reserved.body.code, 'SLUG_RESERVED');
  });

  test('المالك وحده ينشئ منشأة', async () => {
    await seedUser({ organizationId: ctx.organizationId, role: 'manager', email: 'mgr@test.local' });
    const manager = await login(http, 'mgr@test.local');
    const response = await http.post(`${API}/properties`).set(bearer(manager.token)).send({ name_ar: 'ممنوع' });
    assert.equal(response.status, 403);
  });

  test('التحقّق: ضريبة فوق 100%، منطقة زمنية خاطئة، اسم قصير', async () => {
    const response = await http.post(`${API}/properties`).set(bearer(ctx.token))
      .send({ name_ar: 'ا', tax_bps: 20_000, timezone: 'Mars/Olympus' });
    assert.equal(response.status, 422);
    assert.ok(response.body.errors.name_ar);
    assert.ok(response.body.errors.tax_bps);
    assert.equal(response.body.errors.timezone, 'منطقة زمنية غير صالحة (مثال: Africa/Cairo)');
  });
});

describe('الوصول والصلاحيات', () => {
  let property;
  let managerToken;
  let deskToken;

  before(async () => {
    property = await createProperty(http, ctx.token, { name_ar: 'منتجع الشاطئ', name_en: 'Beach Resort' });
    await seedUser({ organizationId: ctx.organizationId, role: 'manager', email: 'beach-mgr@test.local', propertyIds: [property.id] });
    await seedUser({ organizationId: ctx.organizationId, role: 'front_desk', email: 'beach-desk@test.local', propertyIds: [property.id] });
    await seedUser({ organizationId: ctx.organizationId, role: 'manager', email: 'no-access@test.local' });
    managerToken = (await login(http, 'beach-mgr@test.local')).token;
    deskToken = (await login(http, 'beach-desk@test.local')).token;
  });

  test('الموظف يرى منشآته فقط والمالك يرى كل شيء', async () => {
    const mine = await http.get(`${API}/properties`).set(bearer(managerToken));
    assert.deepEqual(mine.body.data.map((p) => p.slug), ['beach-resort']);

    const owner = await http.get(`${API}/properties`).set(bearer(ctx.token));
    assert.ok(owner.body.data.length >= 3);
  });

  test('من لا وصول له يحصل على 404 (لا كشف للوجود)', async () => {
    const { token } = await login(http, 'no-access@test.local');
    const response = await http.get(`${API}/properties/${property.id}`).set(bearer(token));
    assert.equal(response.status, 404);
    assert.equal(response.body.code, 'PROPERTY_NOT_FOUND');
  });

  test('منشأة منظّمة أخرى = 404 حتى للمالك', async () => {
    const otherOrg = await seedOrganization('عميل آخر');
    await seedUser({ organizationId: otherOrg, role: 'owner', email: 'rival@test.local' });
    const rival = await login(http, 'rival@test.local');
    const response = await http.get(`${API}/properties/${property.id}`).set(bearer(rival.token));
    assert.equal(response.status, 404);
  });

  test('الاستقبال يقرأ ولا يعدّل، والمدير يعدّل مع سجل تدقيق قبل/بعد', async () => {
    const read = await http.get(`${API}/properties/${property.id}`).set(bearer(deskToken));
    assert.equal(read.status, 200);
    assert.equal(read.body.data.summary.units, 0);

    const denied = await http.patch(`${API}/properties/${property.id}`).set(bearer(deskToken)).send({ tax_bps: 1400 });
    assert.equal(denied.status, 403);

    const updated = await http.patch(`${API}/properties/${property.id}`).set(bearer(managerToken))
      .send({ tax_bps: 1400, service_charge_bps: 1200, check_in_time: '15:00' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.tax_bps, 1400);
    assert.equal(updated.body.data.check_in_time, '15:00:00');

    const [log] = await query("SELECT before_json, after_json FROM audit_logs WHERE action = 'property.update' ORDER BY id DESC LIMIT 1");
    const before = typeof log.before_json === 'string' ? JSON.parse(log.before_json) : log.before_json;
    const after = typeof log.after_json === 'string' ? JSON.parse(log.after_json) : log.after_json;
    assert.equal(before.tax_bps, 0);
    assert.equal(after.tax_bps, 1400);
    assert.equal(after.name_ar, undefined, 'التدقيق يسجّل المتغيّر فقط');
  });

  test('الحجز الإلكتروني لا يُفعَّل قبل وجود وحدة', async () => {
    const response = await http.patch(`${API}/properties/${property.id}`).set(bearer(ctx.token))
      .send({ public_booking_enabled: true });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'NOT_READY_FOR_BOOKING');
  });

  test('معرّف المنشأة غير الرقمي → 400', async () => {
    const response = await http.get(`${API}/properties/abc`).set(bearer(ctx.token));
    assert.equal(response.status, 400);
  });
});
