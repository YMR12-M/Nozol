import crypto from 'node:crypto';
import { queryOne, execute, isDuplicate } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { todayIn } from '../../utils/dates.js';
import { PROPERTY_COLUMNS } from '../../middleware/propertyScope.js';
import { PROPERTY_FIELDS } from './properties.validation.js';
import { listAccessibleProperties } from './access.js';

/** مسارات محجوزة في الواجهة لا يجوز أن تكون slug لمنشأة */
const RESERVED_SLUGS = new Set(['api', 'admin', 'book', 'login', 'public', 'static', 'assets', 'app', 'www', 'health']);

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

async function uniqueSlug(preferred) {
  const root = slugify(preferred);
  const base = root.length >= 3 && !RESERVED_SLUGS.has(root) ? root : `property-${crypto.randomBytes(3).toString('hex')}`;
  let slug = base;
  for (let attempt = 2; await queryOne('SELECT id FROM properties WHERE slug = ?', [slug]); attempt += 1) {
    slug = `${base}-${attempt}`;
  }
  return slug;
}

const fetchProperty = (id) =>
  queryOne(`SELECT ${PROPERTY_COLUMNS} FROM properties p WHERE p.id = ?`, [id]);

/** يفصل الحقول المعروفة (قائمة بيضاء) ويحوّلها إلى أعمدة وقيم */
function pickFields(input) {
  const columns = [];
  const values = [];
  for (const field of PROPERTY_FIELDS) {
    if (input[field] !== undefined) {
      columns.push(field);
      values.push(input[field]);
    }
  }
  return { columns, values };
}

export const propertiesService = {
  list: (user) => listAccessibleProperties(user),

  async create(user, input) {
    let slug;
    if (input.slug) {
      if (RESERVED_SLUGS.has(input.slug)) {
        throw ApiError.badRequest('الاسم المختصر ده محجوز', { code: 'SLUG_RESERVED', details: { slug: 'محجوز' } });
      }
      slug = input.slug;
    } else {
      slug = await uniqueSlug(input.name_en || input.name_ar);
    }

    const { columns, values } = pickFields({ ...input, slug });
    try {
      const result = await execute(
        `INSERT INTO properties (uuid, organization_id, ${columns.join(', ')})
         VALUES (?, ?, ${columns.map(() => '?').join(', ')})`,
        [crypto.randomUUID(), user.organization_id, ...values],
      );
      return fetchProperty(result.insertId);
    } catch (error) {
      if (isDuplicate(error, 'uq_properties_slug')) {
        throw ApiError.conflict('الاسم المختصر ده مستخدم', { code: 'SLUG_TAKEN', details: { slug: 'مستخدم بالفعل' } });
      }
      throw error;
    }
  },

  async update(property, input) {
    if (input.slug !== undefined && RESERVED_SLUGS.has(input.slug)) {
      throw ApiError.badRequest('الاسم المختصر ده محجوز', { code: 'SLUG_RESERVED', details: { slug: 'محجوز' } });
    }

    if (input.public_booking_enabled === true && !property.public_booking_enabled) {
      const ready = await queryOne(
        `SELECT COUNT(*) AS n FROM units u
           JOIN unit_types t ON t.id = u.unit_type_id
          WHERE u.property_id = ? AND u.status = 'active' AND u.deleted_at IS NULL
            AND t.is_active = 1 AND t.deleted_at IS NULL`,
        [property.id],
      );
      if (ready.n === 0) {
        throw ApiError.badRequest('ضيف نوع وحدة ووحدة واحدة على الأقل قبل تفعيل الحجز الإلكتروني', {
          code: 'NOT_READY_FOR_BOOKING',
          details: { public_booking_enabled: 'لا توجد وحدات' },
        });
      }
    }

    const { columns, values } = pickFields(input);
    if (columns.length > 0) {
      try {
        await execute(
          `UPDATE properties SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`,
          [...values, property.id],
        );
      } catch (error) {
        if (isDuplicate(error, 'uq_properties_slug')) {
          throw ApiError.conflict('الاسم المختصر ده مستخدم', { code: 'SLUG_TAKEN', details: { slug: 'مستخدم بالفعل' } });
        }
        throw error;
      }
    }
    return fetchProperty(property.id);
  },

  /** الأرشفة ممنوعة لو فيه حجوزات قادمة أو نزلاء داخل المنشأة */
  async archive(property) {
    const today = todayIn(property.timezone);
    const active = await queryOne(
      `SELECT COUNT(*) AS n FROM reservations
        WHERE property_id = ? AND status IN ('pending','confirmed','checked_in') AND check_out >= ?`,
      [property.id, today],
    );
    if (active.n > 0) {
      throw ApiError.conflict(`فيه ${active.n} حجز نشط أو قادم — ألغِه أو انقله قبل الأرشفة`, { code: 'HAS_ACTIVE_RESERVATIONS' });
    }
    await execute("UPDATE properties SET status = 'archived', public_booking_enabled = 0 WHERE id = ?", [property.id]);
  },

  /** أرقام سريعة تظهر في رأس الصفحة وشاشة البداية */
  async summary(property) {
    const counts = await queryOne(
      `SELECT
         (SELECT COUNT(*) FROM unit_types WHERE property_id = ? AND deleted_at IS NULL) AS unit_types,
         (SELECT COUNT(*) FROM units WHERE property_id = ? AND deleted_at IS NULL AND status <> 'archived') AS units,
         (SELECT COUNT(*) FROM rate_plans WHERE property_id = ? AND is_active = 1) AS rate_plans`,
      [property.id, property.id, property.id],
    );
    return counts;
  },
};
