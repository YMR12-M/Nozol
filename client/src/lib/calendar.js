/**
 * تخطيط تقويم الإشغال (Tape chart) — دوال صرفة بلا React كي تُختبر وحدها.
 *
 * الشبكة CSS Grid بأعمدة (تسمية الوحدة + عمود لكل يوم) وكل عنصر فيها يحمل
 * رقم صفّه الصريح. لا نترك الصفوف لخوارزمية الوضع التلقائي: الأشرطة تتراكب
 * فوق خلايا اليوم، والوضع التلقائي كان سيدفع كل شريط إلى صفّ جديد.
 */
import { diffDays, eachDay } from './format.js';

/** صفّان للترويسة: الشهر ثم اليوم */
export const HEAD_ROWS = 2;

/**
 * موضع شريط داخل أعمدة الأيام. الحجز يبدأ منتصف يوم الوصول وينتهي منتصف يوم
 * المغادرة (غير مشمول)، كما في كل تقاويم الفنادق، فتظهر الليالي المتتالية
 * متلاصقة بلا فراغ ويبقى ظهر الصباح ظاهرًا لمن يغادر ومن يصل في اليوم نفسه.
 *
 * @param {string} from   أول يوم معروض
 * @param {number} days   عدد الأيام المعروضة
 * @param {string} start  أول ليلة
 * @param {string} end    يوم المغادرة (غير مشمول)
 */
export function barPlacement(from, days, start, end) {
  const startIndex = diffDays(from, start);
  const endIndex = diffDays(from, end);
  const clipStart = startIndex < 0;
  const clipEnd = endIndex > days - 1;
  const first = Math.max(0, startIndex);
  const last = Math.min(days - 1, endIndex);
  return {
    // عمود 1 للتسمية، فأول يوم في العمود 2؛ ونهاية الشريط تُحسب غير شاملة (+1)
    column: `${first + 2} / ${last + 3}`,
    clipStart,
    clipEnd,
    visible: endIndex > 0 && startIndex <= days - 1,
  };
}

/**
 * يجمّع الوحدات تحت أنواعها ويعطي كل صفّ رقمه، ثم يحسب إشغال كل ليلة.
 *
 * الإشغال يتبع تعريف التقارير: الحجوزات المؤكّدة والمقيمة والمغادِرة فقط، والمعلّقة
 * تُعرض منفصلة (held)، والوحدات المحجوبة تخرج من «المتاح» لا من «المشغول».
 */
export function buildTape({ units, stays, blocks, from, to, typeFilter = '' }) {
  const entries = new Map(units.map((unit) => [unit.id, { unit, items: [] }]));
  for (const item of [...stays, ...blocks]) entries.get(item.unit_id)?.items.push(item);

  const visible = [...entries.values()].filter(({ unit }) => !typeFilter || String(unit.unit_type_id) === String(typeFilter));

  const rows = [];
  let group = null;
  for (const entry of visible) {
    if (!group || group.typeId !== entry.unit.unit_type_id) {
      group = { kind: 'group', typeId: entry.unit.unit_type_id, name: entry.unit.unit_type_name_ar, count: 0, row: HEAD_ROWS + rows.length + 1 };
      rows.push(group);
    }
    group.count += 1;
    rows.push({ kind: 'unit', unit: entry.unit, items: entry.items, row: HEAD_ROWS + rows.length + 1 });
  }

  const days = eachDay(from, to);
  const sellable = visible.filter(({ unit }) => unit.status === 'active');
  const occupancy = days.map((day) => {
    let occupied = 0;
    let held = 0;
    let blocked = 0;
    for (const { items } of sellable) {
      const stay = items.find((item) => item.kind === 'stay' && item.start <= day && item.end > day);
      if (stay) { if (stay.reservation.status === 'pending') held += 1; else occupied += 1; }
      else if (items.some((item) => item.kind === 'block' && item.start <= day && item.end > day)) blocked += 1;
    }
    return { day, occupied, held, available: sellable.length - blocked };
  });

  const types = [...new Map(units.map((unit) => [unit.unit_type_id, unit.unit_type_name_ar])).entries()];
  return { rows, days, occupancy, types, footerRow: HEAD_ROWS + rows.length + 1 };
}

/** قوالب ارتفاعات الصفوف: الترويسة ثم المجموعات (أقصر) ثم الوحدات ثم التذييل */
export function tapeRowTemplate(rows) {
  return [
    '28px', '56px',
    ...rows.map((row) => (row.kind === 'group' ? '30px' : 'var(--row-h)')),
    '36px',
  ].join(' ');
}

/** أيام التقويم مجمّعة بالشهر لعمود عنوان الأشهر */
export function monthSpans(days) {
  const spans = [];
  days.forEach((day, index) => {
    const key = day.slice(0, 7);
    const last = spans[spans.length - 1];
    if (last?.key === key) last.span += 1;
    else spans.push({ key, day, span: 1, index });
  });
  return spans;
}
