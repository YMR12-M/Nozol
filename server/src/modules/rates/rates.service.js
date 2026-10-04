/**
 * خطط الأسعار، قواعد التسعير، أكواد الخصم، والخدمات الإضافية.
 * أربعة موارد صغيرة متشابهة تتشارك مساعدات الإدراج والتحديث (قائمة بيضاء للحقول).
 */
import { query, queryOne, execute, transaction, isDuplicate } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  RATE_PLAN_FIELDS, PRICE_RULE_FIELDS, PROMO_FIELDS, SERVICE_FIELDS, ruleIssues, promoIssues,
} from './rates.validation.js';

const columnsOf = (fields, input) => fields.filter((field) => input[field] !== undefined);
const valuesOf = (columns, input) => columns.map((column) => input[column]);

const taken = (message, field = 'code') => ApiError.conflict(message, { code: 'CODE_TAKEN', details: { [field]: 'مستخدم بالفعل' } });

async function insertRow(tx, table, propertyId, fields, input) {
  const columns = columnsOf(fields, input);
  const result = await tx.execute(
    `INSERT INTO ${table} (property_id${columns.length ? ', ' : ''}${columns.join(', ')})
     VALUES (?${columns.map(() => ', ?').join('')})`,
    [propertyId, ...valuesOf(columns, input)],
  );
  return result.insertId;
}

async function updateRow(tx, table, propertyId, id, fields, input) {
  const columns = columnsOf(fields, input);
  if (columns.length === 0) return;
  await tx.execute(
    `UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ? AND property_id = ?`,
    [...valuesOf(columns, input), id, propertyId],
  );
}

const asBool = (row, ...keys) => {
  const copy = { ...row };
  for (const key of keys) if (key in copy) copy[key] = Boolean(copy[key]);
  return copy;
};

/* ═══════════════ خطط الأسعار ═══════════════ */

const planBool = (row) => asBool(row, 'is_refundable', 'is_default', 'is_public', 'is_active');

export const ratePlans = {
  async list(propertyId) {
    const rows = await query('SELECT * FROM rate_plans WHERE property_id = ? ORDER BY sort_order, id', [propertyId]);
    return rows.map(planBool);
  },

  async find(propertyId, id) {
    const row = await queryOne('SELECT * FROM rate_plans WHERE id = ? AND property_id = ?', [id, propertyId]);
    if (!row) throw ApiError.notFound('خطة السعر غير موجودة');
    return planBool(row);
  },

  async create(propertyId, input) {
    try {
      const id = await transaction(async (tx) => {
        if (input.is_default) await tx.execute('UPDATE rate_plans SET is_default = 0 WHERE property_id = ?', [propertyId]);
        return insertRow(tx, 'rate_plans', propertyId, RATE_PLAN_FIELDS, input);
      });
      return this.find(propertyId, id);
    } catch (error) {
      if (isDuplicate(error, 'uq_rate_plans_code')) throw taken('الكود ده مستخدم لخطة تانية');
      throw error;
    }
  },

  async update(propertyId, id, input) {
    const before = await this.find(propertyId, id);
    try {
      await transaction(async (tx) => {
        if (input.is_default) await tx.execute('UPDATE rate_plans SET is_default = 0 WHERE property_id = ? AND id <> ?', [propertyId, id]);
        await updateRow(tx, 'rate_plans', propertyId, id, RATE_PLAN_FIELDS, input);
      });
    } catch (error) {
      if (isDuplicate(error, 'uq_rate_plans_code')) throw taken('الكود ده مستخدم لخطة تانية');
      throw error;
    }
    return { before, after: await this.find(propertyId, id) };
  },

  /** لو استُخدمت في حجوزات تُعطَّل بدل الحذف (الحجوزات القديمة تشير إليها) */
  async remove(propertyId, id) {
    const before = await this.find(propertyId, id);
    const used = await queryOne(
      'SELECT (SELECT COUNT(*) FROM reservations WHERE rate_plan_id = ?) + (SELECT COUNT(*) FROM reservation_units WHERE rate_plan_id = ?) AS n',
      [id, id],
    );
    if (used.n > 0) {
      await execute('UPDATE rate_plans SET is_active = 0, is_default = 0 WHERE id = ?', [id]);
      return { before, deactivated: true };
    }
    await transaction(async (tx) => {
      await tx.execute('DELETE FROM price_rules WHERE rate_plan_id = ?', [id]);
      await tx.execute('DELETE FROM rate_plans WHERE id = ?', [id]);
    });
    return { before, deactivated: false };
  },
};

