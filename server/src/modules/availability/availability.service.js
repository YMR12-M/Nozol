/**
 * ═══════════════════════════════════════════════════════════════
 *  التوافر: ما الوحدات الفارغة؟ ما الذي يُعرض للنزيل؟ كيف يبدو التقويم؟
 *
 *  «فارغة» = لا صفّ لها في unit_nights لأي ليلة من الإقامة. هذا نفس الجدول
 *  الذي يمنع الحجز المزدوج، فالتوافر والمنع لا يختلفان أبدًا.
 *
 *  ترتيب الاختيار التلقائي (best-fit): نفضّل وحدة ملاصقة لحجز قبلها أو بعدها
 *  على وحدة فارغة تمامًا حولها، فلا نقطّع التقويم إلى ليالٍ مفردة يستحيل
 *  بيعها. فندق صغير يخسر من هذا التفتّت أكثر مما يتخيّل.
 * ═══════════════════════════════════════════════════════════════
 */
import { query } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { addDays, diffDays, todayIn } from '../../utils/dates.js';
import { publicFileUrl } from '../../middleware/upload.js';
import {
  assertStayDates, buildQuote, loadPromo, publicQuote,
} from '../pricing/quote.service.js';

const MAX_CALENDAR_DAYS = 62;

/**
 * وحدات النوع الفارغة في [الوصول، المغادرة).
 * `excludeReservationId`: عند تعديل حجز نعتبر ليالي الحجز نفسه فارغة.
 */
export function findAvailableUnits(propertyId, unitTypeId, checkIn, checkOut, { excludeReservationId = 0, tx = { query } } = {}) {
  return tx.query(
    `SELECT u.id, u.code, u.floor, u.sort_order, u.housekeeping_status
       FROM units u
      WHERE u.property_id = ? AND u.unit_type_id = ? AND u.status = 'active' AND u.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM unit_nights n
            LEFT JOIN reservation_units ru ON ru.id = n.reservation_unit_id
           WHERE n.unit_id = u.id AND n.night >= ? AND n.night < ?
             AND (ru.reservation_id IS NULL OR ru.reservation_id <> ?)
        )
      ORDER BY u.sort_order, u.code`,
    [propertyId, unitTypeId, checkIn, checkOut, excludeReservationId],
  );
}

/** يرتّب المرشَّحين: الملاصق لإشغال أولًا (الأقل تفتيتًا) ثم ترتيب العرض */
export async function orderByBestFit(candidates, checkIn, checkOut, { tx = { query } } = {}) {
  if (candidates.length <= 1) return candidates;

  const before = addDays(checkIn, -1);
  const ids = candidates.map((unit) => unit.id);
  const rows = await tx.query(
    `SELECT unit_id, night FROM unit_nights
      WHERE unit_id IN (${ids.map(() => '?').join(',')}) AND night IN (?, ?)`,
    [...ids, before, checkOut],
  );
  const occupiedSides = new Map();
  for (const row of rows) occupiedSides.set(row.unit_id, (occupiedSides.get(row.unit_id) ?? 0) + 1);

  // كلما زاد عدد الجانبين المشغولين قلّ التفتيت ← نفضّله
  return [...candidates].sort((a, b) =>
    ((occupiedSides.get(b.id) ?? 0) - (occupiedSides.get(a.id) ?? 0)) || (a.sort_order - b.sort_order));
}

/** عدد الوحدات الفارغة لكل نوع (استعلام واحد للمنشأة كلها) */
async function availableCounts(propertyId, checkIn, checkOut) {
  const rows = await query(
    `SELECT u.unit_type_id, COUNT(*) AS n
       FROM units u
      WHERE u.property_id = ? AND u.status = 'active' AND u.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM unit_nights n WHERE n.unit_id = u.id AND n.night >= ? AND n.night < ?
        )
      GROUP BY u.unit_type_id`,
    [propertyId, checkIn, checkOut],
  );
  return new Map(rows.map((row) => [row.unit_type_id, row.n]));
}

