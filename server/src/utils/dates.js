/**
 * ═══════════════════════════════════════════════════════════════
 *  التواريخ بلا منطقة زمنية
 *
 *  ليالي الإقامة تواريخ تقويمية (`2026-07-14`) لا لحظات زمنية. لو
 *  تعاملنا معها كـ Date محلي فسيختلف الناتج حسب منطقة جهاز المستخدم
 *  أو السيرفر، وتظهر ليلة زائدة أو ناقصة عند تغيير التوقيت الصيفي.
 *
 *  الحل: نخزّنها ونمرّرها نصوصًا ISO ونحسب عليها بحساب UTC فقط.
 *  "اليوم" الوحيد الذي يعتمد على منطقة زمنية هو `todayIn(tz)`، وتُمرَّر
 *  إليه منطقة المنشأة صراحةً.
 * ═══════════════════════════════════════════════════════════════
 */
const MS_DAY = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export const parseIso = (iso) => new Date(`${iso}T00:00:00Z`);
export const toIso = (date) => date.toISOString().slice(0, 10);

/** تاريخ صالح فعلًا (يرفض 2026-02-31) */
export function isValidIso(value) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  const date = parseIso(value);
  return !Number.isNaN(date.getTime()) && toIso(date) === value;
}

export const addDays = (iso, days) => toIso(new Date(parseIso(iso).getTime() + days * MS_DAY));

/** عدد الأيام من a إلى b (موجب لو b بعد a) */
export const diffDays = (a, b) => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / MS_DAY);

/** الليالي من تاريخ الوصول (شاملًا) حتى المغادرة (غير شاملة) */
export function eachNight(checkIn, checkOut) {
  const nights = [];
  for (let day = checkIn; day < checkOut; day = addDays(day, 1)) nights.push(day);
  return nights;
}

/** كل الأيام في المدى [from, to] شاملةً الطرفين */
export function eachDay(from, to) {
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** 0 = الأحد … 6 = السبت */
export const dayOfWeek = (iso) => parseIso(iso).getUTCDay();

/** "اليوم" كما هو في منطقة زمنية محدّدة (صيغة YYYY-MM-DD) */
export function todayIn(timeZone = 'Africa/Cairo', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** فرق التوقيت (ميلي ثانية) بين منطقة زمنية و UTC عند لحظة معيّنة */
function zoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(+value.year, +value.month - 1, +value.day, +value.hour, +value.minute, +value.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * لحظة UTC المقابلة لتاريخ ووقت «على جدار» منطقة زمنية معيّنة.
 * مثال: ('2026-07-14', '14:00', 'Africa/Cairo') ← 11:00Z صيفًا و12:00Z شتاءً.
 * نصحّح مرتين لنصيب حدود التوقيت الصيفي.
 */
export function zonedToUtc(dateIso, time, timeZone) {
  const [year, month, day] = dateIso.split('-').map(Number);
  const [hours, minutes = 0, seconds = 0] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  let utc = wall - zoneOffsetMs(new Date(wall), timeZone);
  utc = wall - zoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

/** حدود يوم تقويمي في منطقة زمنية كلحظات UTC: [بداية، نهاية) */
export function dayBoundsUtc(dateIso, timeZone) {
  return { start: zonedToUtc(dateIso, '00:00:00', timeZone), end: zonedToUtc(addDays(dateIso, 1), '00:00:00', timeZone) };
}

export const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`;

export function endOfMonth(iso) {
  const [year, month] = iso.split('-').map(Number);
  return toIso(new Date(Date.UTC(year, month, 0)));
}

/** قناع أيام الأسبوع: بتّ لكل يوم (0=الأحد) — 127 يعني كل الأيام */
export const DOW_ALL = 0b1111111;
export const dowIncluded = (mask, iso) => (mask & (1 << dayOfWeek(iso))) !== 0;
