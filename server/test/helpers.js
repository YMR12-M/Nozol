/**
 * أدوات الاختبارات: قاعدة نظيفة، مالك جاهز، تسجيل دخول، منشأة جاهزة.
 *
 * الاختبارات تعمل على قاعدة `nozol_test` فقط (env.js يرفض أي اسم لا ينتهي
 * بـ _test). كل ملف اختبار يبدأ بقاعدة فارغة.
 */
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool, pool, execute } from '../src/config/db.js';
import { migrateUp } from '../src/db/migrate.js';
import { hashPassword } from '../src/utils/security.js';

export const PASSWORD = 'Str0ng-Pass-123!';
export const API = '/api/v1';

export async function resetDatabase() {
  await migrateUp();
  const connection = await pool.getConnection();
  try {
    const [tables] = await connection.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'",
    );
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { name } of tables) await connection.query(`TRUNCATE TABLE \`${name}\``);
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    connection.release();
  }
}

export const shutdown = () => closePool();

export function makeApp() {
  const app = createApp();
  return { app, http: request(app) };
}

export async function seedOrganization(name = 'منظّمة الاختبار') {
  const result = await execute('INSERT INTO organizations (uuid, name) VALUES (?, ?)', [crypto.randomUUID(), name]);
  return result.insertId;
}

export async function seedUser({
  organizationId, role = 'owner', email, password = PASSWORD, fullName = 'مستخدم اختبار',
  mustChangePassword = false, propertyIds = [],
}) {
  const result = await execute(
    `INSERT INTO users (uuid, organization_id, full_name, email, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), organizationId, fullName, email, await hashPassword(password), role, mustChangePassword],
  );
  for (const propertyId of propertyIds) {
    await execute('INSERT INTO user_properties (user_id, property_id) VALUES (?, ?)', [result.insertId, propertyId]);
  }
  return { id: result.insertId, email, password };
}

/** يسجّل الدخول ويعيد { token, cookie, body } */
export async function login(http, email, password = PASSWORD, clientType = 'web') {
  const response = await http
    .post(`${API}/auth/login`)
    .set('X-Client-Type', clientType)
    .send({ email, password });
  return {
    status: response.status,
    body: response.body,
    token: response.body?.data?.tokens?.access_token,
    refreshToken: response.body?.data?.tokens?.refresh_token,
    cookie: (response.headers['set-cookie'] || [])[0]?.split(';')[0],
    response,
  };
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

/** منظّمة + مالك + تسجيل دخول في خطوة واحدة */
export async function bootstrapOwner(http, { email = 'owner@test.local' } = {}) {
  const organizationId = await seedOrganization();
  const owner = await seedUser({ organizationId, role: 'owner', email });
  const session = await login(http, email);
  return { organizationId, owner, token: session.token };
}

/** منشأة جاهزة عبر الـ API */
export async function createProperty(http, token, overrides = {}) {
  const response = await http
    .post(`${API}/properties`)
    .set(bearer(token))
    .send({ name_ar: 'فندق الاختبار', name_en: 'Test Hotel', kind: 'hotel', ...overrides });
  if (response.status !== 201) throw new Error(`فشل إنشاء المنشأة: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body.data;
}