/**
 * بحث التوافر مع الأسعار.
 * @param {boolean} publicOnly  للضيف على الإنترنت: خطط علنية فقط، وبلا الأنواع المقيّدة.
 */
export async function searchAvailability(property, params, { publicOnly = false } = {}) {
  const { check_in: checkIn, check_out: checkOut, adults, children = 0 } = params;
  assertStayDates(property, checkIn, checkOut);
  const today = todayIn(property.timezone);

  const [types, plans, rules, counts, promo, photos] = await Promise.all([
    query(
      `SELECT * FROM unit_types WHERE property_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY sort_order, id`,
      [property.id],
    ),
    query(
      `SELECT * FROM rate_plans WHERE property_id = ? AND is_active = 1 ${publicOnly ? 'AND is_public = 1' : ''}
        ${params.rate_plan_id ? 'AND id = ?' : ''} ORDER BY is_default DESC, sort_order, id`,
      params.rate_plan_id ? [property.id, params.rate_plan_id] : [property.id],
    ),
    query(
      `SELECT * FROM price_rules WHERE property_id = ? AND is_active = 1 AND start_date <= ? AND end_date >= ?`,
      [property.id, checkOut, checkIn],
    ),
    availableCounts(property.id, checkIn, checkOut),
    loadPromo(property.id, params.promo_code),
    query("SELECT * FROM attachments WHERE property_id = ? AND entity = 'unit_type' ORDER BY sort_order, id", [property.id]),
  ]);

  const rulesByType = new Map();
  for (const rule of rules) {
    if (!rulesByType.has(rule.unit_type_id)) rulesByType.set(rule.unit_type_id, []);
    rulesByType.get(rule.unit_type_id).push(rule);
  }
  const photosByType = new Map();
  for (const photo of photos) {
    if (!photosByType.has(photo.entity_id)) photosByType.set(photo.entity_id, []);
    photosByType.get(photo.entity_id).push({ id: photo.id, url: publicFileUrl(photo.file_path) });
  }

  // بلا خطط معرّفة: نعرض الغرفة وحدها كخطة ضمنيّة
  const planList = plans.length > 0 ? plans : [null];
  const results = [];

  for (const type of types) {
    const available = counts.get(type.id) ?? 0;
    const capacityOk = adults <= type.max_adults && children <= type.max_children && adults + children <= type.max_occupancy;
    if (available === 0 || !capacityOk) {
      if (!publicOnly) results.push({ unit_type: summarizeType(type, photosByType), available_units: available, capacity_ok: capacityOk, plans: [] });
      continue;
    }

    const offers = planList.map((plan) => {
      const quote = buildQuote({
        property, unitType: type, ratePlan: plan, rules: rulesByType.get(type.id) ?? [],
        promo, promoRequested: params.promo_code ?? null,
        checkIn, checkOut, adults, children, units: 1, today,
      });
      return publicQuote(quote);
    });

    // للضيف: لا نعرض عروضًا مخالِفة للقيود (حدّ أدنى للإقامة...) — الموظف يراها مع السبب
    const visible = publicOnly ? offers.filter((offer) => offer.bookable) : offers;
    if (publicOnly && visible.length === 0) continue;

    results.push({
      unit_type: summarizeType(type, photosByType),
      available_units: available,
      capacity_ok: true,
      plans: visible,
    });
  }

  return { check_in: checkIn, check_out: checkOut, nights: diffDays(checkIn, checkOut), adults, children, results };
}

function summarizeType(type, photosByType) {
  const amenities = typeof type.amenities === 'string' ? JSON.parse(type.amenities) : (type.amenities ?? []);
  return {
    id: type.id, code: type.code, kind: type.kind,
    name_ar: type.name_ar, name_en: type.name_en,
    description_ar: type.description_ar, description_en: type.description_en,
    base_adults: type.base_adults, max_adults: type.max_adults, max_children: type.max_children,
    max_occupancy: type.max_occupancy, bedrooms: type.bedrooms, beds: type.beds, size_sqm: type.size_sqm,
    amenities,
    photos: photosByType.get(type.id) ?? [],
  };
}

