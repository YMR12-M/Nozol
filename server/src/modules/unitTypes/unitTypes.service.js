import { query, queryOne, execute, isDuplicate } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { attachmentsService } from '../attachments/attachments.service.js';
import { publicFileUrl } from '../../middleware/upload.js';
import { UNIT_TYPE_FIELDS, capacityIssues } from './unitTypes.validation.js';

const COLUMNS = `t.id, t.property_id, t.code, t.name_ar, t.name_en, t.description_ar, t.description_en,
  t.kind, t.base_adults, t.free_children, t.max_adults, t.max_children, t.max_occupancy,
  t.bedrooms, t.beds, t.size_sqm, t.base_price_minor, t.extra_adult_minor, t.extra_child_minor,
  t.amenities, t.sort_order, t.is_active, t.created_at, t.updated_at`;

/** JSON يصل من mysql2 مفكوكًا غالبًا، لكن نضمن الشكل */
const asArray = (value) => (typeof value === 'string' ? JSON.parse(value) : (value ?? []));

const present = (row, photos = []) => ({
  ...row,
  amenities: asArray(row.amenities),
  is_active: Boolean(row.is_active),
  photos,
});

const duplicateCode = () => ApiError.conflict('الكود ده مستخدم لنوع تاني', {
  code: 'CODE_TAKEN',
  details: { code: 'مستخدم بالفعل' },
});

export const unitTypesService = {
  async list(propertyId, { active } = {}) {
    const where = ['t.property_id = ?', 't.deleted_at IS NULL'];
    const params = [propertyId];
    if (active !== undefined) { where.push('t.is_active = ?'); params.push(active === 'true'); }

    const rows = await query(
      `SELECT ${COLUMNS},
              (SELECT COUNT(*) FROM units u WHERE u.unit_type_id = t.id AND u.deleted_at IS NULL AND u.status <> 'archived') AS units_count
         FROM unit_types t WHERE ${where.join(' AND ')}
        ORDER BY t.sort_order, t.id`,
      params,
    );
    const photos = await query(
      `SELECT * FROM attachments WHERE property_id = ? AND entity = 'unit_type' ORDER BY sort_order, id`,
      [propertyId],
    );
    const byType = new Map();
    for (const photo of photos) {
      if (!byType.has(photo.entity_id)) byType.set(photo.entity_id, []);
      byType.get(photo.entity_id).push(photo);
    }
    return rows.map((row) => ({
      ...present(row, (byType.get(row.id) ?? []).map((photo) => ({ id: photo.id, url: publicFileUrl(photo.file_path) }))),
      units_count: row.units_count,
    }));
  },

  async find(propertyId, id) {
    const row = await queryOne(
      `SELECT ${COLUMNS} FROM unit_types t WHERE t.id = ? AND t.property_id = ? AND t.deleted_at IS NULL`,
      [id, propertyId],
    );
    if (!row) throw ApiError.notFound('نوع الوحدة غير موجود');
    return row;
  },

  async get(propertyId, id) {
    const row = await this.find(propertyId, id);
    return present(row, await attachmentsService.list(propertyId, 'unit_type', id));
  },

  async create(propertyId, input) {
    const merged = {
      kind: 'room', base_adults: 2, free_children: 0, max_adults: 2, max_children: 0, max_occupancy: 2,
      bedrooms: 1, extra_adult_minor: 0, extra_child_minor: 0, amenities: [], sort_order: 0, is_active: true,
      ...input,
    };
    const issues = capacityIssues(merged);
    if (Object.keys(issues).length > 0) {
      throw ApiError.unprocessable('تحقّق من السعة', { code: 'VALIDATION_ERROR', details: issues });
    }

    const columns = UNIT_TYPE_FIELDS.filter((field) => merged[field] !== undefined);
    const values = columns.map((field) => (field === 'amenities' ? JSON.stringify(merged[field]) : merged[field]));
    try {
      const result = await execute(
        `INSERT INTO unit_types (property_id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`,
        [propertyId, ...values],
      );
      return this.get(propertyId, result.insertId);
    } catch (error) {
      if (isDuplicate(error, 'uq_unit_types_code')) throw duplicateCode();
      throw error;
    }
  },

  async update(propertyId, id, input) {
    const current = await this.find(propertyId, id);
    const merged = { ...current, ...input };
    const issues = capacityIssues(merged);
    if (Object.keys(issues).length > 0) {
      throw ApiError.unprocessable('تحقّق من السعة', { code: 'VALIDATION_ERROR', details: issues });
    }

    const columns = UNIT_TYPE_FIELDS.filter((field) => input[field] !== undefined);
    if (columns.length > 0) {
      const values = columns.map((field) => (field === 'amenities' ? JSON.stringify(input[field]) : input[field]));
      try {
        await execute(
          `UPDATE unit_types SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ? AND property_id = ?`,
          [...values, id, propertyId],
        );
      } catch (error) {
        if (isDuplicate(error, 'uq_unit_types_code')) throw duplicateCode();
        throw error;
      }
    }
    return { before: present(current), after: await this.get(propertyId, id) };
  },

  /** حذف ناعم، ويُمنع لو فيه وحدات (أو لقطات تسعير) مرتبطة بالنوع */
  async remove(propertyId, id) {
    const current = await this.find(propertyId, id);
    const units = await queryOne(
      "SELECT COUNT(*) AS n FROM units WHERE unit_type_id = ? AND deleted_at IS NULL AND status <> 'archived'",
      [id],
    );
    if (units.n > 0) {
      throw ApiError.conflict(`فيه ${units.n} وحدة تابعة للنوع ده — انقلها أو احذفها الأول`, { code: 'HAS_UNITS' });
    }
    await execute('UPDATE unit_types SET deleted_at = NOW(), is_active = 0 WHERE id = ?', [id]);
    await execute('UPDATE price_rules SET is_active = 0 WHERE unit_type_id = ?', [id]);
    return present(current);
  },
};
