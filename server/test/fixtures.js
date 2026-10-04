/**
 * منشأة جاهزة للاختبارات: فندق + نوع وحدة + غرف (101, 102, ...).
 * التواريخ نسبية لـ «اليوم» في القاهرة، فلا تتقادم الاختبارات.
 */
import assert from 'node:assert/strict';
import { addDays, todayIn } from '../src/utils/dates.js';
import { API, bearer, createProperty } from './helpers.js';

export const TODAY = todayIn('Africa/Cairo');
/** تاريخ بعد n يومًا من اليوم */
export const day = (n) => addDays(TODAY, n);

let counter = 0;

export async function makeHotel(http, token, {
  rooms = 3, basePrice = 100_000, propertyOverrides = {}, typeOverrides = {},
} = {}) {
  counter += 1;
  const property = await createProperty(http, token, {
    name_ar: `فندق ${counter}`, name_en: `Test Hotel ${counter}`, ...propertyOverrides,
  });
  const base = `${API}/properties/${property.id}`;

  const typeResponse = await http.post(`${base}/unit-types`).set(bearer(token)).send({
    code: 'DBL', name_ar: 'غرفة مزدوجة', base_price_minor: basePrice,
    base_adults: 2, max_adults: 3, max_children: 2, max_occupancy: 4,
    extra_adult_minor: 20_000, extra_child_minor: 10_000, ...typeOverrides,
  });
  assert.equal(typeResponse.status, 201, JSON.stringify(typeResponse.body));
  const type = typeResponse.body.data;

  const unitsResponse = await http.post(`${base}/units/bulk`).set(bearer(token))
    .send({ unit_type_id: type.id, range: { from: 101, to: 100 + rooms } });
  assert.equal(unitsResponse.status, 201, JSON.stringify(unitsResponse.body));

  return { property, type, units: unitsResponse.body.data, base, token };
}

/** حجز عبر الـ API (يعيد الاستجابة كاملة لاختبار النجاح والفشل) */
export const book = (http, hotel, overrides = {}) =>
  http.post(`${hotel.base}/reservations`).set(bearer(hotel.token)).send({
    guest: { full_name: 'نزيل اختبار', phone: '01012345678' },
    check_in: day(10),
    check_out: day(13),
    adults: 2,
    rooms: [{ unit_type_id: hotel.type.id }],
    ...overrides,
  });

/** حجز يجب أن ينجح ويعيد تفاصيله */
export async function mustBook(http, hotel, overrides = {}) {
  const response = await book(http, hotel, overrides);
  assert.equal(response.status, 201, `فشل الحجز: ${JSON.stringify(response.body)}`);
  return response.body.data;
}

export const post = (http, hotel, path, body = {}) =>
  http.post(`${hotel.base}${path}`).set(bearer(hotel.token)).send(body);
export const get = (http, hotel, path) => http.get(`${hotel.base}${path}`).set(bearer(hotel.token));
