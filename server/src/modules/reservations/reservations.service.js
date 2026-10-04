/**
 * ═══════════════════════════════════════════════════════════════
 *  الحجوزات — قلب النظام
 *
 *  دورة الحياة:
 *     pending ──confirm──▶ confirmed ──check-in──▶ checked_in ──check-out──▶ checked_out
 *        │                    │
 *        └────── cancel ◀─────┴──▶ no_show
 *
 *  ضمانات يعتمد عليها كل شيء:
 *   1) لا حجز مزدوج: كل ليلة محجوزة صفٌّ في unit_nights بمفتاح (وحدة، ليلة)،
 *      والقاعدة نفسها ترفض الثاني — مهما تزامن الطلبان.
 *   2) كل تعديل مالي يعيد حساب الحجز من مصادره (recalculate) داخل نفس المعاملة.
 *   3) كل تغيير حالة يقفل صفّ الحجز (FOR UPDATE): ضغطتان متزامنتان على
 *      «دخول» لا تنتجان تسجيلين.
 *   4) إنشاء الحجز كلٌّ أو لا شيء: فشل غرفة من ثلاث يلغي الحجز كله.
 * ═══════════════════════════════════════════════════════════════
 */
import crypto from 'node:crypto';
import { query, queryOne, transaction, safeInt, isDuplicate } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { diffDays, eachNight, todayIn } from '../../utils/dates.js';
import { nextCounter, formatSequence } from '../../utils/counters.js';
import { pageMeta } from '../../utils/response.js';
import { sum } from '../../utils/money.js';
import { can } from '../../config/permissions.js';
import { enqueueEmail } from '../../services/notifications/outbox.js';
import { guestsService } from '../guests/guests.service.js';
import { findAvailableUnits, orderByBestFit } from '../availability/availability.service.js';
import { assertStayDates, loadPromo, loadRatePlan, loadRules, loadUnitType } from '../pricing/quote.service.js';
import {
  computeTotals, depositDue, priceUnitStay, promoDiscount, reservationLines, validatePromo,
} from '../pricing/engine.js';
import { recalculateReservation } from '../billing/totals.js';
import { folio, invoices, payments, recordPayment } from '../billing/billing.service.js';
import {
  describeConflicts, lockNights, refreshSegmentTotals, withDeadlockRetry, writeNightPrices,
} from './stay.js';
import { moveSegmentInTx, resizeStayInTx } from './stayChanges.js';

const STATUS_LABELS = {
  pending: 'معلّق', confirmed: 'مؤكّد', checked_in: 'مقيم', checked_out: 'غادر', cancelled: 'ملغي', no_show: 'لم يحضر',
};

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // بلا 0/O/1/I الملتبسة
const newPublicCode = () => Array.from(crypto.randomBytes(8), (byte) => CODE_ALPHABET[byte % 32]).join('');

export const canOverride = (user) => Boolean(user) && ['owner', 'manager'].includes(user.role);

const conflict = (message, code, details) => ApiError.conflict(message, { code, details });

/* ═══════════════ إنشاء الحجز ═══════════════ */

/** يحمّل ويسعّر كل غرف الحجز ويجمع مخالفات القيود (قراءات فقط) */
async function priceRooms(property, input, { allowPast, publicOnly }) {
  assertStayDates(property, input.check_in, input.check_out, { allowPast });
  const today = todayIn(property.timezone);

  const rooms = input.rooms.map((room, index) => ({
    index,
    unit_type_id: room.unit_type_id,
    unit_id: room.unit_id ?? null,
    adults: room.adults ?? input.adults,
    children: room.children ?? input.children,
    rate_plan_id: room.rate_plan_id ?? input.rate_plan_id ?? null,
  }));

  const types = new Map();
  const plans = new Map();
  const rules = new Map();
  const violations = [];

  for (const room of rooms) {
    if (!types.has(room.unit_type_id)) types.set(room.unit_type_id, await loadUnitType(property.id, room.unit_type_id));
    const planKey = room.rate_plan_id ?? 'default';
    if (!plans.has(planKey)) plans.set(planKey, await loadRatePlan(property.id, room.rate_plan_id, { publicOnly }));
    if (!rules.has(room.unit_type_id)) rules.set(room.unit_type_id, await loadRules(property.id, room.unit_type_id, input.check_in, input.check_out));

    room.unitType = types.get(room.unit_type_id);
    room.ratePlan = plans.get(planKey);
    room.stay = priceUnitStay({
      unitType: room.unitType, ratePlan: room.ratePlan, rules: rules.get(room.unit_type_id),
      checkIn: input.check_in, checkOut: input.check_out, adults: room.adults, children: room.children,
    });
    if (room.stay.violations.length > 0) violations.push({ room: room.index, violations: room.stay.violations });
  }
  return { rooms, violations, today };
}

