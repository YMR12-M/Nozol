/**
 * عمليات الليالي منخفضة المستوى: قفلها، تسعيرها، وإعادة حساب أرقام الجزء.
 * كلها تعمل داخل معاملة (`tx`) لأن أي خلل بين خطواتها يترك حجزًا نصف مكتوب.
 */

const rows = (count, width) =>
  Array.from({ length: count }, () => `(${Array(width).fill('?').join(',')})`).join(',');

/**
 * يقفل ليالي وحدة لجزء إقامة. المفتاح الأساسي (unit_id, night) يرفض أي ليلة
 * مشغولة بخطأ ER_DUP_ENTRY — يلتقطه المنادي ليجرّب وحدة أخرى أو يعتذر.
 */
export async function lockNights(tx, unitId, nights, segmentId) {
  if (nights.length === 0) return;
  await tx.execute(
    `INSERT INTO unit_nights (unit_id, night, reservation_unit_id) VALUES ${rows(nights.length, 3)}`,
    nights.flatMap((night) => [unitId, night, segmentId]),
  );
}

/** يكتب سعر كل ليلة (تفصيل التدقيق والتقارير) */
export async function writeNightPrices(tx, segmentId, nights) {
  if (nights.length === 0) return;
  await tx.execute(
    `INSERT INTO reservation_nights (reservation_unit_id, night, room_minor, extra_guest_minor, meal_minor, rule_id)
     VALUES ${rows(nights.length, 6)}`,
    nights.flatMap((night) => [segmentId, night.date, night.room_minor, night.extra_guest_minor, night.meal_minor, night.rule_id ?? null]),
  );
}

/** يعيد جمع أسعار ليالي الجزء في أعمدته (rooms/extra_guest/meal) */
export async function refreshSegmentTotals(tx, segmentId) {
  await tx.execute(
    `UPDATE reservation_units ru SET
       rooms_minor       = (SELECT COALESCE(SUM(room_minor), 0)        FROM reservation_nights rn WHERE rn.reservation_unit_id = ru.id),
       extra_guest_minor = (SELECT COALESCE(SUM(extra_guest_minor), 0) FROM reservation_nights rn WHERE rn.reservation_unit_id = ru.id),
       meal_minor        = (SELECT COALESCE(SUM(meal_minor), 0)        FROM reservation_nights rn WHERE rn.reservation_unit_id = ru.id)
     WHERE ru.id = ?`,
    [segmentId],
  );
}

/** يحرّر ليالي جزء (كلها أو من تاريخ معيّن) مع حذف تسعيرها */
export async function releaseNights(tx, segmentId, { from = null, to = null } = {}) {
  const clauses = ['reservation_unit_id = ?'];
  const params = [segmentId];
  if (from) { clauses.push('night >= ?'); params.push(from); }
  if (to) { clauses.push('night < ?'); params.push(to); }
  await tx.execute(`DELETE FROM unit_nights WHERE ${clauses.join(' AND ')}`, params);
  await tx.execute(`DELETE FROM reservation_nights WHERE ${clauses.join(' AND ')}`, params);
}

/**
 * مَن يشغل هذه الليالي؟ — لنشرح للموظف سبب رفض العملية بدل رسالة «مشغولة» مبهمة.
 * `executor` أي كائن بواجهة query (الـ pool أو معاملة).
 */
export function describeConflicts(executor, unitId, start, end) {
  return executor.query(
    `SELECT n.night, r.code AS reservation_code, r.id AS reservation_id, g.full_name AS guest_name, b.reason AS block_reason
       FROM unit_nights n
       LEFT JOIN reservation_units ru ON ru.id = n.reservation_unit_id
       LEFT JOIN reservations r ON r.id = ru.reservation_id
       LEFT JOIN guests g ON g.id = r.guest_id
       LEFT JOIN unit_blocks b ON b.id = n.block_id
      WHERE n.unit_id = ? AND n.night >= ? AND n.night < ?
      ORDER BY n.night LIMIT 10`,
    [unitId, start, end],
  );
}

/** إعادة المحاولة عند deadlock (يحدث نادرًا مع حجوزات متزامنة على نفس الوحدة) */
export async function withDeadlockRetry(fn, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (error.code === 'ER_LOCK_DEADLOCK' && attempt < attempts) {
        await new Promise((resolve) => { setTimeout(resolve, 25 * attempt + Math.random() * 25); });
        continue;
      }
      throw error;
    }
  }
}
