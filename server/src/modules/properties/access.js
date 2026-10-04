import { query } from '../../config/db.js';

const COLUMNS = 'p.id, p.slug, p.kind, p.name_ar, p.name_en, p.currency, p.timezone, p.public_booking_enabled';

/**
 * المنشآت التي يصل إليها المستخدم:
 *  المالك ← كل منشآت منظّمته · غيره ← ما أُسنِد له في user_properties.
 */
export function listAccessibleProperties(user) {
  if (user.role === 'owner') {
    return query(
      `SELECT ${COLUMNS} FROM properties p
        WHERE p.organization_id = ? AND p.status = 'active' ORDER BY p.id`,
      [user.organization_id],
    );
  }
  return query(
    `SELECT ${COLUMNS} FROM properties p
       JOIN user_properties up ON up.property_id = p.id
      WHERE up.user_id = ? AND p.organization_id = ? AND p.status = 'active'
      ORDER BY p.id`,
    [user.id, user.organization_id],
  );
}
