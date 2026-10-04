/**
 * إشعارات الموبايل/المتصفّح (Web Push مع VAPID).
 *
 * الاشتراك يُسجَّل من التطبيق (`/auth/push/subscribe`)، ونرسل لكل أجهزة
 * المستخدم. لو رفض المزوّد الاشتراك (404/410: المستخدم ألغى الإذن أو
 * مسح بيانات المتصفّح) نحذفه فلا نحاول عليه كل مرّة.
 */
import webpush from 'web-push';
import { env } from '../../config/env.js';
import { execute, query } from '../../config/db.js';
import { logger } from '../../utils/logger.js';

export const pushEnabled = () => Boolean(env.push.publicKey && env.push.privateKey);

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(env.push.subject, env.push.publicKey, env.push.privateKey);
  configured = true;
}

/** payload: { title, body, url?, tag? } */
export async function sendPushToUser(userId, payload) {
  if (!pushEnabled()) return { sent: 0, skipped: true };
  configure();

  const subscriptions = await query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
    [userId],
  );

  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 },
      );
      sent += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await execute('DELETE FROM push_subscriptions WHERE id = ?', [subscription.id]);
      } else {
        logger.warn(`فشل إرسال Push للمستخدم ${userId}: ${error.message}`);
      }
    }
  }
  return { sent };
}
