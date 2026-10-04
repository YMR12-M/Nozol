/**
 * قوالب الرسائل. كل قالب دالة (payload) ← { subject, html, text }.
 * الرسائل عربية RTL بتصميم بسيط يعمل في كل عملاء البريد (جداول + CSS مضمَّن).
 */
import { env } from '../../config/env.js';

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout({ title, body, button, footer }) {
  const brand = esc(env.brand.name);
  const buttonHtml = button
    ? `<p style="margin:28px 0"><a href="${esc(button.url)}" style="background:#0e6b73;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;display:inline-block;font-weight:700">${esc(button.label)}</a></p>`
    : '';
  return `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;background:#f4f1ea;font-family:Tahoma,Arial,sans-serif;color:#1d2b2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0e6b73;color:#fff;padding:18px 28px;font-size:20px;font-weight:700">${brand}</td></tr>
<tr><td style="padding:28px;line-height:1.9;font-size:15px"><h2 style="margin:0 0 14px;font-size:18px">${esc(title)}</h2>${body}${buttonHtml}</td></tr>
<tr><td style="padding:16px 28px;background:#faf8f3;color:#6b7a7d;font-size:12px">${footer ?? `رسالة تلقائية من ${brand}.`}</td></tr>
</table></td></tr></table></body></html>`;
}

const money = (minor, currency = 'EGP') =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency }).format((minor ?? 0) / 100);

export const templates = {
  password_reset: ({ name, link }) => ({
    subject: `استعادة كلمة المرور — ${env.brand.name}`,
    html: layout({
      title: 'استعادة كلمة المرور',
      body: `<p>أهلًا ${esc(name)}،</p><p>وصلنا طلب لتغيير كلمة مرور حسابك. الرابط صالح لمدّة ساعة واحدة.</p><p>لو مش إنت اللي طلبت، تجاهل الرسالة وحسابك آمن.</p>`,
      button: { url: link, label: 'تغيير كلمة المرور' },
    }),
    text: `أهلًا ${name}\nلتغيير كلمة المرور افتح الرابط (صالح لساعة):\n${link}\nلو مش إنت اللي طلبت تجاهل الرسالة.`,
  }),

  // الدعوة برابط تعيين كلمة المرور (لا كلمة مرور في البريد) — الرابط صالح 3 أيام
  staff_invite: ({ name, email, link, role }) => ({
    subject: `دعوة للانضمام إلى ${env.brand.name}`,
    html: layout({
      title: 'تم إنشاء حسابك',
      body: `<p>أهلًا ${esc(name)}،</p><p>تم إنشاء حساب لك بصلاحية <b>${esc(role)}</b>.</p>
<p>البريد: <b dir="ltr">${esc(email)}</b></p>
<p>اضغط الزر لتحديد كلمة المرور وبدء الاستخدام. الرابط صالح لمدّة 3 أيام.</p>`,
      button: { url: link, label: 'تحديد كلمة المرور' },
    }),
    text: `أهلًا ${name}\nتم إنشاء حساب لك (${role}) بالبريد ${email}.\nحدّد كلمة المرور من الرابط (صالح 3 أيام):\n${link}`,
  }),

  booking_confirmation: ({ guestName, propertyName, code, checkIn, checkOut, nights, totalMinor, currency, lookupUrl, phone }) => ({
    subject: `تأكيد حجزك ${code} — ${propertyName}`,
    html: layout({
      title: 'تم تأكيد حجزك',
      body: `<p>أهلًا ${esc(guestName)}،</p>
<p>حجزك في <b>${esc(propertyName)}</b> مؤكَّد.</p>
<table role="presentation" cellpadding="6" style="background:#faf8f3;border-radius:8px;width:100%">
<tr><td>رقم الحجز</td><td><b dir="ltr">${esc(code)}</b></td></tr>
<tr><td>الوصول</td><td><b>${esc(checkIn)}</b></td></tr>
<tr><td>المغادرة</td><td><b>${esc(checkOut)}</b> (${esc(nights)} ليلة)</td></tr>
<tr><td>الإجمالي</td><td><b>${esc(money(totalMinor, currency))}</b></td></tr></table>
${phone ? `<p>للاستفسار: <b dir="ltr">${esc(phone)}</b></p>` : ''}`,
      button: lookupUrl ? { url: lookupUrl, label: 'عرض الحجز' } : null,
    }),
    text: `تم تأكيد حجزك ${code} في ${propertyName}\nالوصول: ${checkIn}\nالمغادرة: ${checkOut} (${nights} ليلة)\nالإجمالي: ${money(totalMinor, currency)}${lookupUrl ? `\n${lookupUrl}` : ''}`,
  }),

  booking_pending: ({ guestName, propertyName, code, holdHours, depositMinor, currency, lookupUrl }) => ({
    subject: `طلب حجز ${code} — ${propertyName}`,
    html: layout({
      title: 'استلمنا طلب الحجز',
      body: `<p>أهلًا ${esc(guestName)}،</p>
<p>استلمنا طلبك رقم <b dir="ltr">${esc(code)}</b> في <b>${esc(propertyName)}</b>، وهنأكّده معاك قريبًا.</p>
${depositMinor ? `<p>العربون المطلوب لتأكيد الحجز: <b>${esc(money(depositMinor, currency))}</b>.</p>` : ''}
<p>الطلب محجوز لك لمدّة ${esc(holdHours)} ساعة، وبعدها بيتحرّر تلقائيًا لو ماتأكّدش.</p>`,
      button: lookupUrl ? { url: lookupUrl, label: 'متابعة الحجز' } : null,
    }),
    text: `استلمنا طلب الحجز ${code} في ${propertyName}. محجوز لك ${holdHours} ساعة.${lookupUrl ? `\n${lookupUrl}` : ''}`,
  }),

  booking_cancelled: ({ guestName, propertyName, code }) => ({
    subject: `إلغاء الحجز ${code} — ${propertyName}`,
    html: layout({
      title: 'تم إلغاء الحجز',
      body: `<p>أهلًا ${esc(guestName)}،</p><p>تم إلغاء حجزك رقم <b dir="ltr">${esc(code)}</b> في <b>${esc(propertyName)}</b>.</p><p>لو ده مش المطلوب، كلّمنا وهنساعدك.</p>`,
    }),
    text: `تم إلغاء حجزك ${code} في ${propertyName}.`,
  }),

  new_booking_staff: ({ propertyName, code, guestName, checkIn, checkOut, source }) => ({
    subject: `حجز جديد ${code} — ${propertyName}`,
    html: layout({
      title: 'حجز جديد',
      body: `<p>وصل حجز جديد (${esc(source)}):</p><p><b dir="ltr">${esc(code)}</b> — ${esc(guestName)}<br>${esc(checkIn)} ← ${esc(checkOut)}</p>`,
    }),
    text: `حجز جديد ${code} — ${guestName}: ${checkIn} ← ${checkOut} (${source})`,
  }),
};

export function renderTemplate(name, payload) {
  const template = templates[name];
  if (!template) throw new Error(`قالب غير معروف: ${name}`);
  return template(payload);
}