/* ═══════════════ قواعد التسعير ═══════════════ */

const ruleBool = (row) => asBool(row, 'closed_to_arrival', 'closed_to_departure', 'stop_sell', 'is_active');

async function assertRuleRefs(propertyId, { unit_type_ids: typeIds = [], unit_type_id: typeId, rate_plan_id: planId }) {
  const ids = [...new Set([...(typeId ? [typeId] : []), ...typeIds])];
  if (ids.length > 0) {
    const found = await query(
      `SELECT id FROM unit_types WHERE property_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
      [propertyId, ...ids],
    );
    if (found.length !== ids.length) {
      throw ApiError.badRequest('نوع وحدة غير موجود في المنشأة', { code: 'BAD_UNIT_TYPE', details: { unit_type_ids: 'غير موجود' } });
    }
  }
  if (planId) {
    const plan = await queryOne('SELECT id FROM rate_plans WHERE id = ? AND property_id = ?', [planId, propertyId]);
    if (!plan) throw ApiError.badRequest('خطة السعر غير موجودة', { code: 'BAD_RATE_PLAN', details: { rate_plan_id: 'غير موجودة' } });
  }
}

export const priceRules = {
  async list(propertyId, filters = {}) {
    const where = ['r.property_id = ?'];
    const params = [propertyId];
    if (filters.unit_type_id) { where.push('r.unit_type_id = ?'); params.push(filters.unit_type_id); }
    if (filters.rate_plan_id) { where.push('r.rate_plan_id = ?'); params.push(filters.rate_plan_id); }
    if (filters.from) { where.push('r.end_date >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('r.start_date <= ?'); params.push(filters.to); }
    if (filters.active) { where.push('r.is_active = ?'); params.push(filters.active === 'true'); }
    const rows = await query(
      `SELECT r.*, t.name_ar AS unit_type_name_ar, p.name_ar AS rate_plan_name_ar
         FROM price_rules r
         JOIN unit_types t ON t.id = r.unit_type_id
         LEFT JOIN rate_plans p ON p.id = r.rate_plan_id
        WHERE ${where.join(' AND ')} ORDER BY r.start_date, r.priority DESC, r.id`,
      params,
    );
    return rows.map(ruleBool);
  },

  async find(propertyId, id) {
    const row = await queryOne('SELECT * FROM price_rules WHERE id = ? AND property_id = ?', [id, propertyId]);
    if (!row) throw ApiError.notFound('القاعدة غير موجودة');
    return ruleBool(row);
  },

  /** قاعدة واحدة تُنسخ لعدّة أنواع وحدات بمعاملة واحدة */
  async create(propertyId, input) {
    const { unit_type_ids: typeIds, ...rest } = input;
    const complete = { kind: 'set_price', dow_mask: 127, priority: 0, is_active: true, ...rest };
    const issues = ruleIssues(complete);
    if (Object.keys(issues).length > 0) throw ApiError.unprocessable('تحقّق من القاعدة', { code: 'VALIDATION_ERROR', details: issues });
    await assertRuleRefs(propertyId, { unit_type_ids: typeIds, rate_plan_id: complete.rate_plan_id });

    const ids = await transaction(async (tx) => {
      const created = [];
      for (const unitTypeId of new Set(typeIds)) {
        created.push(await insertRow(tx, 'price_rules', propertyId, PRICE_RULE_FIELDS, { ...complete, unit_type_id: unitTypeId }));
      }
      return created;
    });
    return Promise.all(ids.map((id) => this.find(propertyId, id)));
  },

  async update(propertyId, id, input) {
    const before = await this.find(propertyId, id);
    const merged = { ...before, ...input };
    const issues = ruleIssues(merged);
    if (Object.keys(issues).length > 0) throw ApiError.unprocessable('تحقّق من القاعدة', { code: 'VALIDATION_ERROR', details: issues });
    if (input.rate_plan_id) await assertRuleRefs(propertyId, { rate_plan_id: input.rate_plan_id });

    await transaction((tx) => updateRow(tx, 'price_rules', propertyId, id, PRICE_RULE_FIELDS, input));
    return { before, after: await this.find(propertyId, id) };
  },

  async remove(propertyId, id) {
    const before = await this.find(propertyId, id);
    await execute('DELETE FROM price_rules WHERE id = ? AND property_id = ?', [id, propertyId]);
    return before;
  },
};

/* ═══════════════ أكواد الخصم ═══════════════ */

export const promoCodes = {
  async list(propertyId) {
    const rows = await query('SELECT * FROM promo_codes WHERE property_id = ? ORDER BY is_active DESC, id DESC', [propertyId]);
    return rows.map((row) => asBool(row, 'is_active'));
  },

  async find(propertyId, id) {
    const row = await queryOne('SELECT * FROM promo_codes WHERE id = ? AND property_id = ?', [id, propertyId]);
    if (!row) throw ApiError.notFound('كود الخصم غير موجود');
    return asBool(row, 'is_active');
  },

  async create(propertyId, input) {
    const complete = { min_nights: 1, is_active: true, ...input };
    const issues = promoIssues(complete);
    if (Object.keys(issues).length > 0) throw ApiError.unprocessable('تحقّق من الكود', { code: 'VALIDATION_ERROR', details: issues });
    try {
      const id = await transaction((tx) => insertRow(tx, 'promo_codes', propertyId, PROMO_FIELDS, complete));
      return this.find(propertyId, id);
    } catch (error) {
      if (isDuplicate(error, 'uq_promo_codes_code')) throw taken('الكود ده مستخدم');
      throw error;
    }
  },

  async update(propertyId, id, input) {
    const before = await this.find(propertyId, id);
    const issues = promoIssues({ ...before, ...input });
    if (Object.keys(issues).length > 0) throw ApiError.unprocessable('تحقّق من الكود', { code: 'VALIDATION_ERROR', details: issues });
    await transaction((tx) => updateRow(tx, 'promo_codes', propertyId, id, PROMO_FIELDS, input));
    return { before, after: await this.find(propertyId, id) };
  },

  async remove(propertyId, id) {
    const before = await this.find(propertyId, id);
    const used = await queryOne('SELECT COUNT(*) AS n FROM reservations WHERE promo_code_id = ?', [id]);
    if (used.n > 0) {
      await execute('UPDATE promo_codes SET is_active = 0 WHERE id = ?', [id]);
      return { before, deactivated: true };
    }
    await execute('DELETE FROM promo_codes WHERE id = ? AND property_id = ?', [id, propertyId]);
    return { before, deactivated: false };
  },
};

/* ═══════════════ الخدمات الإضافية ═══════════════ */

export const services = {
  async list(propertyId, { activeOnly = false } = {}) {
    const rows = await query(
      `SELECT * FROM services WHERE property_id = ? ${activeOnly ? 'AND is_active = 1' : ''} ORDER BY sort_order, id`,
      [propertyId],
    );
    return rows.map((row) => asBool(row, 'taxable', 'service_chargeable', 'is_active'));
  },

  async find(propertyId, id) {
    const row = await queryOne('SELECT * FROM services WHERE id = ? AND property_id = ?', [id, propertyId]);
    if (!row) throw ApiError.notFound('الخدمة غير موجودة');
    return asBool(row, 'taxable', 'service_chargeable', 'is_active');
  },

  async create(propertyId, input) {
    const complete = { price_minor: 0, taxable: true, service_chargeable: true, is_active: true, sort_order: 0, ...input };
    const id = await transaction((tx) => insertRow(tx, 'services', propertyId, SERVICE_FIELDS, complete));
    return this.find(propertyId, id);
  },

  async update(propertyId, id, input) {
    const before = await this.find(propertyId, id);
    await transaction((tx) => updateRow(tx, 'services', propertyId, id, SERVICE_FIELDS, input));
    return { before, after: await this.find(propertyId, id) };
  },

  async remove(propertyId, id) {
    const before = await this.find(propertyId, id);
    const used = await queryOne('SELECT COUNT(*) AS n FROM folio_items WHERE service_id = ?', [id]);
    if (used.n > 0) {
      await execute('UPDATE services SET is_active = 0 WHERE id = ?', [id]);
      return { before, deactivated: true };
    }
    await execute('DELETE FROM services WHERE id = ? AND property_id = ?', [id, propertyId]);
    return { before, deactivated: false };
  },
};
