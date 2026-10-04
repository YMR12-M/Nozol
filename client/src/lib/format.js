/**
 * تنسيق الأرقام والفلوس والتواريخ.
 *
 * الأرقام لاتينية (0-9) حتى في العربية: هكذا يقرأها الموظف في كل أنظمة
 * الفنادق والفواتير، ولا تلتبس بين أنظمة الأرقام. المبالغ كلها تصل بالقروش.
 * تواريخ الليالي نصوص ISO (YYYY-MM-DD) تُعرَض بلا تحويل منطقة زمنية.
 */
const LOCALE = 'ar-EG-u-nu-latn';

const numberFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const moneyFormats = new Map();

export const formatNumber = (value) => (value === null || value === undefined ? '—' : numberFormat.format(value));

function moneyFormat(currency, compact) {
  const key = `${currency}:${compact}`;
  if (!moneyFormats.has(key)) {
    moneyFormats.set(key, new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: compact ? 0 : 2,
      maximumFractionDigits: compact ? 0 : 2,
    }));
  }
  return moneyFormats.get(key);
}

/** قروش ← «1,250.00 ج.م.» */
export function formatMoney(minor, currency = 'EGP', { compact = false } = {}) {
  if (minor === null || minor === undefined) return '—';
  // Intl يضع LRM قبل إشارة السالب فيقلب مكان «ج.م.» للمبالغ السالبة (الخصم) عن الموجبة داخل `.num`
  return moneyFormat(currency, compact).format(minor / 100).replace(/‎/g, '');
}

/**
 * قروش ← { amount: '14,146', unit: 'ج.م.' } لعرض الرقم كبيرًا والعملة صغيرة بجواره (بطاقات الأرقام).
 * العملة بحجم الرقم نفسه تُعرِّض البطاقة فتفيض على جارتها كلما اتّسعت أرقام الخطّ.
 */
export function moneyParts(minor, currency = 'EGP', { compact = false } = {}) {
  if (minor === null || minor === undefined) return { amount: '—', unit: '' };
  const parts = moneyFormat(currency, compact).formatToParts(minor / 100);
  const unit = parts.find((part) => part.type === 'currency')?.value ?? '';
  const amount = parts.filter((part) => part.type !== 'currency' && part.type !== 'literal').map((part) => part.value).join('').replace(/[‎؜]/g, '');
  return { amount, unit };
}

/** رقم عادي بخانتين من القروش — لحقول الإدخال */
export const minorToInput = (minor) => (minor === null || minor === undefined ? '' : (minor / 100).toFixed(2).replace(/\.00$/, ''));
/** ما كتبه المستخدم (جنيه) ← قروش صحيحة، أو null لو غير صالح */
export function inputToMinor(text) {
  if (text === '' || text === null || text === undefined) return null;
  const normalized = String(text).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.').trim();
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : null;
}

const dateFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayMonthFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekdayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', timeZone: 'UTC' });
const weekdayShortFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: 'UTC' });
const monthYearFormat = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });

/**
 * نصّ فيه كلمة عربية وأرقام («4 أكتوبر 2026» · «2:00 م») يُعزَل كاتجاه RTL مستقل (RLI … PDI).
 * `.num` يفرض LTR كي لا تنقلب الأرقام والمبالغ والهواتف، لكنه لو لفّ كلمة الشهر شوّش الترتيب
 * فيظهر «4 2026 أكتوبر». العزل يُبقي التاريخ والوقت بترتيبهما الطبيعي أينما وُضعا.
 */
const rtl = (text) => `⁧${text}⁩`;

const parse = (iso) => new Date(`${iso}T00:00:00Z`);
export const formatDate = (iso) => (iso ? rtl(dateFormat.format(parse(iso))) : '—');
export const formatDayMonth = (iso) => (iso ? rtl(dayMonthFormat.format(parse(iso))) : '—');
export const formatWeekday = (iso) => weekdayFormat.format(parse(iso));
export const formatWeekdayShort = (iso) => weekdayShortFormat.format(parse(iso));
export const formatMonthYear = (iso) => rtl(monthYearFormat.format(parse(iso)));
/** لحظة (timestamp) ← «4 أكتوبر 3:25 م» بتوقيت الجهاز */
export const formatDateTime = (value) => (value ? rtl(dateTimeFormat.format(new Date(value))) : '—');
export const formatTime = (value) => (value ? rtl(timeFormat.format(new Date(value))) : '—');
/** "14:00:00" ← "2:00 م" */
export function formatClock(time) {
  if (!time) return '—';
  const [h, m] = time.split(':').map(Number);
  return rtl(timeFormat.format(new Date(2000, 0, 1, h, m)));
}

/* ── حساب تواريخ ISO بلا مناطق زمنية ── */
export const addDays = (iso, days) => new Date(parse(iso).getTime() + days * 86_400_000).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
export const eachDay = (from, to) => {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
};
export const dayOfWeek = (iso) => parse(iso).getUTCDay(); // 0 = الأحد
export const isWeekend = (iso) => [5, 6].includes(dayOfWeek(iso)); // الجمعة والسبت
export const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`;
export function endOfMonth(iso) {
  const [year, month] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
/** «اليوم» بتوقيت المنشأة */
export function todayIn(timeZone = 'Africa/Cairo') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** ليلة · ليلتان · 3 ليالٍ · 11 ليلة */
export function nightsLabel(n) {
  if (n === 1) return 'ليلة';
  if (n === 2) return 'ليلتان';
  if (n >= 3 && n <= 10) return `${n} ليالٍ`;
  return `${n} ليلة`;
}
export function peopleLabel(adults, children = 0) {
  const parts = [`${adults} ${adults === 1 ? 'بالغ' : 'بالغين'}`];
  if (children > 0) parts.push(`${children} ${children === 1 ? 'طفل' : 'أطفال'}`);
  return parts.join(' + ');
}

export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('') || '؟';

/** هاتف دولي ← عرض مقروء: +201012345678 → 0101 234 5678 */
export function formatPhone(phone) {
  if (!phone) return '—';
  const egypt = /^\+20(1[0125]\d{8})$/.exec(phone);
  if (egypt) {
    const local = `0${egypt[1]}`;
    return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }
  return phone;
}

export const percent = (value) => `${formatNumber(value)}%`;

/** «واتساب» برقم دولي بلا + (علامات العزل الاتجاهي تُحذف: الرسالة نصّ عادي خارج واجهتنا) */
export const whatsappLink = (phone, text = '') => {
  const plain = text.replace(/[⁦-⁩]/g, '');
  return `https://wa.me/${String(phone ?? '').replace(/\D/g, '')}${plain ? `?text=${encodeURIComponent(plain)}` : ''}`;
};
