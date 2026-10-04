/**
 * النزلاء. بيانات حسّاسة (هويّات، هواتف): كل القراءة بصلاحية guests.read،
 * وصور الهويّات مرفقات خاصة لا تُقدَّم إلا بعد التحقّق.
 */
import { query, queryOne, execute, safeInt } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { pageMeta } from '../../utils/response.js';
import { GUEST_FIELDS } from './guests.validation.js';

const present = (row) => (row ? {
  ...row,
  is_vip: Boolean(row.is_vip),
  is_blacklisted: Boolean(row.is_blacklisted),
} : row);

export const guestsService = {
  async list(propertyId, { page, page_size: pageSize, q, vip, blacklisted }) {
    const where = ['g.property_id = ?', 'g.deleted_at IS NULL'];
    const params = [propertyId];

    if (q) {
      const digits = q.replace(/\D/g, '');
      const clauses = ['g.full_name LIKE ?', 'g.email LIKE ?', 'g.id_number LIKE ?'];
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      if (digits.length >= 4) { clauses.push('g.phone LIKE ?'); params.push(`%${digits}%`); }
      where.push(`(${clauses.join(' OR ')})`);
    }
    if (vip) { where.push('g.is_vip = ?'); params.push(vip === 'true'); }
    if (blacklisted) { where.push('g.is_blacklisted = ?'); params.push(blacklisted === 'true'); }

    const total = (await queryOne(`SELECT COUNT(*) AS n FROM guests g WHERE ${where.join(' AND ')}`, params)).n;
    const rows = await query(
      `SELECT g.* FROM guests g WHERE ${where.join(' AND ')}
        ORDER BY g.updated_at DESC, g.id DESC
        LIMIT ${safeInt(pageSize, { min: 1, max: 100, fallback: 25 })} OFFSET ${safeInt((page - 1) * pageSize)}`,
      params,
    );
    return { rows: rows.map(present), meta: pageMeta(page, pageSize, total) };
  },

  async find(propertyId, id) {
    const row = await queryOne('SELECT * FROM guests WHERE id = ? AND property_id = ? AND deleted_at IS NULL', [id, propertyId]);
    if (!row) throw ApiError.notFound('النزيل غير موجود');
    return present(row);
  },

  async get(propertyId, id) {
    const guest = await this.find(propertyId, id);
    const reservations = await query(
      `SELECT id, code, status, check_in, check_out, nights, total_minor, paid_minor, source
         FROM reservations WHERE guest_id = ? ORDER BY check_in DESC LIMIT 20`,
      [id],
    );
    return { ...guest, reservations };
  },

  async create(propertyId, input) {
    const columns = GUEST_FIELDS.filter((field) => input[field] !== undefined);
    const result = await execute(
      `INSERT INTO guests (property_id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`,
      [propertyId, ...columns.map((column) => input[column])],
    );
    return this.find(propertyId, result.insertId);
  },

  async update(propertyId, id, input) {
    const before = await this.find(propertyId, id);
    const columns = GUEST_FIELDS.filter((field) => input[field] !== undefined);
    if (columns.length > 0) {
      await execute(
        `UPDATE guests SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ? AND property_id = ?`,
        [...columns.map((column) => input[column]), id, propertyId],
      );
    }
    return { before, after: await this.find(propertyId, id) };
  },

  /** الحذف الناعم مرفوض لمن له حجوزات: السجل المالي يحتاجه */
  async remove(propertyId, id) {
    const before = await this.find(propertyId, id);
    const used = await queryOne('SELECT COUNT(*) AS n FROM reservations WHERE guest_id = ?', [id]);
    if (used.n > 0) {
      throw ApiError.conflict('النزيل ده له حجوزات سابقة — مينفعش يتحذف', { code: 'HAS_RESERVATIONS' });
    }
    await execute('UPDATE guests SET deleted_at = NOW() WHERE id = ?', [id]);
    return before;
  },

  /**
   * يحدّد نزيل الحجز: بالمعرّف، أو يطابق بالهاتف/الهويّة ويكمّل الناقص، أو ينشئ جديدًا.
   * التطابق على الهاتف ذو معنى: الاستقبال يكتب رقم العائد فيظهر تاريخه ولا يتكرّر.
   * يعمل داخل معاملة الحجز (`tx`).
   */
  async resolveForReservation(tx, propertyId, guestInput) {
    if (guestInput.id) {
      const found = await tx.queryOne(
        'SELECT * FROM guests WHERE id = ? AND property_id = ? AND deleted_at IS NULL',
        [guestInput.id, propertyId],
      );
      if (!found) throw ApiError.badRequest('النزيل غير موجود', { code: 'BAD_GUEST', details: { guest: 'غير موجود' } });
      return present(found);
    }

    let existing = null;
    if (guestInput.phone) {
      existing = await tx.queryOne(
        'SELECT * FROM guests WHERE property_id = ? AND phone = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1',
        [propertyId, guestInput.phone],
      );
    }
    if (!existing && guestInput.id_number) {
      existing = await tx.queryOne(
        'SELECT * FROM guests WHERE property_id = ? AND id_number = ? AND deleted_at IS NULL LIMIT 1',
        [propertyId, guestInput.id_number],
      );
    }

    if (existing) {
      // نكمّل الحقول الفارغة فقط — لا نكتب فوق بيانات صحّحها الموظف يدويًّا
      const fill = GUEST_FIELDS.filter((field) => !['is_vip', 'is_blacklisted'].includes(field)
        && existing[field] === null && guestInput[field] != null);
      if (fill.length > 0) {
        await tx.execute(
          `UPDATE guests SET ${fill.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`,
          [...fill.map((field) => guestInput[field]), existing.id],
        );
      }
      return present(await tx.queryOne('SELECT * FROM guests WHERE id = ?', [existing.id]));
    }

    const columns = GUEST_FIELDS.filter((field) => guestInput[field] !== undefined);
    const result = await tx.execute(
      `INSERT INTO guests (property_id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`,
      [propertyId, ...columns.map((column) => guestInput[column])],
    );
    return present(await tx.queryOne('SELECT * FROM guests WHERE id = ?', [result.insertId]));
  },
};