/** تسعير الغرف ثم التحقّق من الكود الترويجي (مرفوض ← خطأ يوقف الإنشاء) قبل فتح المعاملة */
async function preparePlan(property, input, options) {
  const { rooms, violations, today } = await priceRooms(property, input, options);

  let promo = null;
  if (input.promo_code) {
    promo = await loadPromo(property.id, input.promo_code);
    const verdict = validatePromo({ promo, today, checkIn: input.check_in, checkOut: input.check_out });
    if (!verdict.valid) {
      throw ApiError.unprocessable(verdict.message, { code: verdict.code, details: { promo_code: verdict.message } });
    }
  }
  return { rooms, promo, violations, today };
}

/** يوزّع غرفة على وحدة فاضية (بعينها أو الأنسب) ويقفل ليالُيها */
async function assignRoom(tx, property, reservationId, room, checkIn, checkOut) {
  const nights = eachNight(checkIn, checkOut);

  let candidates;
  if (room.unit_id) {
    const unit = await tx.queryOne(
      "SELECT id, unit_type_id FROM units WHERE id = ? AND property_id = ? AND status = 'active' AND deleted_at IS NULL",
      [room.unit_id, property.id],
    );
    if (!unit || unit.unit_type_id !== room.unit_type_id) {
      throw ApiError.badRequest('الوحدة دي مش من النوع المطلوب أو غير متاحة', { code: 'BAD_UNIT', details: { unit_id: 'غير متاحة' } });
    }
    candidates = [unit];
  } else {
    candidates = await orderByBestFit(
      await findAvailableUnits(property.id, room.unit_type_id, checkIn, checkOut, { tx }),
      checkIn, checkOut, { tx },
    );
  }

  for (const candidate of candidates) {
    const segment = await tx.execute(
      `INSERT INTO reservation_units (reservation_id, line_no, unit_id, unit_type_id, check_in, check_out, adults, children, rate_plan_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reservationId, room.index, candidate.id, room.unit_type_id, checkIn, checkOut, room.adults, room.children, room.ratePlan?.id ?? null],
    );
    try {
      await lockNights(tx, candidate.id, nights, segment.insertId);
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      // سبقنا حجزٌ آخر في لحظة الإدراج: نجرّب التالية
      await tx.execute('DELETE FROM reservation_units WHERE id = ?', [segment.insertId]);
      continue;
    }
    await writeNightPrices(tx, segment.insertId, room.stay.nights);
    await refreshSegmentTotals(tx, segment.insertId);
    return candidate.id;
  }

  if (room.unit_id) {
    throw conflict('الوحدة دي مشغولة في التواريخ دي', 'UNIT_NOT_AVAILABLE', {
      occupied: await describeConflicts(tx, room.unit_id, checkIn, checkOut),
    });
  }
  throw conflict('مفيش وحدة فاضية من النوع ده في التواريخ دي', 'NO_AVAILABILITY');
}

export const bookingEmailPayload = (property, reservation, guest) => ({
  guestName: guest.full_name,
  propertyName: property.name_ar,
  code: reservation.code,
  checkIn: reservation.check_in,
  checkOut: reservation.check_out,
  nights: reservation.nights,
  totalMinor: reservation.total_minor,
  currency: property.currency,
  phone: property.phone,
  holdHours: property.hold_hours,
  depositMinor: reservation.deposit_due_minor,
  lookupUrl: `${env.bookingUrl}/${property.slug}?code=${reservation.public_code}`,
});

async function createInTx(tx, property, plan, input, { user, publicBooking }) {
  const guest = await guestsService.resolveForReservation(tx, property.id, input.guest);
  if (guest.is_blacklisted && !input.override?.blacklist) {
    throw conflict('النزيل ده في القائمة السوداء', 'GUEST_BLACKLISTED', { guest: 'في القائمة السوداء' });
  }

  const status = publicBooking ? 'pending' : input.status;
  const holdUntil = status === 'pending' ? new Date(Date.now() + property.hold_hours * 3_600_000) : null;
  const code = formatSequence(property.booking_prefix, await nextCounter(tx, property.id, 'reservation'));
  const first = plan.rooms[0];

  let reservationId;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await tx.execute(
        `INSERT INTO reservations
           (property_id, code, public_code, guest_id, status, source, external_ref, check_in, check_out, nights,
            adults, children, rate_plan_id, promo_code_id, currency, hold_expires_at, expected_arrival,
            guest_notes, internal_notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [property.id, code, newPublicCode(), guest.id, status, publicBooking ? 'website' : input.source,
          input.external_ref ?? null, input.check_in, input.check_out, diffDays(input.check_in, input.check_out),
          sum(plan.rooms.map((room) => room.adults)), sum(plan.rooms.map((room) => room.children)),
          first.ratePlan?.id ?? null, plan.promo?.id ?? null, property.currency, holdUntil,
          input.expected_arrival ?? null, input.guest_notes ?? null, input.internal_notes ?? null, user?.id ?? null],
      );
      reservationId = result.insertId;
      break;
    } catch (error) {
      // كود عام مكرّر (احتمال ضئيل جدًا): نولّد غيره
      if (isDuplicate(error, 'uq_reservations_public') && attempt < 5) continue;
      throw error;
    }
  }

  for (const room of plan.rooms) {
    await assignRoom(tx, property, reservationId, room, input.check_in, input.check_out);
  }

  if (plan.promo) {
    const used = await tx.execute(
      'UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = ? AND (max_uses IS NULL OR uses_count < max_uses)',
      [plan.promo.id],
    );
    if (used.affectedRows === 0) {
      throw ApiError.unprocessable('كود الخصم استُنفد', { code: 'PROMO_EXHAUSTED', details: { promo_code: 'استُنفد' } });
    }
  }

  const totals = await recalculateReservation(tx, reservationId);
  if (status === 'pending' && property.deposit_percent > 0) {
    await tx.execute('UPDATE reservations SET deposit_due_minor = ? WHERE id = ?', [depositDue(totals.total_minor, property.deposit_percent), reservationId]);
  }

  if (input.deposit && user) {
    await recordPayment(tx, {
      property, reservationId, user,
      input: { type: 'payment', method: input.deposit.method, amount_minor: input.deposit.amount_minor, reference: input.deposit.reference, note: 'دفعة مقدّمة مع الحجز' },
    });
  }

  const reservation = await tx.queryOne('SELECT * FROM reservations WHERE id = ?', [reservationId]);
  if (guest.email && (publicBooking || input.send_confirmation)) {
    await enqueueEmail({
      propertyId: property.id,
      to: guest.email,
      template: status === 'pending' ? 'booking_pending' : 'booking_confirmation',
      payload: bookingEmailPayload(property, reservation, guest),
    }, tx);
  }
  return { reservation, guest };
}

