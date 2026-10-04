/**
 * ═══════════════════════════════════════════════════════════════
 *  واجهة الحجز العامة (للضيف على الإنترنت — بلا تسجيل دخول)
 *
 *  مبادئ:
 *   • لا تكشف إلا ما يحتاجه الضيف: لا ملاحظات داخلية ولا معرّفات النظام ولا
 *     بيانات نزلاء آخرين.
 *   • الحجز من الإنترنت يدخل «معلّقًا» بمهلة، ويؤكّده موظف (أو عربون) — لا حجز
 *     نهائي بلا مراجعة بشرية، فلا تُباع غرفة لضيف وهمي.
 *   • الاطّلاع على حجز يتطلّب كوده العشوائي + آخر 4 أرقام من هاتف صاحبه.
 *   • نُنبّه الموظفين فور وصول طلب، ونرسل للضيف تأكيد الاستلام.
 * ═══════════════════════════════════════════════════════════════
 */
import { z } from 'zod';
import { query, queryOne } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { zonedToUtc } from '../../utils/dates.js';
import { lastDigits } from '../../utils/phone.js';
import { safeEqual } from '../../utils/security.js';
import { emailSchema, idSchema, isoDate, optionalText, phoneSchema, timeOfDay } from '../../utils/schemas.js';
import { PROPERTY_COLUMNS } from '../../middleware/propertyScope.js';
import { publicFileUrl } from '../../middleware/upload.js';
import { enqueueEmail } from '../../services/notifications/outbox.js';
import { notifyStaff } from '../../services/notifications/staff.js';
import { searchAvailability } from '../availability/availability.service.js';
import { reservations } from '../reservations/reservations.service.js';

export const publicSearchQuery = z.object({
  check_in: isoDate,
  check_out: isoDate,
  adults: z.coerce.number().int().min(1).max(30).default(2),
  children: z.coerce.number().int().min(0).max(20).default(0),
  rate_plan_id: idSchema.optional(),
  promo_code: z.string().trim().max(30).optional(),
});

export const publicBookingSchema = z.object({
  guest: z.object({
    full_name: z.string().trim().min(2).max(150),
    phone: phoneSchema,
    email: emailSchema.optional(),
    nationality: optionalText(60),
  }),
  check_in: isoDate,
  check_out: isoDate,
  rooms: z.array(z.object({
    unit_type_id: idSchema,
    rate_plan_id: idSchema.nullish(),
    adults: z.number().int().min(1).max(30),
    children: z.number().int().min(0).max(20).default(0),
  })).min(1).max(5),
  promo_code: z.string().trim().max(30).optional(),
  guest_notes: optionalText(500),
  expected_arrival: timeOfDay.nullish(),
  /** موافقة على سياسة الإلغاء */
  accept_terms: z.literal(true, { errorMap: () => ({ message: 'لازم توافق على سياسة الحجز والإلغاء' }) }),
  /** فخّ للروبوتات: حقل مخفي في الصفحة، البشر لا يملؤونه */
  website: z.string().max(0, 'طلب غير صالح').optional(),
});

export const lookupQuery = z.object({ phone: z.string().trim().regex(/^\d{4}$/, 'آخر 4 أرقام من الهاتف') });
export const cancelBody = z.object({
  phone: z.string().trim().regex(/^\d{4}$/, 'آخر 4 أرقام من الهاتف'),
  reason: optionalText(255),
});

/** منشأة مفتوحة للحجز العام بالـ slug، وإلا 404 (لا نكشف سبب الإغلاق) */
export async function findPublicProperty(slug) {
  const property = await queryOne(
    `SELECT ${PROPERTY_COLUMNS} FROM properties p
      WHERE p.slug = ? AND p.status = 'active' AND p.public_booking_enabled = 1`,
    [String(slug).toLowerCase()],
  );
  if (!property) throw ApiError.notFound('المنشأة غير متاحة للحجز', { code: 'PROPERTY_NOT_FOUND' });
  return property;
}

const parseJson = (value) => (typeof value === 'string' ? JSON.parse(value) : (value ?? []));

