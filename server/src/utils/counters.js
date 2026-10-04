/**
 * عدّاد متسلسل ذرّي لكل منشأة (أكواد الحجز NZ-000123، أرقام الفواتير).
 *
 * `INSERT … ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)` يزيد
 * العدّاد ويحفظ قيمته الجديدة في اتصالنا نحن، فلا يحصل طلبان على نفس
 * الرقم حتى لو تزامنا. لهذا يلزم تمرير معاملة `tx`: الجملتان لازم تعملان
 * على اتصال واحد.
 */
export async function nextCounter(tx, propertyId, name) {
  await tx.execute(
    `INSERT INTO counters (property_id, name, value) VALUES (?, ?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)`,
    [propertyId, name],
  );
  const row = await tx.queryOne('SELECT LAST_INSERT_ID() AS n');
  return Number(row.n);
}

/** NZ + 123 ← NZ-000123 */
export const formatSequence = (prefix, number, width = 6) =>
  `${prefix}-${String(number).padStart(width, '0')}`;
