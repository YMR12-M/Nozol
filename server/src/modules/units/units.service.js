/**
 * الوحدات (غرف / شاليهات) وحجبها.
 *
 * الحجب يمرّ عبر نفس قفل الليالي `unit_nights` المستخدم للحجوزات، فلا يمكن
 * حجب وحدة عليها حجز، ولا حجز وحدة محجوبة — بنفس الضمان على مستوى القاعدة.
 */
import { query, queryOne, execute, transaction, isDuplicate } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { eachNight, todayIn } from '../../utils/dates.js';

const COLUMNS = `u.id, u.property_id, u.unit_type_id, u.code, u.floor, u.notes, u.status,
  u.housekeeping_status, u.housekeeping_updated_at, u.sort_order, u.created_at, u.updated_at,
  t.name_ar AS unit_type_name_ar, t.name_en AS unit_type_name_en, t.code AS unit_type_code`;

const duplicateCode = (code) => ApiError.conflict(`الكود ${code} مستخدم لوحدة تانية`, {
  code: 'CODE_TAKEN',
  details: { code: 'مستخدم بالفعل' },
});

const MAX_BLOCK_NIGHTS = 366;

/** (?,?,?),(?,?,?) لإدراج عدّة صفوف بجملة واحدة */
const rowsPlaceholder = (rows, width) => Array.from({ length: rows }, () => `(${Array(width).fill('?').join(',')})`).join(',');

async function assertTypeInProperty(propertyId, unitTypeId) {
  const type = await queryOne(
    'SELECT id FROM unit_types WHERE id = ? AND property_id = ? AND deleted_at IS NULL',
    [unitTypeId, propertyId],
  );
  if (!type) throw ApiError.badRequest('نوع الوحدة غير موجود في المنشأة دي', { code: 'BAD_UNIT_TYPE', details: { unit_type_id: 'غير موجود' } });
}

/** حجوزات حالية أو قادمة على الوحدة (لا تشمل الملغاة) */
async function upcomingReservations(property, unitId) {
  const today = todayIn(property.timezone);
  return query(
    `SELECT r.id, r.code, r.status, ru.check_in, ru.check_out
       FROM reservation_units ru
       JOIN reservations r ON r.id = ru.reservation_id
      WHERE ru.unit_id = ? AND r.status IN ('pending','confirmed','checked_in') AND ru.check_out > ?
      ORDER BY ru.check_in`,
    [unitId, today],
  );
}

