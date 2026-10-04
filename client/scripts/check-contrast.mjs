/**
 * فحص تباين الألوان (WCAG) لأزواج النص/الخلفية والحالات في الثيمين، مباشرةً من tokens.css.
 * الاستعمال: `npm run check:contrast` — يخرج بكود 1 لو هبط زوج عن حدّه (للـ CI أيضًا).
 * الخلفيات الشفافة (rgba) تُركَّب فوق `--bg-raised` لأنها هكذا تظهر في الواجهة.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? new URL('../src/styles/tokens.css', import.meta.url);
const css = readFileSync(file, 'utf8');

const parseBlock = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const light = parseBlock(css.match(/:root\s*\{([\s\S]*?)\n\}/)[1]);
const dark = { ...light, ...parseBlock(css.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/)[1]) };

function resolve(vars, value, depth = 0) {
  if (depth > 10) throw new Error(`حلقة في ${value}`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (!ref) return value;
  if (!(ref[1] in vars)) throw new Error(`متغيّر غير معرَّف ${ref[1]}`);
  return resolve(vars, vars[ref[1]], depth + 1);
}

let base = [0, 0, 0];
function toRgb(color) {
  const rgba = color.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (rgba) {
    const alpha = Number(rgba[4]);
    return [1, 2, 3].map((i) => Math.round(Number(rgba[i]) * alpha + base[i - 1] * (1 - alpha)));
  }
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`لون غير مدعوم: ${color}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

const luminance = ([r, g, b]) => {
  const channel = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [نص، خلفية، الحدّ الأدنى] — 4.5 للنص العادي، 3 للنص الكبير والعناصر غير النصّية
const status = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'].map((s) => [`--st-${s}-fg`, `--st-${s}-bg`, 4.5]);
const PAIRS = [
  ['--text', '--bg', 4.5], ['--text', '--bg-raised', 4.5], ['--text-soft', '--bg', 4.5],
  ['--text-muted', '--bg', 4.5], ['--text-muted', '--bg-raised', 4.5], ['--text-muted', '--bg-sunken', 4.5],
  ['--text-faint', '--bg', 3],
  ['--on-brand', '--brand', 4.5], ['--on-danger', '--danger', 4.5],
  ['--link', '--bg', 4.5], ['--link', '--bg-raised', 4.5],
  ['--danger-text', '--bg', 4.5], ['--danger-text', '--bg-raised', 4.5],
  ['--success-text', '--bg-raised', 4.5], ['--warning-text', '--bg-raised', 4.5],
  ['--accent', '--bg', 3],
  ...status,
  ['--paper-200', '--ink-900', 4.5], ['--brass-200', '--ink-900', 4.5], ['--brass-300', '--ink-900', 3],
  ['--brass-700', '--brass-200', 4.5],
];

let failures = 0;
for (const [name, vars] of [['فاتح', light], ['داكن', dark]]) {
  console.log(`\n== ${name} ==`);
  base = toRgb(resolve(vars, vars['--bg-raised']));
  for (const [fg, bg, min] of PAIRS) {
    const value = ratio(toRgb(resolve(vars, vars[fg])), toRgb(resolve(vars, vars[bg])));
    const ok = value >= min;
    if (!ok) failures += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${value.toFixed(2).padStart(5)}  (≥ ${min})  ${fg} على ${bg}`);
  }
}
console.log(failures ? `\n${failures} زوج دون الحدّ` : '\nكل الأزواج ضمن الحدّ');
process.exit(failures ? 1 : 0);
