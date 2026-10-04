/**
 * المرفقات: صور الوحدات (علنية) وصور الهويّات والإيصالات والأعطال (خاصة).
 *
 * كل مرفق يتبع كيانًا (entity + entity_id) داخل منشأة. المرفقات الخاصة لا
 * تُقدَّم إلا عبر مسار مصادَق عليه يتحقّق من صلاحية قراءة الكيان نفسه:
 * من لا يحقّ له رؤية بيانات النزيل لا يرى صورة هويّته.
 */
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { query, queryOne, execute } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import { persistUpload, publicFileUrl } from '../../middleware/upload.js';

/** صلاحية القراءة المطلوبة لكل نوع كيان */
export const READ_PERMISSION = {
  unit_type: 'units.read',
  guest: 'guests.read',
  reservation: 'reservations.read',
  maintenance: 'maintenance.read',
  housekeeping: 'housekeeping.read',
  expense: 'expenses.read',
};

const MAX_PER_ENTITY = 12;

const present = (row) => ({
  id: row.id,
  entity: row.entity,
  entity_id: row.entity_id,
  visibility: row.visibility,
  mime: row.mime,
  size_bytes: row.size_bytes,
  original_name: row.original_name,
  sort_order: row.sort_order,
  created_at: row.created_at,
  // العلنية لها رابط مباشر؛ الخاصة تُطلب عبر مسار الـ API
  url: row.visibility === 'public' ? publicFileUrl(row.file_path) : null,
});

export const attachmentsService = {
  async list(propertyId, entity, entityId) {
    const rows = await query(
      `SELECT * FROM attachments WHERE property_id = ? AND entity = ? AND entity_id = ?
        ORDER BY sort_order, id`,
      [propertyId, entity, entityId],
    );
    return rows.map(present);
  },

  /** يحفظ الملفات ويسجّلها. عند أي فشل نمسح ما كُتب على القرص. */
  async add({ propertyId, entity, entityId, files, visibility, allowPdf = false, userId }) {
    if (!files || files.length === 0) throw ApiError.badRequest('ما اتبعتش أي ملف', { code: 'NO_FILES' });

    const existing = await queryOne(
      'SELECT COUNT(*) AS n FROM attachments WHERE property_id = ? AND entity = ? AND entity_id = ?',
      [propertyId, entity, entityId],
    );
    if (existing.n + files.length > MAX_PER_ENTITY) {
      throw ApiError.badRequest(`الحدّ الأقصى ${MAX_PER_ENTITY} ملف لكل عنصر`, { code: 'TOO_MANY_FILES' });
    }

    const saved = [];
    try {
      for (const file of files) {
        saved.push(await persistUpload(file, { visibility, propertyId, allowPdf }));
      }
      const created = [];
      for (const [index, info] of saved.entries()) {
        const result = await execute(
          `INSERT INTO attachments
             (property_id, entity, entity_id, visibility, file_path, mime, size_bytes, original_name, sort_order, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [propertyId, entity, entityId, visibility, info.path, info.mime, info.size, info.originalName,
            existing.n + index, userId],
        );
        created.push(await queryOne('SELECT * FROM attachments WHERE id = ?', [result.insertId]));
      }
      return created.map(present);
    } catch (error) {
      await Promise.all(saved.map((info) => unlink(join(env.uploads.dir, info.path)).catch(() => {})));
      throw error;
    }
  },

  async find(propertyId, attachmentId) {
    const row = await queryOne('SELECT * FROM attachments WHERE id = ? AND property_id = ?', [attachmentId, propertyId]);
    if (!row) throw ApiError.notFound('الملف غير موجود');
    return row;
  },

  async remove(propertyId, attachmentId, expectedEntity) {
    const row = await this.find(propertyId, attachmentId);
    if (expectedEntity && row.entity !== expectedEntity) throw ApiError.notFound('الملف غير موجود');
    await execute('DELETE FROM attachments WHERE id = ?', [row.id]);
    // لو فشل مسح الملف الفعلي لا نفشل الطلب: السجل اختفى، والملف اليتيم يُنظَّف يدويًا
    await unlink(join(env.uploads.dir, row.file_path)).catch((error) => {
      logger.warn(`تعذّر مسح الملف ${row.file_path}: ${error.message}`);
    });
    return row;
  },

  absolutePath: (row) => join(env.uploads.dir, row.file_path),
};