/** من يشغل هذه الليالي؟ (لشرح سبب رفض الحجب للمستخدم) */
async function describeConflicts(unitId, start, end) {
  return query(
    `SELECT n.night, r.code AS reservation_code, g.full_name AS guest_name, b.reason AS block_reason
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

export const unitsService = {
  async list(propertyId, filters = {}) {
    const where = ['u.property_id = ?', 'u.deleted_at IS NULL'];
    const params = [propertyId];
    if (filters.unit_type_id) { where.push('u.unit_type_id = ?'); params.push(filters.unit_type_id); }
    if (filters.status) { where.push('u.status = ?'); params.push(filters.status); }
    else where.push("u.status <> 'archived'");
    if (filters.housekeeping_status) { where.push('u.housekeeping_status = ?'); params.push(filters.housekeeping_status); }
    if (filters.q) { where.push('(u.code LIKE ? OR u.notes LIKE ?)'); params.push(`%${filters.q}%`, `%${filters.q}%`); }

    return query(
      `SELECT ${COLUMNS} FROM units u JOIN unit_types t ON t.id = u.unit_type_id
        WHERE ${where.join(' AND ')} ORDER BY u.sort_order, u.code`,
      params,
    );
  },

  async find(propertyId, id) {
    const row = await queryOne(
      `SELECT ${COLUMNS} FROM units u JOIN unit_types t ON t.id = u.unit_type_id
        WHERE u.id = ? AND u.property_id = ? AND u.deleted_at IS NULL`,
      [id, propertyId],
    );
    if (!row) throw ApiError.notFound('الوحدة غير موجودة');
    return row;
  },

  async create(propertyId, input) {
    await assertTypeInProperty(propertyId, input.unit_type_id);
    try {
      const result = await execute(
        `INSERT INTO units (property_id, unit_type_id, code, floor, notes, status, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [propertyId, input.unit_type_id, input.code, input.floor ?? null, input.notes ?? null,
          input.status ?? 'active', input.sort_order ?? 0],
      );
      return this.find(propertyId, result.insertId);
    } catch (error) {
      if (isDuplicate(error, 'uq_units_code')) throw duplicateCode(input.code);
      throw error;
    }
  },

  /** إضافة جماعية بمعاملة واحدة: يا الكل يا لا شيء */
  async bulkCreate(propertyId, input) {
    await assertTypeInProperty(propertyId, input.unit_type_id);

    let codes;
    if (input.codes) {
      codes = input.codes;
    } else {
      const { prefix, from, to, pad } = input.range;
      codes = [];
      for (let n = from; n <= to; n += 1) codes.push(`${prefix}${pad ? String(n).padStart(pad, '0') : n}`);
    }
    const unique = new Set(codes);
    if (unique.size !== codes.length) {
      throw ApiError.badRequest('فيه أكواد مكرّرة في القائمة', { code: 'DUPLICATE_CODES' });
    }

    const existing = await query(
      `SELECT code FROM units WHERE property_id = ? AND code IN (${codes.map(() => '?').join(',')})`,
      [propertyId, ...codes],
    );
    if (existing.length > 0) {
      throw ApiError.conflict(`أكواد مستخدمة بالفعل: ${existing.slice(0, 5).map((row) => row.code).join('، ')}`, {
        code: 'CODE_TAKEN',
        details: { codes: existing.map((row) => row.code) },
      });
    }

    await execute(
      `INSERT INTO units (property_id, unit_type_id, code, floor, sort_order)
       VALUES ${rowsPlaceholder(codes.length, 5)}`,
      codes.flatMap((code, index) => [propertyId, input.unit_type_id, code, input.floor ?? null, index]),
    );
    return this.list(propertyId, { unit_type_id: input.unit_type_id });
  },

  async update(property, id, input) {
    const current = await this.find(property.id, id);

    if (input.unit_type_id !== undefined && input.unit_type_id !== current.unit_type_id) {
      await assertTypeInProperty(property.id, input.unit_type_id);
      const upcoming = await upcomingReservations(property, id);
      if (upcoming.length > 0) {
        throw ApiError.conflict('مينفعش تغيّر نوع وحدة عليها حجوزات قادمة — انقل الحجوزات الأول', {
          code: 'HAS_UPCOMING_RESERVATIONS',
          details: { reservations: upcoming.map((r) => r.code) },
        });
      }
    }

    const fields = ['unit_type_id', 'code', 'floor', 'notes', 'status', 'sort_order'].filter((f) => input[f] !== undefined);
    if (fields.length > 0) {
      try {
        await execute(
          `UPDATE units SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ? AND property_id = ?`,
          [...fields.map((f) => input[f]), id, property.id],
        );
      } catch (error) {
        if (isDuplicate(error, 'uq_units_code')) throw duplicateCode(input.code);
        throw error;
      }
    }

    const after = await this.find(property.id, id);
    // إيقاف الوحدة عن الخدمة مع حجوزات قادمة مسموح، لكن نُنبّه الموظف ليعيد توزيعها
    const affected = input.status === 'out_of_order' ? await upcomingReservations(property, id) : [];
    return { before: current, after, affected_reservations: affected };
  },

  /** وحدة بلا أي تاريخ تُحذف فعلًا، ومَن لها تاريخ تُؤرشَف (السجلات القديمة تحتاجها) */
  async remove(property, id) {
    const current = await this.find(property.id, id);
    const upcoming = await upcomingReservations(property, id);
    if (upcoming.length > 0) {
      throw ApiError.conflict(`فيه ${upcoming.length} حجز حالي أو قادم على الوحدة دي`, {
        code: 'HAS_UPCOMING_RESERVATIONS',
        details: { reservations: upcoming.map((r) => r.code) },
      });
    }

    const history = await queryOne(
      `SELECT (SELECT COUNT(*) FROM reservation_units WHERE unit_id = ?)
            + (SELECT COUNT(*) FROM unit_blocks WHERE unit_id = ?)
            + (SELECT COUNT(*) FROM housekeeping_tasks WHERE unit_id = ?)
            + (SELECT COUNT(*) FROM maintenance_requests WHERE unit_id = ?)
            + (SELECT COUNT(*) FROM ical_feeds WHERE unit_id = ?) AS n`,
      [id, id, id, id, id],
    );

    if (history.n === 0) {
      await execute('DELETE FROM ical_export_tokens WHERE unit_id = ?', [id]);
      await execute('DELETE FROM units WHERE id = ?', [id]);
      return { before: current, archived: false };
    }
    await execute("UPDATE units SET status = 'archived' WHERE id = ?", [id]);
    return { before: current, archived: true };
  },

  async setHousekeepingStatus(propertyId, id, status) {
    await this.find(propertyId, id);
    await execute(
      'UPDATE units SET housekeeping_status = ?, housekeeping_updated_at = NOW() WHERE id = ? AND property_id = ?',
      [status, id, propertyId],
    );
    return this.find(propertyId, id);
  },

  /* ── الحجب ─────────────────────────────────────────────────── */

  async listBlocks(propertyId, unitId) {
    await this.find(propertyId, unitId);
    return query(
      `SELECT id, unit_id, start_date, end_date, reason, note, ical_feed_id, created_at
         FROM unit_blocks WHERE property_id = ? AND unit_id = ? AND end_date >= CURDATE()
        ORDER BY start_date`,
      [propertyId, unitId],
    );
  },

  async createBlock(propertyId, unitId, input, userId) {
    const unit = await this.find(propertyId, unitId);
    if (unit.status === 'archived') throw ApiError.badRequest('الوحدة مؤرشفة');

    const nights = eachNight(input.start_date, input.end_date);
    if (nights.length > MAX_BLOCK_NIGHTS) {
      throw ApiError.badRequest(`الحدّ الأقصى للحجب ${MAX_BLOCK_NIGHTS} ليلة`, { code: 'BLOCK_TOO_LONG' });
    }

    try {
      return await transaction(async (tx) => {
        const block = await tx.execute(
          `INSERT INTO unit_blocks (property_id, unit_id, start_date, end_date, reason, note, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [propertyId, unitId, input.start_date, input.end_date, input.reason, input.note ?? null, userId],
        );
        await tx.execute(
          `INSERT INTO unit_nights (unit_id, night, block_id) VALUES ${rowsPlaceholder(nights.length, 3)}`,
          nights.flatMap((night) => [unitId, night, block.insertId]),
        );
        return tx.queryOne('SELECT * FROM unit_blocks WHERE id = ?', [block.insertId]);
      });
    } catch (error) {
      if (isDuplicate(error)) {
        throw ApiError.conflict('الوحدة مشغولة في بعض الليالي دي — انقل الحجز أو اختار فترة تانية', {
          code: 'NIGHTS_OCCUPIED',
          details: { occupied: await describeConflicts(unitId, input.start_date, input.end_date) },
        });
      }
      throw error;
    }
  },

  async removeBlock(propertyId, blockId) {
    const block = await queryOne('SELECT * FROM unit_blocks WHERE id = ? AND property_id = ?', [blockId, propertyId]);
    if (!block) throw ApiError.notFound('الحجب غير موجود');
    if (block.ical_feed_id) {
      throw ApiError.badRequest('ده حجب جاي من تقويم خارجي (iCal) — يتحكّم فيه التقويم الأصلي', { code: 'ICAL_BLOCK' });
    }
    await execute('DELETE FROM unit_blocks WHERE id = ?', [blockId]); // الليالي تُحذف بالـ CASCADE
    return block;
  },
};