export async function propertyInfo(property) {
  const [types, plans, photos] = await Promise.all([
    query(
      `SELECT id, code, kind, name_ar, name_en, description_ar, description_en, base_adults, max_adults, max_children,
              max_occupancy, bedrooms, beds, size_sqm, base_price_minor, amenities
         FROM unit_types WHERE property_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY sort_order, id`,
      [property.id],
    ),
    query(
      `SELECT id, code, name_ar, name_en, description_ar, description_en, meal_plan, is_refundable, is_default
         FROM rate_plans WHERE property_id = ? AND is_active = 1 AND is_public = 1 ORDER BY is_default DESC, sort_order, id`,
      [property.id],
    ),
    query("SELECT id, entity_id, file_path FROM attachments WHERE property_id = ? AND entity = 'unit_type' ORDER BY sort_order, id", [property.id]),
  ]);

  return {
    slug: property.slug,
    kind: property.kind,
    name_ar: property.name_ar,
    name_en: property.name_en,
    description_ar: property.description_ar,
    description_en: property.description_en,
    phone: property.phone,
    whatsapp: property.whatsapp,
    email: property.email,
    address_ar: property.address_ar,
    address_en: property.address_en,
    city: property.city,
    governorate: property.governorate,
    latitude: property.latitude,
    longitude: property.longitude,
    check_in_time: property.check_in_time,
    check_out_time: property.check_out_time,
    currency: property.currency,
    prices_include_tax: Boolean(property.prices_include_tax),
    tax_bps: property.tax_bps,
    service_charge_bps: property.service_charge_bps,
    deposit_percent: property.deposit_percent,
    hold_hours: property.hold_hours,
    free_cancel_hours: property.free_cancel_hours,
    cancellation_policy_ar: property.cancellation_policy_ar,
    cancellation_policy_en: property.cancellation_policy_en,
    unit_types: types.map((type) => ({
      ...type,
      amenities: parseJson(type.amenities),
      photos: photos.filter((p) => p.entity_id === type.id).map((p) => ({ id: p.id, url: publicFileUrl(p.file_path) })),
    })),
    rate_plans: plans.map((plan) => ({ ...plan, is_refundable: Boolean(plan.is_refundable), is_default: Boolean(plan.is_default) })),
  };
}

export const search = (property, params) => searchAvailability(property, params, { publicOnly: true });

/** موعد آخر إلغاء مجاني: وقت دخول يوم الوصول (بتوقيت المنشأة) ناقص ساعات السياسة */
function freeCancelDeadline(property, reservation) {
  const arrival = zonedToUtc(reservation.check_in, property.check_in_time, property.timezone);
  return new Date(arrival.getTime() - property.free_cancel_hours * 3_600_000);
}

async function viewOf(property, reservationId) {
  const reservation = await queryOne(
    `SELECT r.*, g.full_name AS guest_name FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.id = ?`,
    [reservationId],
  );
  const rooms = await query(
    `SELECT t.name_ar, t.name_en, ru.adults, ru.children, rp.name_ar AS rate_plan_name_ar, rp.is_refundable
       FROM reservation_units ru JOIN unit_types t ON t.id = ru.unit_type_id
       LEFT JOIN rate_plans rp ON rp.id = ru.rate_plan_id
      WHERE ru.reservation_id = ? ORDER BY ru.line_no`,
    [reservationId],
  );

  const deadline = freeCancelDeadline(property, reservation);
  const nonRefundable = rooms.some((room) => room.is_refundable === 0);
  const cancellable = ['pending', 'confirmed'].includes(reservation.status) && !nonRefundable && Date.now() <= deadline.getTime();

  return {
    code: reservation.code,
    public_code: reservation.public_code,
    status: reservation.status,
    guest_name: reservation.guest_name,
    check_in: reservation.check_in,
    check_out: reservation.check_out,
    nights: reservation.nights,
    adults: reservation.adults,
    children: reservation.children,
    rooms: rooms.map((room) => ({
      name_ar: room.name_ar, name_en: room.name_en, adults: room.adults, children: room.children,
      rate_plan_name_ar: room.rate_plan_name_ar,
    })),
    currency: reservation.currency,
    total_minor: reservation.total_minor,
    paid_minor: reservation.paid_minor,
    balance_minor: reservation.total_minor - reservation.paid_minor,
    deposit_due_minor: reservation.deposit_due_minor,
    hold_expires_at: reservation.hold_expires_at,
    can_cancel: cancellable,
    non_refundable: nonRefundable,
    free_cancel_until: deadline.toISOString(),
    cancellation_policy_ar: property.cancellation_policy_ar,
    cancellation_policy_en: property.cancellation_policy_en,
    property: { name_ar: property.name_ar, name_en: property.name_en, phone: property.phone, whatsapp: property.whatsapp },
  };
}