/* ═══════════════ القراءة ═══════════════ */

const LIST_COLUMNS = `r.id, r.code, r.public_code, r.status, r.source, r.check_in, r.check_out, r.nights, r.adults, r.children,
  r.total_minor, r.paid_minor, (r.total_minor - r.paid_minor) AS balance_minor, r.deposit_due_minor, r.hold_expires_at,
  r.created_at, g.id AS guest_id, g.full_name AS guest_name, g.phone AS guest_phone, g.is_vip,
  (SELECT GROUP_CONCAT(DISTINCT u.code ORDER BY u.code SEPARATOR '، ')
     FROM reservation_units ru JOIN units u ON u.id = ru.unit_id WHERE ru.reservation_id = r.id) AS unit_codes`;

async function detail(propertyId, id) {
  const reservation = await queryOne(
    `SELECT r.*, (r.total_minor - r.paid_minor) AS balance_minor,
            g.full_name AS guest_name, g.phone AS guest_phone, g.email AS guest_email, g.nationality AS guest_nationality,
            g.id_type AS guest_id_type, g.id_number AS guest_id_number, g.is_vip, g.is_blacklisted,
            rp.name_ar AS rate_plan_name_ar, pc.code AS promo_code, cu.full_name AS created_by_name
       FROM reservations r
       JOIN guests g ON g.id = r.guest_id
       LEFT JOIN rate_plans rp ON rp.id = r.rate_plan_id
       LEFT JOIN promo_codes pc ON pc.id = r.promo_code_id
       LEFT JOIN users cu ON cu.id = r.created_by
      WHERE r.id = ? AND r.property_id = ?`,
    [id, propertyId],
  );
  if (!reservation) throw ApiError.notFound('الحجز غير موجود');

  const segments = await query(
    `SELECT ru.*, u.code AS unit_code, u.housekeeping_status, u.status AS unit_status,
            t.name_ar AS unit_type_name_ar, t.code AS unit_type_code
       FROM reservation_units ru JOIN units u ON u.id = ru.unit_id JOIN unit_types t ON t.id = ru.unit_type_id
      WHERE ru.reservation_id = ? ORDER BY ru.line_no, ru.check_in, ru.id`,
    [id],
  );
  const nights = segments.length === 0 ? [] : await query(
    `SELECT reservation_unit_id, night, room_minor, extra_guest_minor, meal_minor FROM reservation_nights
      WHERE reservation_unit_id IN (${segments.map(() => '?').join(',')}) ORDER BY night`,
    segments.map((segment) => segment.id),
  );
  const nightsBySegment = new Map();
  for (const night of nights) {
    if (!nightsBySegment.has(night.reservation_unit_id)) nightsBySegment.set(night.reservation_unit_id, []);
    nightsBySegment.get(night.reservation_unit_id).push(night);
  }

  const [items, paymentRows, invoiceRows] = await Promise.all([
    folio.list(id), payments.list(id), invoices.list(propertyId, id),
  ]);

  return {
    ...reservation,
    is_vip: Boolean(reservation.is_vip),
    is_blacklisted: Boolean(reservation.is_blacklisted),
    segments: segments.map((segment) => ({ ...segment, nights: nightsBySegment.get(segment.id) ?? [] })),
    items,
    payments: paymentRows,
    invoices: invoiceRows,
  };
}

