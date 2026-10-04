/**
 * إشعار موظفي منشأة بحدث (حجز جديد، عطل عاجل، تعارض iCal).
 *
 * المستلمون: المالك (يصل لكل المنشآت) + من أُسنِدت لهم المنشأة بالأدوار المطلوبة،
 * وكلهم نشطون. الإشعار يدخل الصندوق (outbox) فلا يُبطئ الطلب الأصلي ولا يضيع.
 */
import { query } from '../../config/db.js';
import { enqueuePush } from './outbox.js';

export async function notifyStaff(property, { roles = ['manager', 'front_desk'], payload, excludeUserId = 0 }, tx) {
  const recipients = await query(
    `SELECT DISTINCT u.id FROM users u
      WHERE u.organization_id = ? AND u.status = 'active' AND u.deleted_at IS NULL AND u.id <> ?
        AND (u.role = 'owner'
             OR (u.role IN (${roles.map(() => '?').join(',')})
                 AND EXISTS (SELECT 1 FROM user_properties up WHERE up.user_id = u.id AND up.property_id = ?)))`,
    [property.organization_id, excludeUserId, ...roles, property.id],
  );
  for (const recipient of recipients) {
    await enqueuePush({ propertyId: property.id, userId: recipient.id, payload }, tx);
  }
  return recipients.length;
}
