/**
 * ═══════════════════════════════════════════════════════════════
 *  التقارير والمؤشّرات
 *
 *  تعريفات (موثّقة لأن الخلاف عليها شائع):
 *   • الإشغال = ليالٍ مشغولة ÷ ليالٍ متاحة. المتاحة = وحدات فعّالة − ليالي حجب
 *     (صيانة/iCal). الحجب لا يُحسب «خسارة إشغال» بل يُخرَج من المقام.
 *   • إيراد الغرفة (استحقاق) = سعر الليلة + رسوم الأفراد، يُنسَب لليلة الإقامة
 *     لا ليوم الدفع. الوجبات والخدمات تُذكر منفصلة. الضرائب والخدمة لا تدخل
 *     (هي مستحقّة للدولة/الموظفين لا إيراد للمنشأة).
 *   • ADR = إيراد الغرفة ÷ الليالي المشغولة.  RevPAR = إيراد الغرفة ÷ الليالي المتاحة.
 *   • النقدية (المدفوعات) تُحسب بيوم الاستلام، منفصلة عن الاستحقاق.
 *  الحجوزات المحتسَبة: مؤكّدة + مقيمة + مغادِرة (المعلّقة تظهر في التوقّعات فقط).
 * ═══════════════════════════════════════════════════════════════
 */
import { query, queryOne } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { addDays, dayBoundsUtc, diffDays, eachDay, todayIn } from '../../utils/dates.js';
import { money, toCsv } from '../../utils/csv.js';

const COUNTED = "('confirmed','checked_in','checked_out')";
const MAX_RANGE_DAYS = 366;

function assertRange(from, to) {
  const days = diffDays(from, to) + 1;
  if (days < 1 || days > MAX_RANGE_DAYS) {
    throw ApiError.badRequest(`المدى لازم بين 1 و${MAX_RANGE_DAYS} يوم`, { code: 'BAD_RANGE' });
  }
  return days;
}

const toMap = (rows, key = 'day') => new Map(rows.map((row) => [row[key], row]));
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const sellableUnits = async (propertyId) => (await queryOne(
  "SELECT COUNT(*) AS n FROM units WHERE property_id = ? AND deleted_at IS NULL AND status = 'active'",
  [propertyId],
)).n;

