/**
 * تصدير CSV يفتحه Excel بالعربية صحيحًا: UTF-8 مع BOM، وفاصل «،» الإنجليزي.
 *
 * حماية من «حقن الصيغ» (CSV injection): خلية تبدأ بـ = أو + أو - أو @ يعدّها Excel
 * معادلة وقد تنفّذ أوامر. اسم نزيل مثل «=HYPERLINK(...)» يدخله أي زائر من صفحة
 * الحجز العام! لذا نسبق هذه الخلايا بعلامة اقتباس فيعرضها نصًّا عاديًّا.
 */
const RISKY = /^[=+\-@\t\r]/;

function cell(value) {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (RISKY.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** columns: [{ header, value: (row) => any }] */
export function toCsv(rows, columns) {
  const lines = [columns.map((column) => cell(column.header)).join(',')];
  for (const row of rows) lines.push(columns.map((column) => cell(column.value(row))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** قروش ← جنيه بخانتين (للتصدير فقط؛ الحسابات كلها بالقروش) */
export const money = (minor) => (minor === null || minor === undefined ? '' : (minor / 100).toFixed(2));