/** مُنفِّذ يقفل صفّ الحجز ويشغّل المعالج داخل معاملة مع إعادة المحاولة عند deadlock */
async function mutate(property, id, handler) {
  return withDeadlockRetry(() => transaction(async (tx) => {
    const reservation = await tx.queryOne(
      'SELECT * FROM reservations WHERE id = ? AND property_id = ? FOR UPDATE',
      [id, property.id],
    );
    if (!reservation) throw ApiError.notFound('الحجز غير موجود');
    return handler(tx, reservation);
  }));
}

const badStatus = (reservation, action) =>
  conflict(`مينفعش ${action} لحجز حالته «${STATUS_LABELS[reservation.status]}»`, 'BAD_STATUS', { status: reservation.status });

async function queueCheckoutCleaning(tx, property, reservationId, unitIds, today) {
  for (const unitId of new Set(unitIds)) {
    await tx.execute(
      "UPDATE units SET housekeeping_status = 'dirty', housekeeping_updated_at = NOW() WHERE id = ?",
      [unitId],
    );
    await tx.execute(
      `INSERT INTO housekeeping_tasks (property_id, unit_id, reservation_id, type, due_date)
       VALUES (?, ?, ?, 'checkout_clean', ?)`,
      [property.id, unitId, reservationId, today],
    );
  }
}

/** إلغاء/عدم حضور: نحرّر الليالي، ونُسجّل الغرامة، ونعيد الحساب (الإيراد يصفّر وتبقى الغرامة) */
async function releaseReservation(tx, property, reservation, { status, reason, feeMinor, today }) {
  const segments = await tx.query('SELECT id FROM reservation_units WHERE reservation_id = ?', [reservation.id]);
  for (const segment of segments) {
    await tx.execute('DELETE FROM unit_nights WHERE reservation_unit_id = ?', [segment.id]);
  }
  await tx.execute(
    `UPDATE reservations SET status = ?, cancelled_at = NOW(), cancel_reason = ?, hold_expires_at = NULL WHERE id = ?`,
    [status, reason, reservation.id],
  );
  if (feeMinor > 0) {
    await tx.execute(
      `INSERT INTO folio_items (property_id, reservation_id, type, description, quantity, unit_price_minor, amount_minor,
                                taxable, service_chargeable, posted_on)
       VALUES (?, ?, 'fee', ?, 1, ?, ?, 0, 0, ?)`,
      [property.id, reservation.id, status === 'no_show' ? 'غرامة عدم حضور' : 'غرامة إلغاء', feeMinor, feeMinor, today],
    );
  }
  if (reservation.promo_code_id) {
    await tx.execute('UPDATE promo_codes SET uses_count = GREATEST(uses_count - 1, 0) WHERE id = ?', [reservation.promo_code_id]);
  }
  const totals = await recalculateReservation(tx, reservation.id);
  return { totals, refund_due_minor: Math.max(0, totals.paid_minor - totals.total_minor) };
}

/* ═══════════════ الواجهة العامة للخدمة ═══════════════ */

