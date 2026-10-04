/**
 * ═══════════════════════════════════════════════════════════════
 *  تهيئة أوّل تشغيل — لا بيانات تجريبية
 *
 *  هذا السكربت لا يخترع فنادق ولا غرف ولا حجوزات. يفعل شيئًا واحدًا:
 *  ينشئ **المنظّمة** وحساب **المالك الأول**. بعد الدخول تُنشئ منشأتك
 *  الحقيقية من معالج البداية في لوحة الإدارة (الاسم، الغرف، الأسعار).
 *
 *  آمن للتكرار: لا يمسح شيئًا. إن وُجد مالك أخبرك وخرج. وإضافة منظّمة
 *  جديدة لعميل آخر (وضع SaaS) تحتاج صراحةً `--new-org`.
 *
 *  التشغيل:   npm run db:bootstrap
 *  القيم من server/.env (ORG_NAME / ADMIN_*) أو وسائط:
 *    npm run db:bootstrap -- --org="فندق النيل" --name="اسمك" \
 *      --email=you@example.com --phone=01000000000 --password='كلمة-قوية-طويلة'
 * ═══════════════════════════════════════════════════════════════
 */
import crypto from 'node:crypto';
import { closePool, queryOne, transaction } from '../config/db.js';
import { hashPassword } from '../utils/security.js';
import { normalizePhone } from '../utils/phone.js';
import { logger } from '../utils/logger.js';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split('=');
      return [key.replace(/-/g, '_'), rest.length ? rest.join('=') : 'true'];
    }),
);

const pick = (key, envKey) => String(args[key] || process.env[envKey] || '').trim();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** كلمة مرور المالك تحمي كل شيء: حدّ أعلى من حدّ الموظفين */
function ownerPasswordIssues(password) {
  const issues = [];
  if (password.length < 12) issues.push('12 حرفًا على الأقل');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) issues.push('ثلاثة أنواع على الأقل من: حروف صغيرة، كبيرة، أرقام، رموز');
  if (/^(.)\1+$/.test(password)) issues.push('ليست حرفًا مكرّرًا');
  return issues;
}

async function bootstrap() {
  const allowNewOrg = args.new_org === 'true';
  const existingOwner = await queryOne("SELECT id, email FROM users WHERE role = 'owner' AND deleted_at IS NULL LIMIT 1");

  if (existingOwner && !allowNewOrg) {
    logger.info(`يوجد مالك بالفعل (${existingOwner.email}) — مفيش حاجة اتعمل.`);
    logger.info('لإضافة موظفين: لوحة الإدارة › الفريق. ولإنشاء منظّمة لعميل جديد: --new-org');
    return;
  }

  const orgName = pick('org', 'ORG_NAME');
  const fullName = pick('name', 'ADMIN_NAME');
  const email = pick('email', 'ADMIN_EMAIL').toLowerCase();
  const phone = normalizePhone(pick('phone', 'ADMIN_PHONE'));
  const password = pick('password', 'ADMIN_PASSWORD');

  const missing = [];
  if (!orgName) missing.push('ORG_NAME (أو --org=)  اسم الفندق أو الشركة');
  if (!fullName) missing.push('ADMIN_NAME (أو --name=)');
  if (!email) missing.push('ADMIN_EMAIL (أو --email=)');
  if (!password) missing.push('ADMIN_PASSWORD (أو --password=)');

  if (missing.length > 0) {
    logger.warn('اتوقّف — البيانات دي ناقصة:');
    missing.forEach((item) => console.log(`     ✗ ${item}`));
    console.log(`
  املأها في server/.env ثم أعد التشغيل، أو مرّرها مباشرة:

    npm run db:bootstrap -- \\
      --org="اسم الفندق" --name="اسمك" --email="you@example.com" \\
      --phone="01xxxxxxxxx" --password='كلمة-مرور-قوية-وطويلة'

  وبعد النجاح احذف ADMIN_PASSWORD من .env.
`);
    process.exitCode = 1;
    return;
  }

  if (!EMAIL_RE.test(email)) throw new Error(`بريد غير صالح: ${email}`);
  const issues = ownerPasswordIssues(password);
  if (issues.length > 0) throw new Error(`كلمة مرور المالك ضعيفة — لازم:\n     • ${issues.join('\n     • ')}`);

  const duplicate = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
  if (duplicate) throw new Error(`البريد ${email} مستخدم بالفعل`);

  const passwordHash = await hashPassword(password);

  const { organizationId, userId } = await transaction(async (tx) => {
    const org = await tx.execute(
      'INSERT INTO organizations (uuid, name) VALUES (?, ?)',
      [crypto.randomUUID(), orgName],
    );
    const user = await tx.execute(
      `INSERT INTO users (uuid, organization_id, full_name, email, phone, password_hash, role, password_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'owner', NOW())`,
      [crypto.randomUUID(), org.insertId, fullName, email, phone, passwordHash],
    );
    return { organizationId: org.insertId, userId: user.insertId };
  });

  logger.success(`اتنشأت المنظّمة «${orgName}» (#${organizationId}) وحساب المالك ${email} (#${userId})`);
  console.log(`
  الخطوة الجاية: شغّل السيرفر وافتح لوحة الإدارة وادخل بالبريد ده،
  وهيفتح لك معالج إنشاء المنشأة (الاسم · الغرف · الأسعار).
`);
}

try {
  await bootstrap();
} catch (error) {
  logger.error(error.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