/**
 * بيانات تقويم الإشغال (الـ tape chart): الوحدات + مقاطع الإشغال والحجب في المدى.
 * نقرأ مقاطع الحجز (reservation_units) لا ليالي منفردة: أقل صفوفًا وأسهل رسمًا.
 * الحجوزات الملغاة وعدم الحضور لا تظهر (ليالُيها محرَّرة).
 */
export async function calendar(property, { from, to }) {
  const days = diffDays(from, to) + 1;
  if (days < 1 || days > MAX_CALENDAR_DAYS) {
    throw ApiError.badRequest(`المدى بين 1 و${MAX_CALENDAR_DAYS} يوم`, { code: 'BAD_RANGE' });
  }
  const end = addDays(to, 1); // المدى [from, to] شامل ← نقارن بـ end غير شامل

  const [units, stays, blocks] = await Promise.all([
    query(
      `SELECT u.id, u.code, u.floor, u.status, u.housekeeping_status, u.unit_type_id,
              t.name_ar AS unit_type_name_ar, t.code AS unit_type_code, t.sort_order AS type_order
         FROM units u JOIN unit_types t ON t.id = u.unit_type_id
        WHERE u.property_id = ? AND u.deleted_at IS NULL AND u.status <> 'archived' AND t.deleted_at IS NULL
        ORDER BY t.sort_order, t.id, u.sort_order, u.code`,
      [property.id],
    ),
    query(
      `SELECT ru.id AS segment_id, ru.unit_id, ru.check_in, ru.check_out, ru.adults, ru.children,
              r.id AS reservation_id, r.code, r.status, r.source, r.total_minor, r.paid_minor, r.check_in AS res_check_in, r.check_out AS res_check_out,
              g.full_name AS guest_name, g.is_vip
         FROM reservation_units ru
         JOIN reservations r ON r.id = ru.reservation_id
         JOIN guests g ON g.id = r.guest_id
        WHERE r.property_id = ? AND r.status IN ('pending','confirmed','checked_in','checked_out')
          AND ru.check_in < ? AND ru.check_out > ?
        ORDER BY ru.check_in`,
      [property.id, end, from],
    ),
    query(
      `SELECT id, unit_id, start_date, end_date, reason, note, ical_feed_id
         FROM unit_blocks WHERE property_id = ? AND start_date < ? AND end_date > ? ORDER BY start_date`,
      [property.id, end, from],
    ),
  ]);

  return {
    from, to, today: todayIn(property.timezone),
    units,
    stays: stays.map((stay) => ({
      kind: 'stay',
      segment_id: stay.segment_id,
      unit_id: stay.unit_id,
      start: stay.check_in,
      end: stay.check_out, // غير شاملة
      reservation: {
        id: stay.reservation_id, code: stay.code, status: stay.status, source: stay.source,
        guest_name: stay.guest_name, is_vip: Boolean(stay.is_vip),
        adults: stay.adults, children: stay.children,
        total_minor: stay.total_minor, paid_minor: stay.paid_minor,
        check_in: stay.res_check_in, check_out: stay.res_check_out,
      },
    })),
    blocks: blocks.map((block) => ({
      kind: 'block', block_id: block.id, unit_id: block.unit_id,
      start: block.start_date, end: block.end_date, reason: block.reason, note: block.note,
      external: Boolean(block.ical_feed_id),
    })),
  };
}

/** وحدات النوع الفارغة (مرتَّبة بالأنسب أولًا) مع حالة تنظيفها */
export async function listAvailableUnits(property, { unit_type_id: unitTypeId, check_in: checkIn, check_out: checkOut, exclude_reservation_id: excludeId }) {
  assertStayDates(property, checkIn, checkOut, { allowPast: true });
  const units = await findAvailableUnits(property.id, unitTypeId, checkIn, checkOut, { excludeReservationId: excludeId ?? 0 });
  const ordered = await orderByBestFit(units, checkIn, checkOut);
  return ordered.map(({ id, code, floor, housekeeping_status: housekeepingStatus }) => ({
    id, code, floor, housekeeping_status: housekeepingStatus,
  }));
}