export const reservations = {
  async list(propertyId, filters) {
    const where = ['r.property_id = ?'];
    const params = [propertyId];

    if (filters.status?.length) { where.push(`r.status IN (${filters.status.map(() => '?').join(',')})`); params.push(...filters.status); }
    if (filters.source) { where.push('r.source = ?'); params.push(filters.source); }
    if (filters.guest_id) { where.push('r.guest_id = ?'); params.push(filters.guest_id); }
    if (filters.check_in_from) { where.push('r.check_in >= ?'); params.push(filters.check_in_from); }
    if (filters.check_in_to) { where.push('r.check_in <= ?'); params.push(filters.check_in_to); }
    if (filters.check_out_from) { where.push('r.check_out >= ?'); params.push(filters.check_out_from); }
    if (filters.check_out_to) { where.push('r.check_out <= ?'); params.push(filters.check_out_to); }
    if (filters.arriving) { where.push("r.check_in = ? AND r.status IN ('pending','confirmed')"); params.push(filters.arriving); }
    if (filters.departing) { where.push("r.check_out = ? AND r.status IN ('checked_in','confirmed')"); params.push(filters.departing); }
    if (filters.stay_on) {
      where.push("r.check_in <= ? AND r.check_out > ? AND r.status IN ('pending','confirmed','checked_in','checked_out')");
      params.push(filters.stay_on, filters.stay_on);
    }
    if (filters.in_house) where.push("r.status = 'checked_in'");
    if (filters.unpaid) where.push("r.total_minor > r.paid_minor AND r.status NOT IN ('cancelled','no_show')");
    if (filters.unit_id) {
      where.push('EXISTS (SELECT 1 FROM reservation_units ru WHERE ru.reservation_id = r.id AND ru.unit_id = ?)');
      params.push(filters.unit_id);
    }
    if (filters.q) {
      const digits = filters.q.replace(/\D/g, '');
      const clauses = ['r.code LIKE ?', 'r.public_code = ?', 'g.full_name LIKE ?', 'r.external_ref LIKE ?'];
      params.push(`%${filters.q}%`, filters.q.toUpperCase(), `%${filters.q}%`, `%${filters.q}%`);
      if (digits.length >= 4) { clauses.push('g.phone LIKE ?'); params.push(`%${digits}%`); }
      where.push(`(${clauses.join(' OR ')})`);
    }

    const base = `FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE ${where.join(' AND ')}`;
    const total = (await queryOne(`SELECT COUNT(*) AS n ${base}`, params)).n;
    const direction = filters.order === 'asc' ? 'ASC' : 'DESC';
    const rows = await query(
      `SELECT ${LIST_COLUMNS} ${base} ORDER BY r.check_in ${direction}, r.id ${direction}
        LIMIT ${safeInt(filters.page_size, { min: 1, max: 100, fallback: 25 })} OFFSET ${safeInt((filters.page - 1) * filters.page_size)}`,
      params,
    );
    return { rows: rows.map((row) => ({ ...row, is_vip: Boolean(row.is_vip) })), meta: pageMeta(filters.page, filters.page_size, total) };
  },

  get: (property, id) => detail(property.id, id),

  /**
   * عرض سعر حجز كامل بنفس خطوات الإنشاء ودون كتابة: كل غرفة بقيودها، والخصم الترويجي مرّة واحدة
   * على المجموع، ثم الخدمة والضريبة. نموذج «حجز جديد» يعرضه كما هو فيطابق ما سيُحفظ بالقرش
   * (جمع عروض غرف منفصلة كان يكرّر الخصم الثابت على كل مجموعة).
   * الكود المرفوض لا يُسقط العرض: يُرجَع سببه ليظهر بجوار الحقل.
   */
  async quote(property, input) {
    const { rooms, violations, today } = await priceRooms(property, input, { allowPast: false, publicOnly: false });

    let promo = null;
    let promoInfo = null;
    if (input.promo_code) {
      const found = await loadPromo(property.id, input.promo_code);
      const verdict = validatePromo({ promo: found, today, checkIn: input.check_in, checkOut: input.check_out });
      if (verdict.valid) promo = found;
      promoInfo = verdict.valid
        ? { code: found.code, valid: true }
        : { code: String(input.promo_code).toUpperCase(), valid: false, reason: verdict.code, message: verdict.message };
    }

    const stays = rooms.map((room) => room.stay);
    const discount = promoDiscount({ promo, base: sum(stays.map((stay) => stay.rooms_minor + stay.extra_guest_minor)) });
    const nights = diffDays(input.check_in, input.check_out);
    const totals = computeTotals({
      lines: reservationLines({ stays, promoDiscountMinor: discount }),
      unitNights: nights * rooms.length,
      property,
    });

    return {
      check_in: input.check_in,
      check_out: input.check_out,
      nights,
      currency: property.currency,
      rooms: rooms.map((room) => ({
        index: room.index,
        unit_type: { id: room.unitType.id, code: room.unitType.code, name_ar: room.unitType.name_ar, name_en: room.unitType.name_en },
        rate_plan: room.ratePlan
          ? { id: room.ratePlan.id, code: room.ratePlan.code, name_ar: room.ratePlan.name_ar, name_en: room.ratePlan.name_en, meal_plan: room.ratePlan.meal_plan, is_refundable: Boolean(room.ratePlan.is_refundable) }
          : null,
        adults: room.adults,
        children: room.children,
        total_minor: room.stay.rooms_minor + room.stay.extra_guest_minor + room.stay.meal_minor,
        bookable: room.stay.violations.length === 0,
      })),
      promo: promoInfo && { ...promoInfo, discount_minor: discount },
      bookable: violations.length === 0,
      violations, // نفس شكل STAY_RESTRICTED عند الإنشاء: [{ room, violations: [{ code, message }] }]
      totals,
      deposit_due_minor: depositDue(totals.total_minor, property.deposit_percent),
    };
  },

  /**
   * إنشاء حجز. `user` = الموظف، وfalsy للحجز العام من الإنترنت.
   * @returns {Promise<object>} تفاصيل الحجز كاملة
   */
  async create(property, input, { user = null, publicBooking = false } = {}) {
    const overrides = input.override ?? {};
    if ((overrides.restrictions || overrides.blacklist || overrides.past) && !canOverride(user)) {
      throw ApiError.forbidden('تجاوز القيود للمدير والمالك فقط', { code: 'OVERRIDE_FORBIDDEN' });
    }
    if (input.deposit && !(user && can(user.role, 'billing.write'))) {
      throw ApiError.forbidden('تسجيل دفعة يحتاج صلاحية الفوترة', { code: 'FORBIDDEN' });
    }

    const plan = await preparePlan(property, input, { allowPast: Boolean(overrides.past), publicOnly: publicBooking });
    if (plan.violations.length > 0 && !overrides.restrictions) {
      const first = plan.violations[0].violations[0];
      throw ApiError.unprocessable(first.message, { code: 'STAY_RESTRICTED', details: { rooms: plan.violations } });
    }

    const created = await withDeadlockRetry(() =>
      transaction((tx) => createInTx(tx, property, plan, input, { user, publicBooking })));
    return detail(property.id, created.reservation.id);
  },

  async update(property, id, changes) {
    const before = await detail(property.id, id);
    const fields = ['guest_notes', 'internal_notes', 'expected_arrival', 'external_ref', 'source'].filter((f) => changes[f] !== undefined);
    if (fields.length > 0) {
      await transaction((tx) => tx.execute(
        `UPDATE reservations SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ? AND property_id = ?`,
        [...fields.map((f) => changes[f]), id, property.id],
      ));
    }
    return { before, after: await detail(property.id, id) };
  },

  async confirm(property, id, { send_confirmation: notify = true } = {}) {
    await mutate(property, id, async (tx, reservation) => {
      if (reservation.status !== 'pending') throw badStatus(reservation, 'تأكّد');
      await tx.execute("UPDATE reservations SET status = 'confirmed', hold_expires_at = NULL WHERE id = ?", [id]);
      const guest = await tx.queryOne('SELECT full_name, email FROM guests WHERE id = ?', [reservation.guest_id]);
      if (notify && guest.email) {
        await enqueueEmail({
          propertyId: property.id, to: guest.email, template: 'booking_confirmation',
          payload: bookingEmailPayload(property, reservation, guest),
        }, tx);
      }
    });
    return detail(property.id, id);
  },

  async checkIn(property, id, input) {
    const warnings = [];
    await mutate(property, id, async (tx, reservation) => {
      if (reservation.status === 'pending') throw conflict('الحجز لسه معلّق — أكّده الأول', 'RESERVATION_PENDING');
      if (reservation.status !== 'confirmed') throw badStatus(reservation, 'تسجّل دخول');

      const today = todayIn(property.timezone);
      if (today >= reservation.check_out) throw conflict('فترة الحجز انتهت', 'STAY_ENDED');

      if (today < reservation.check_in) {
        if (!input.early) {
          throw conflict(`الوصول المتوقّع ${reservation.check_in} — لو الضيف وصل بدري فعّل «وصول مبكّر»`, 'TOO_EARLY', { check_in: reservation.check_in });
        }
        // وصول مبكّر = نقل تاريخ الوصول لليوم (تُسعَّر الليالي المضافة وتُقفَل)
        await resizeStayInTx(tx, property, reservation, { checkIn: today, checkOut: reservation.check_out, overrideRestrictions: true });
      }

      const units = await tx.query(
        `SELECT u.id, u.code, u.status, u.housekeeping_status
           FROM reservation_units ru JOIN units u ON u.id = ru.unit_id
          WHERE ru.reservation_id = ? AND ru.check_in <= ? AND ru.check_out > ?`,
        [id, today, today],
      );
      const broken = units.filter((unit) => unit.status !== 'active');
      if (broken.length > 0) {
        throw conflict(`الوحدة ${broken.map((u) => u.code).join('، ')} خارج الخدمة — انقل النزيل لغرفة تانية`, 'UNIT_OUT_OF_ORDER', { units: broken.map((u) => u.code) });
      }
      const notReady = units.filter((unit) => !['clean', 'inspected'].includes(unit.housekeeping_status));
      if (notReady.length > 0 && !input.force_dirty) {
        throw conflict(`الغرفة ${notReady.map((u) => u.code).join('، ')} لسه متنضّفتش`, 'UNIT_NOT_READY', { units: notReady.map((u) => u.code) });
      }

      const guest = await tx.queryOne('SELECT id_number FROM guests WHERE id = ?', [reservation.guest_id]);
      if (!guest.id_number) warnings.push({ code: 'GUEST_ID_MISSING', message: 'بيانات هوية النزيل غير مسجّلة' });

      await tx.execute("UPDATE reservations SET status = 'checked_in', checked_in_at = NOW() WHERE id = ?", [id]);
    });
    return { reservation: await detail(property.id, id), warnings };
  },

  async checkOut(property, id, input, user) {
    const warnings = [];
    await mutate(property, id, async (tx, reservation) => {
      if (reservation.status !== 'checked_in') throw badStatus(reservation, 'تسجّل خروج');
      const today = todayIn(property.timezone);

      if (today < reservation.check_out) {
        if (input.early_departure && today > reservation.check_in) {
          await resizeStayInTx(tx, property, reservation, { checkIn: reservation.check_in, checkOut: today, overrideRestrictions: true });
        } else {
          warnings.push({ code: 'EARLY_DEPARTURE_NIGHTS_HELD', message: 'الليالي المتبقية لسه محجوزة — فعّل «خروج مبكّر» لتحريرها للبيع' });
        }
      }

      const totals = await recalculateReservation(tx, id);
      const balance = totals.total_minor - totals.paid_minor;
      if (balance > 0) {
        if (!input.allow_unpaid) throw conflict(`على النزيل رصيد مستحق ${balance / 100}`, 'BALANCE_DUE', { balance_minor: balance });
        if (!canOverride(user)) throw ApiError.forbidden('المغادرة برصيد غير مسدّد للمدير والمالك فقط', { code: 'OVERRIDE_FORBIDDEN' });
        warnings.push({ code: 'UNPAID_BALANCE', message: `غادر برصيد غير مسدّد ${balance / 100}`, balance_minor: balance });
      }

      await tx.execute("UPDATE reservations SET status = 'checked_out', checked_out_at = NOW() WHERE id = ?", [id]);
      await tx.execute(
        'UPDATE guests SET total_stays = total_stays + 1, total_spent_minor = total_spent_minor + ? WHERE id = ?',
        [totals.total_minor, reservation.guest_id],
      );

      const last = await tx.query(
        'SELECT DISTINCT unit_id FROM reservation_units WHERE reservation_id = ? AND check_out = (SELECT check_out FROM reservations WHERE id = ?)',
        [id, id],
      );
      await queueCheckoutCleaning(tx, property, id, last.map((row) => row.unit_id), today);
    });
    return { reservation: await detail(property.id, id), warnings };
  },

  async cancel(property, id, input) {
    let result;
    await mutate(property, id, async (tx, reservation) => {
      if (!['pending', 'confirmed'].includes(reservation.status)) {
        throw badStatus(reservation, 'تلغي');
      }
      result = await releaseReservation(tx, property, reservation, {
        status: 'cancelled', reason: input.reason, feeMinor: input.fee_minor, today: todayIn(property.timezone),
      });
      const guest = await tx.queryOne('SELECT full_name, email FROM guests WHERE id = ?', [reservation.guest_id]);
      if (input.notify && guest.email) {
        await enqueueEmail({
          propertyId: property.id, to: guest.email, template: 'booking_cancelled',
          payload: { guestName: guest.full_name, propertyName: property.name_ar, code: reservation.code },
        }, tx);
      }
    });
    return { reservation: await detail(property.id, id), refund_due_minor: result.refund_due_minor };
  },

  async noShow(property, id, input) {
    let result;
    await mutate(property, id, async (tx, reservation) => {
      if (reservation.status !== 'confirmed') throw badStatus(reservation, 'تسجّل عدم حضور');
      const today = todayIn(property.timezone);
      if (today <= reservation.check_in) {
        throw conflict('عدم الحضور يُسجَّل بعد يوم الوصول', 'TOO_EARLY', { check_in: reservation.check_in });
      }
      result = await releaseReservation(tx, property, reservation, {
        status: 'no_show', reason: input.note ?? 'لم يحضر', feeMinor: input.fee_minor, today,
      });
    });
    return { reservation: await detail(property.id, id), refund_due_minor: result.refund_due_minor };
  },

  async changeDates(property, id, input, user) {
    await mutate(property, id, async (tx, reservation) => {
      if (!['pending', 'confirmed', 'checked_in'].includes(reservation.status)) throw badStatus(reservation, 'تعدّل التواريخ');
      if (input.override?.restrictions && !canOverride(user)) {
        throw ApiError.forbidden('تجاوز القيود للمدير والمالك فقط', { code: 'OVERRIDE_FORBIDDEN' });
      }
      assertStayDates(property, input.check_in, input.check_out, { allowPast: true });

      const today = todayIn(property.timezone);
      if (reservation.status === 'checked_in') {
        if (input.check_in !== reservation.check_in) throw conflict('النزيل مقيم — مينفعش تغيّر تاريخ الوصول', 'ARRIVAL_LOCKED');
        if (input.check_out < today) throw conflict('تاريخ المغادرة الجديد قبل اليوم', 'PAST_DATE');
      } else if (!input.override?.past && input.check_in < today) {
        throw conflict('تاريخ الوصول الجديد في الماضي', 'PAST_DATE');
      }

      await resizeStayInTx(tx, property, reservation, {
        checkIn: input.check_in, checkOut: input.check_out,
        allowReassign: input.allow_reassign, overrideRestrictions: Boolean(input.override?.restrictions),
      });
    });
    return detail(property.id, id);
  },

  async moveUnit(property, id, input) {
    let moved;
    await mutate(property, id, async (tx, reservation) => {
      if (!['pending', 'confirmed', 'checked_in'].includes(reservation.status)) throw badStatus(reservation, 'تنقل غرفة');
      moved = await moveSegmentInTx(tx, property, reservation, {
        segmentId: input.segment_id, toUnitId: input.to_unit_id, effectiveDate: input.effective_date,
      });
      if (moved.target_not_ready && reservation.status === 'checked_in' && !input.force_dirty && moved.effective <= todayIn(property.timezone)) {
        throw conflict(`الغرفة ${moved.target_code} لسه متنضّفتش`, 'UNIT_NOT_READY', { units: [moved.target_code] });
      }
      // نزيل مقيم غادر غرفته الآن: تتحوّل القديمة لتنظيف
      if (reservation.status === 'checked_in' && moved.effective <= todayIn(property.timezone)) {
        await queueCheckoutCleaning(tx, property, id, [moved.from_unit_id], todayIn(property.timezone));
      }
    });
    return { reservation: await detail(property.id, id), moved: { from_unit_id: moved.from_unit_id, to_unit_id: moved.to_unit_id, type_changed: moved.type_changed } };
  },
};

