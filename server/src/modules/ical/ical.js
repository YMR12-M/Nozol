/**
 * قراءة وكتابة تقاويم iCalendar (RFC 5545) بالقدر الذي تحتاجه منصّات الحجز.
 *
 * ما نقرؤه من Airbnb وBooking.com: أحداث VEVENT كل منها فترة حجز بتاريخين
 * (DTSTART/DTEND) — غالبًا «يوم كامل» (VALUE=DATE) والنهاية غير شاملة، وهو نفس
 * منطق ليالينا (وصول شاملًا ومغادرة غير شاملة). لا نحتاج RRULE ولا المناطق
 * المعقّدة، لكن نتعامل مع الأوقات (UTC أو محلّية) بتحويلها لتاريخ المنشأة.
 */
import { addDays, diffDays, toIso } from '../../utils/dates.js';

const MAX_EVENT_NIGHTS = 400;

/** يفكّ الأسطر المطوية (سطر يبدأ بمسافة/تاب يكمل ما قبله) */
const unfold = (text) => text.replace(/\r?\n[ \t]/g, '');

/** يحوّل قيمة DTSTART/DTEND إلى تاريخ ISO في منطقة المنشأة */
function toDate(rawKey, value, timeZone) {
  const isDateOnly = /VALUE=DATE(?!-)/i.test(rawKey) || /^\d{8}$/.test(value);
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hh, mm, ss, zulu] = match;
  const local = `${year}-${month}-${day}`;
  if (isDateOnly || hh === undefined) return local;
  if (zulu === 'Z') {
    // لحظة UTC ← تاريخها في جدار المنشأة
    const instant = new Date(Date.UTC(+year, +month - 1, +day, +hh, +mm, +ss));
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
  }
  return local; // وقت محلّي/TZID: التاريخ كما هو
}

/**
 * @returns {Array<{uid:string,start:string,end:string,summary:string}>}
 *   end غير شاملة، والأحداث الملغاة والمعطوبة تُهمَل.
 */
export function parseEvents(text, timeZone = 'Africa/Cairo') {
  const events = [];
  let current = null;

  for (const line of unfold(String(text)).split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const rawKey = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const name = rawKey.split(';')[0].toUpperCase();

    if (name === 'UID') current.uid = value.trim();
    else if (name === 'SUMMARY') current.summary = value.trim().slice(0, 190);
    else if (name === 'STATUS') current.status = value.trim().toUpperCase();
    else if (name === 'DTSTART') current.start = toDate(rawKey, value, timeZone);
    else if (name === 'DTEND') current.end = toDate(rawKey, value, timeZone);
  }

  return events
    .filter((event) => event.uid && event.start && event.status !== 'CANCELLED')
    .map((event) => {
      let end = event.end;
      // بلا نهاية أو نهاية قبل/مع البداية (حدث ساعات في يوم واحد) ← ليلة واحدة على الأقل
      if (!end || end <= event.start) end = addDays(event.start, 1);
      return { uid: event.uid, start: event.start, end, summary: event.summary ?? 'Reserved' };
    })
    .filter((event) => diffDays(event.start, event.end) <= MAX_EVENT_NIGHTS);
}

const compact = (iso) => iso.replace(/-/g, '');
const escapeText = (value) => String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** يبني ملف .ics (CRLF كما يشترط المعيار). لا نضع أسماء نزلاء: المنصّات تحتاج الفترة فقط. */
export function buildCalendar({ name, host, events, now = new Date() }) {
  const stamp = `${toIso(now).replace(/-/g, '')}T${now.toISOString().slice(11, 19).replace(/:/g, '')}Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nozol//Hotel PMS//AR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}@${host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(event.start)}`,
      `DTEND;VALUE=DATE:${compact(event.end)}`,
      `SUMMARY:${escapeText(event.summary)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