export async function createBooking(property, input) {
  const first = input.rooms[0];
  let reservation;
  try {
    reservation = await reservations.create(property, {
    guest: input.guest,
    check_in: input.check_in,
    check_out: input.check_out,
    adults: first.adults,
    children: first.children,
    rooms: input.rooms.map((room) => ({
      unit_type_id: room.unit_type_id, rate_plan_id: room.rate_plan_id ?? null, adults: room.adults, children: room.children,
    })),
    promo_code: input.promo_code,
    status: 'pending',
    source: 'website',
    guest_notes: input.guest_notes ?? null,
    expected_arrival: input.expected_arrival ?? null,
    send_confirmation: true,
    }, { user: null, publicBooking: true });
  } catch (error) {
    // لا نخبر الضيف أنه في القائمة السوداء: رسالة عامة تحيله للتواصل المباشر
    if (error.code === 'GUEST_BLACKLISTED') {
      throw ApiError.conflict('تعذّر إتمام الحجز إلكترونيًّا — تواصل معنا مباشرة', { code: 'BOOKING_UNAVAILABLE' });
    }
    throw error;
  }

  // تنبيه الموظفين (فشله لا يُفشل الحجز الذي تمّ)
  try {
    await notifyStaff(property, {
      roles: ['manager', 'front_desk'],
      payload: {
        title: 'حجز جديد من الموقع',
        body: `${reservation.code} — ${input.guest.full_name}: ${input.check_in} ← ${input.check_out}`,
        url: `/reservations/${reservation.id}`,
      },
    });
    if (property.email) {
      await enqueueEmail({
        propertyId: property.id, to: property.email, template: 'new_booking_staff',
        payload: {
          propertyName: property.name_ar, code: reservation.code, guestName: input.guest.full_name,
          checkIn: input.check_in, checkOut: input.check_out, source: 'الموقع',
        },
      });
    }
  } catch { /* التنبيه ثانوي */ }

  return viewOf(property, reservation.id);
}

/** يجد الحجز بكوده العام ويتحقّق من آخر 4 أرقام الهاتف بمقارنة بزمن ثابت */
async function findForGuest(property, publicCode, phone4) {
  const row = await queryOne(
    `SELECT r.id, r.status, r.check_in, g.phone FROM reservations r JOIN guests g ON g.id = r.guest_id
      WHERE r.property_id = ? AND r.public_code = ?`,
    [property.id, String(publicCode).toUpperCase()],
  );
  // نفس الرسالة لكود خاطئ ورقم خاطئ: لا نكشف وجود الحجز
  if (!row || !safeEqual(lastDigits(row.phone, 4), phone4)) {
    throw ApiError.notFound('لم نجد حجزًا بهذه البيانات', { code: 'BOOKING_NOT_FOUND' });
  }
  return row;
}

export async function lookupBooking(property, publicCode, phone4) {
  const row = await findForGuest(property, publicCode, phone4);
  return viewOf(property, row.id);
}

export async function cancelBooking(property, publicCode, { phone, reason }) {
  const row = await findForGuest(property, publicCode, phone);
  const view = await viewOf(property, row.id);

  if (!['pending', 'confirmed'].includes(view.status)) {
    throw ApiError.conflict('الحجز ده مينفعش يتلغى', { code: 'BAD_STATUS' });
  }
  if (view.non_refundable) {
    throw ApiError.conflict('الحجز ده بسعر غير قابل للاسترداد — كلّمنا لو في ظرف خاص', { code: 'NON_REFUNDABLE' });
  }
  if (!view.can_cancel) {
    throw ApiError.conflict('انتهت مهلة الإلغاء المجاني — كلّمنا على الهاتف', {
      code: 'CANCEL_WINDOW_CLOSED', details: { free_cancel_until: view.free_cancel_until },
    });
  }

  const result = await reservations.cancel(property, row.id, {
    reason: reason || 'ألغاه النزيل من صفحة الحجز', fee_minor: 0, notify: true,
  });
  await notifyStaff(property, {
    roles: ['manager', 'front_desk'],
    payload: {
      title: 'إلغاء حجز من النزيل',
      body: `${result.reservation.code}${result.refund_due_minor > 0 ? ` — مرتجع مستحق ${result.refund_due_minor / 100}` : ''}`,
      url: `/reservations/${row.id}`,
    },
  }).catch(() => {});
  return { ...(await viewOf(property, row.id)), refund_due_minor: result.refund_due_minor };
}