/**
 * إلغاء الحجوزات المعلّقة المنتهية مهلتها (مهمة خلفية).
 * لا نلغي حجزًا استلمنا عنه مالًا: يُترك للموظف (تأكيد أو مرتجع) كي لا يضيع عربون.
 */
export async function expireHolds({ batch = 50 } = {}) {
  const due = await query(
    `SELECT id, property_id FROM reservations
      WHERE status = 'pending' AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW() AND paid_minor = 0
      ORDER BY hold_expires_at LIMIT ${safeInt(batch, { min: 1, max: 200, fallback: 50 })}`,
  );

  let expired = 0;
  for (const row of due) {
    const property = await queryOne('SELECT * FROM properties WHERE id = ?', [row.property_id]);
    await withDeadlockRetry(() => transaction(async (tx) => {
      const reservation = await tx.queryOne(
        "SELECT * FROM reservations WHERE id = ? AND status = 'pending' AND paid_minor = 0 FOR UPDATE",
        [row.id],
      );
      if (!reservation) return; // اتأكّد أو اتلغى في الأثناء
      await releaseReservation(tx, property, reservation, {
        status: 'cancelled', reason: 'انتهت مهلة الحجز المعلّق', feeMinor: 0, today: todayIn(property.timezone),
      });
      const guest = await tx.queryOne('SELECT full_name, email FROM guests WHERE id = ?', [reservation.guest_id]);
      if (guest.email) {
        await enqueueEmail({
          propertyId: property.id, to: guest.email, template: 'booking_cancelled',
          payload: { guestName: guest.full_name, propertyName: property.name_ar, code: reservation.code },
        }, tx);
      }
      expired += 1;
    }));
  }
  return expired;
}