export const reports = {
  /** لوحة الاستقبال اليوم: وصول، مغادرة، مقيمون، جاهزية، مال */
  async today(property) {
    const today = todayIn(property.timezone);
    const bounds = dayBoundsUtc(today, property.timezone);

    const rowSql = `SELECT r.id, r.code, r.status, r.check_in, r.check_out, r.nights, r.adults, r.children,
        r.total_minor, r.paid_minor, (r.total_minor - r.paid_minor) AS balance_minor, r.expected_arrival, r.hold_expires_at,
        g.full_name AS guest_name, g.phone AS guest_phone, g.is_vip,
        (SELECT GROUP_CONCAT(DISTINCT u.code ORDER BY u.code SEPARATOR '، ')
           FROM reservation_units ru JOIN units u ON u.id = ru.unit_id WHERE ru.reservation_id = r.id) AS unit_codes,
        (SELECT COUNT(*) FROM reservation_units ru JOIN units u ON u.id = ru.unit_id
          WHERE ru.reservation_id = r.id AND ru.check_in <= ? AND ru.check_out > ?
            AND u.housekeeping_status NOT IN ('clean','inspected')) AS units_not_ready
      FROM reservations r JOIN guests g ON g.id = r.guest_id`;

    const [arrivals, departures, overdue, inHouse] = await Promise.all([
      query(`${rowSql} WHERE r.property_id = ? AND r.status IN ('pending','confirmed') AND r.check_in = ? ORDER BY r.expected_arrival, r.id`, [today, today, property.id, today]),
      query(`${rowSql} WHERE r.property_id = ? AND r.status = 'checked_in' AND r.check_out = ? ORDER BY r.id`, [today, today, property.id, today]),
      query(`${rowSql} WHERE r.property_id = ? AND r.status = 'checked_in' AND r.check_out < ? ORDER BY r.check_out`, [today, today, property.id, today]),
      query(`${rowSql} WHERE r.property_id = ? AND r.status = 'checked_in' AND r.check_out > ? ORDER BY r.check_out`, [today, today, property.id, today]),
    ]);

    const [occupiedTonight, blockedTonight, sellable, hk, pending, maint, paymentsToday, unpaid] = await Promise.all([
      queryOne(
        `SELECT COALESCE(SUM(r.status IN ${COUNTED}), 0) AS n, COALESCE(SUM(r.status = 'pending'), 0) AS held
           FROM unit_nights n
           JOIN units u ON u.id = n.unit_id
           JOIN reservation_units ru ON ru.id = n.reservation_unit_id
           JOIN reservations r ON r.id = ru.reservation_id
          WHERE u.property_id = ? AND n.night = ?`,
        [property.id, today],
      ),
      queryOne(
        `SELECT COUNT(*) AS n FROM unit_nights n JOIN units u ON u.id = n.unit_id
          WHERE u.property_id = ? AND n.night = ? AND n.block_id IS NOT NULL`,
        [property.id, today],
      ),
      sellableUnits(property.id),
      query(
        `SELECT housekeeping_status AS status, COUNT(*) AS n FROM units
          WHERE property_id = ? AND deleted_at IS NULL AND status = 'active' GROUP BY housekeeping_status`,
        [property.id],
      ),
      queryOne(
        `SELECT COUNT(*) AS n, SUM(hold_expires_at IS NOT NULL AND hold_expires_at < DATE_ADD(NOW(), INTERVAL 6 HOUR)) AS expiring
           FROM reservations WHERE property_id = ? AND status = 'pending'`,
        [property.id],
      ),
      queryOne(
        `SELECT COUNT(*) AS open_count, COALESCE(SUM(priority = 'urgent'), 0) AS urgent
           FROM maintenance_requests WHERE property_id = ? AND status IN ('open','in_progress','waiting_parts')`,
        [property.id],
      ),
      query(
        `SELECT method, SUM(CASE WHEN type = 'payment' THEN amount_minor ELSE -amount_minor END) AS net_minor
           FROM payments WHERE property_id = ? AND voided_at IS NULL AND received_at >= ? AND received_at < ? GROUP BY method`,
        [property.id, bounds.start, bounds.end],
      ),
      queryOne(
        `SELECT COALESCE(SUM(total_minor - paid_minor), 0) AS total, COUNT(*) AS n
           FROM reservations WHERE property_id = ? AND status = 'checked_in' AND total_minor > paid_minor`,
        [property.id],
      ),
    ]);

    const available = Math.max(0, sellable - blockedTonight.n);
    const hkCounts = Object.fromEntries(hk.map((row) => [row.status, row.n]));

    return {
      date: today,
      arrivals,
      departures,
      overdue_departures: overdue,
      in_house: inHouse,
      stats: {
        arrivals: arrivals.length,
        departures: departures.length,
        in_house: inHouse.length + departures.length + overdue.length,
        occupied_tonight: Number(occupiedTonight.n),
        held_tonight: Number(occupiedTonight.held),
        available_tonight: available,
        occupancy_pct: pct(Number(occupiedTonight.n), available),
        pending_bookings: pending.n,
        pending_expiring_soon: Number(pending.expiring ?? 0),
        open_maintenance: maint.open_count,
        urgent_maintenance: Number(maint.urgent),
        unpaid_in_house_minor: Number(unpaid.total),
        unpaid_in_house_count: unpaid.n,
      },
      housekeeping: {
        dirty: hkCounts.dirty ?? 0, cleaning: hkCounts.cleaning ?? 0,
        clean: hkCounts.clean ?? 0, inspected: hkCounts.inspected ?? 0,
      },
      payments_today: paymentsToday.map((row) => ({ method: row.method, net_minor: Number(row.net_minor) })),
    };
  },

  /** إشغال يومي + ADR وRevPAR */
  async occupancy(property, { from, to }) {
    assertRange(from, to);
    const [occupied, blocked, revenue, sellable] = await Promise.all([
      query(
        `SELECT n.night AS day, COUNT(*) AS n
           FROM unit_nights n
           JOIN units u ON u.id = n.unit_id
           JOIN reservation_units ru ON ru.id = n.reservation_unit_id
           JOIN reservations r ON r.id = ru.reservation_id
          WHERE u.property_id = ? AND r.status IN ${COUNTED} AND n.night BETWEEN ? AND ? GROUP BY n.night`,
        [property.id, from, to],
      ),
      query(
        `SELECT n.night AS day, COUNT(*) AS n FROM unit_nights n JOIN units u ON u.id = n.unit_id
          WHERE u.property_id = ? AND n.block_id IS NOT NULL AND n.night BETWEEN ? AND ? GROUP BY n.night`,
        [property.id, from, to],
      ),
      query(
        `SELECT rn.night AS day, SUM(rn.room_minor + rn.extra_guest_minor) AS room, SUM(rn.meal_minor) AS meal
           FROM reservation_nights rn
           JOIN reservation_units ru ON ru.id = rn.reservation_unit_id
           JOIN reservations r ON r.id = ru.reservation_id
          WHERE r.property_id = ? AND r.status IN ${COUNTED} AND rn.night BETWEEN ? AND ? GROUP BY rn.night`,
        [property.id, from, to],
      ),
      sellableUnits(property.id),
    ]);
    const occupiedBy = toMap(occupied);
    const blockedBy = toMap(blocked);
    const revenueBy = toMap(revenue);

    let totalOccupied = 0;
    let totalAvailable = 0;
    let totalRoom = 0;
    let totalMeal = 0;
    const days = eachDay(from, to).map((day) => {
      const occ = occupiedBy.get(day)?.n ?? 0;
      const available = Math.max(0, sellable - (blockedBy.get(day)?.n ?? 0));
      const room = Number(revenueBy.get(day)?.room ?? 0);
      const meal = Number(revenueBy.get(day)?.meal ?? 0);
      totalOccupied += occ; totalAvailable += available; totalRoom += room; totalMeal += meal;
      return {
        day, occupied: occ, available, occupancy_pct: pct(occ, available),
        room_revenue_minor: room, meal_revenue_minor: meal,
        adr_minor: occ > 0 ? Math.round(room / occ) : 0,
        revpar_minor: available > 0 ? Math.round(room / available) : 0,
      };
    });

    return {
      from, to, days,
      summary: {
        occupied_nights: totalOccupied,
        available_nights: totalAvailable,
        occupancy_pct: pct(totalOccupied, totalAvailable),
        room_revenue_minor: totalRoom,
        meal_revenue_minor: totalMeal,
        adr_minor: totalOccupied > 0 ? Math.round(totalRoom / totalOccupied) : 0,
        revpar_minor: totalAvailable > 0 ? Math.round(totalRoom / totalAvailable) : 0,
      },
    };
  },

  /** الإيراد (استحقاق) + النقدية + المصروفات للمدى */
  async revenue(property, { from, to }) {
    assertRange(from, to);
    const bounds = {
      start: dayBoundsUtc(from, property.timezone).start,
      end: dayBoundsUtc(to, property.timezone).end,
    };

    const nightsSql = `FROM reservation_nights rn
        JOIN reservation_units ru ON ru.id = rn.reservation_unit_id
        JOIN reservations r ON r.id = ru.reservation_id
       WHERE r.property_id = ? AND r.status IN ${COUNTED} AND rn.night BETWEEN ? AND ?`;
    const args = [property.id, from, to];

    const [bySource, byType, totals, extras, payments, expenses] = await Promise.all([
      query(
        `SELECT r.source, COUNT(DISTINCT r.id) AS reservations, COUNT(*) AS nights,
                SUM(rn.room_minor + rn.extra_guest_minor) AS room_minor
           ${nightsSql} GROUP BY r.source ORDER BY room_minor DESC`,
        args,
      ),
      query(
        `SELECT t.id, t.name_ar, COUNT(*) AS nights, SUM(rn.room_minor + rn.extra_guest_minor) AS room_minor
           ${nightsSql.replace('JOIN reservations r', 'JOIN unit_types t ON t.id = ru.unit_type_id JOIN reservations r')}
          GROUP BY t.id, t.name_ar ORDER BY room_minor DESC`,
        args,
      ),
      queryOne(`SELECT COALESCE(SUM(rn.room_minor + rn.extra_guest_minor), 0) AS room, COALESCE(SUM(rn.meal_minor), 0) AS meal ${nightsSql}`, args),
      queryOne(
        `SELECT COALESCE(SUM(f.amount_minor), 0) AS total FROM folio_items f
           JOIN reservations r ON r.id = f.reservation_id
          WHERE f.property_id = ? AND f.voided_at IS NULL AND f.posted_on BETWEEN ? AND ?`,
        args,
      ),
      query(
        `SELECT method, SUM(CASE WHEN type = 'payment' THEN amount_minor ELSE 0 END) AS received_minor,
                SUM(CASE WHEN type = 'refund' THEN amount_minor ELSE 0 END) AS refunded_minor
           FROM payments WHERE property_id = ? AND voided_at IS NULL AND received_at >= ? AND received_at < ? GROUP BY method`,
        [property.id, bounds.start, bounds.end],
      ),
      query(
        `SELECT category, SUM(amount_minor) AS total_minor FROM expenses
          WHERE property_id = ? AND voided_at IS NULL AND spent_on BETWEEN ? AND ? GROUP BY category ORDER BY total_minor DESC`,
        args,
      ),
    ]);

    const received = payments.reduce((sumValue, row) => sumValue + Number(row.received_minor), 0);
    const refunded = payments.reduce((sumValue, row) => sumValue + Number(row.refunded_minor), 0);
    const spent = expenses.reduce((sumValue, row) => sumValue + Number(row.total_minor), 0);

    return {
      from, to,
      accrual: {
        room_revenue_minor: Number(totals.room),
        meal_revenue_minor: Number(totals.meal),
        extras_minor: Number(extras.total),
        total_minor: Number(totals.room) + Number(totals.meal) + Number(extras.total),
      },
      by_source: bySource.map((row) => ({ ...row, room_minor: Number(row.room_minor) })),
      by_unit_type: byType.map((row) => ({ ...row, room_minor: Number(row.room_minor) })),
      cash: {
        received_minor: received,
        refunded_minor: refunded,
        net_minor: received - refunded,
        by_method: payments.map((row) => ({ method: row.method, received_minor: Number(row.received_minor), refunded_minor: Number(row.refunded_minor) })),
      },
      expenses: { total_minor: spent, by_category: expenses.map((row) => ({ ...row, total_minor: Number(row.total_minor) })) },
      net_cash_minor: received - refunded - spent,
    };
  },

  /** توقّع الإشغال للأيام القادمة: مؤكّد ومعلّق منفصلان */
  async forecast(property, { days }) {
    const from = todayIn(property.timezone);
    const to = addDays(from, days - 1);
    const [rows, blocked, sellable] = await Promise.all([
      query(
        `SELECT n.night AS day, SUM(r.status = 'pending') AS pending, SUM(r.status <> 'pending') AS confirmed
           FROM unit_nights n
           JOIN reservation_units ru ON ru.id = n.reservation_unit_id
           JOIN reservations r ON r.id = ru.reservation_id
           JOIN units u ON u.id = n.unit_id
          WHERE u.property_id = ? AND n.night BETWEEN ? AND ? GROUP BY n.night`,
        [property.id, from, to],
      ),
      query(
        `SELECT n.night AS day, COUNT(*) AS n FROM unit_nights n JOIN units u ON u.id = n.unit_id
          WHERE u.property_id = ? AND n.block_id IS NOT NULL AND n.night BETWEEN ? AND ? GROUP BY n.night`,
        [property.id, from, to],
      ),
      sellableUnits(property.id),
    ]);
    const byDay = toMap(rows);
    const blockedBy = toMap(blocked);

    return {
      from, to,
      days: eachDay(from, to).map((day) => {
        const confirmed = Number(byDay.get(day)?.confirmed ?? 0);
        const pending = Number(byDay.get(day)?.pending ?? 0);
        const available = Math.max(0, sellable - (blockedBy.get(day)?.n ?? 0));
        return {
          day, confirmed, pending, available,
          free: Math.max(0, available - confirmed - pending),
          occupancy_pct: pct(confirmed, available),
          occupancy_with_pending_pct: pct(confirmed + pending, available),
        };
      }),
    };
  },

  async reservationsCsv(property, { from, to }) {
    assertRange(from, to);
    const rows = await query(
      `SELECT r.code, r.status, r.source, r.check_in, r.check_out, r.nights, r.adults, r.children,
              r.rooms_minor, r.extra_guest_minor, r.meal_minor, r.extras_minor, r.discount_minor,
              r.service_charge_minor, r.tax_minor, r.city_fee_minor, r.total_minor, r.paid_minor, r.created_at,
              g.full_name AS guest_name, g.phone AS guest_phone, g.nationality,
              (SELECT GROUP_CONCAT(DISTINCT u.code ORDER BY u.code SEPARATOR ' ') FROM reservation_units ru
                 JOIN units u ON u.id = ru.unit_id WHERE ru.reservation_id = r.id) AS units
         FROM reservations r JOIN guests g ON g.id = r.guest_id
        WHERE r.property_id = ? AND r.check_in <= ? AND r.check_out > ? ORDER BY r.check_in, r.id`,
      [property.id, to, from],
    );
    return toCsv(rows, [
      { header: 'كود الحجز', value: (r) => r.code },
      { header: 'الحالة', value: (r) => r.status },
      { header: 'المصدر', value: (r) => r.source },
      { header: 'النزيل', value: (r) => r.guest_name },
      { header: 'الهاتف', value: (r) => r.guest_phone },
      { header: 'الجنسية', value: (r) => r.nationality },
      { header: 'الوحدات', value: (r) => r.units },
      { header: 'الوصول', value: (r) => r.check_in },
      { header: 'المغادرة', value: (r) => r.check_out },
      { header: 'الليالي', value: (r) => r.nights },
      { header: 'بالغون', value: (r) => r.adults },
      { header: 'أطفال', value: (r) => r.children },
      { header: 'الإقامة', value: (r) => money(r.rooms_minor) },
      { header: 'أفراد إضافيون', value: (r) => money(r.extra_guest_minor) },
      { header: 'وجبات', value: (r) => money(r.meal_minor) },
      { header: 'خدمات', value: (r) => money(r.extras_minor) },
      { header: 'خصم', value: (r) => money(r.discount_minor) },
      { header: 'خدمة', value: (r) => money(r.service_charge_minor) },
      { header: 'ضريبة', value: (r) => money(r.tax_minor) },
      { header: 'رسم المدينة', value: (r) => money(r.city_fee_minor) },
      { header: 'الإجمالي', value: (r) => money(r.total_minor) },
      { header: 'المدفوع', value: (r) => money(r.paid_minor) },
      { header: 'المتبقي', value: (r) => money(r.total_minor - r.paid_minor) },
      { header: 'تاريخ الإنشاء', value: (r) => r.created_at },
    ]);
  },

  async paymentsCsv(property, { from, to }) {
    assertRange(from, to);
    const bounds = { start: dayBoundsUtc(from, property.timezone).start, end: dayBoundsUtc(to, property.timezone).end };
    const rows = await query(
      `SELECT p.id, p.type, p.method, p.amount_minor, p.reference, p.received_at, p.voided_at,
              r.code AS reservation_code, g.full_name AS guest_name, u.full_name AS received_by
         FROM payments p JOIN reservations r ON r.id = p.reservation_id JOIN guests g ON g.id = r.guest_id
         LEFT JOIN users u ON u.id = p.received_by
        WHERE p.property_id = ? AND p.received_at >= ? AND p.received_at < ? ORDER BY p.received_at, p.id`,
      [property.id, bounds.start, bounds.end],
    );
    return toCsv(rows, [
      { header: 'رقم', value: (r) => r.id },
      { header: 'التاريخ', value: (r) => r.received_at },
      { header: 'الحجز', value: (r) => r.reservation_code },
      { header: 'النزيل', value: (r) => r.guest_name },
      { header: 'النوع', value: (r) => r.type },
      { header: 'الطريقة', value: (r) => r.method },
      { header: 'المبلغ', value: (r) => money(r.type === 'refund' ? -r.amount_minor : r.amount_minor) },
      { header: 'المرجع', value: (r) => r.reference },
      { header: 'استلمه', value: (r) => r.received_by },
      { header: 'ملغاة', value: (r) => (r.voided_at ? 'نعم' : '') },
    ]);
  },
};
