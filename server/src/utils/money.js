/**
 * ═══════════════════════════════════════════════════════════════
 *  الفلوس
 *
 *  القاعدة: كل مبلغ في القاعدة والـ API **عدد صحيح بأصغر وحدة**
 *  (قروش: 1 جنيه = 100). لا floats ولا DECIMAL — فلا يظهر أبدًا
 *  فرق 0.01 جنيه بين فاتورة وإجمالي تقرير.
 *
 *  النِّسَب تُخزَّن بالـ basis points: 1400 = 14.00%.
 *  التقريب دائمًا «النصف لأعلى» وعلى مستوى المكوّن الكامل (لا على كل
 *  سطر)، ليكون الإجمالي قابلًا للمراجعة بالآلة الحاسبة.
 * ═══════════════════════════════════════════════════════════════
 */

/** تقريب النصف بعيدًا عن الصفر (متماثل للموجب والسالب) */
export const roundHalfUp = (value) => (value < 0 ? -Math.round(-value) : Math.round(value));

/** نسبة من مبلغ: applyBps(10000, 1400) → 1400 */
export const applyBps = (amountMinor, bps) => roundHalfUp((amountMinor * bps) / 10_000);

export const sum = (values) => values.reduce((total, value) => total + value, 0);

/** جنيه (رقم أو نصّ) → قروش */
export const toMinor = (major) => roundHalfUp(Number(major) * 100);

export const fromMinor = (minor) => minor / 100;

/** تنسيق للعرض في الرسائل — الواجهات تنسّق بنفسها */
export function formatMinor(minor, currency = 'EGP', locale = 'ar-EG') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
}
