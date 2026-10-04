import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, diffDays, dayOfWeek, eachNight, isValidIso, todayIn, endOfMonth, dowIncluded,
} from '../src/utils/dates.js';
import { applyBps, roundHalfUp, toMinor } from '../src/utils/money.js';
import { normalizePhone, lastDigits } from '../src/utils/phone.js';
import { passwordIssues, ttlToMs, safeEqual } from '../src/utils/security.js';

test('التواريخ: حساب الأيام لا يتأثّر بالتوقيت الصيفي', () => {
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(addDays('2026-10-30', 1), '2026-10-31');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(diffDays('2026-03-01', '2026-04-01'), 31);
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('التواريخ: التحقّق يرفض المستحيل', () => {
  assert.equal(isValidIso('2026-02-29'), false);
  assert.equal(isValidIso('2028-02-29'), true);
  assert.equal(isValidIso('2026-13-01'), false);
  assert.equal(isValidIso('26-01-01'), false);
  assert.equal(isValidIso(20260101), false);
});

test('الليالي: من الوصول شاملًا حتى المغادرة غير شاملة', () => {
  assert.deepEqual(eachNight('2026-07-14', '2026-07-17'), ['2026-07-14', '2026-07-15', '2026-07-16']);
  assert.deepEqual(eachNight('2026-07-14', '2026-07-14'), []);
});

test('أيام الأسبوع: 0 = الأحد وقناع البتّات', () => {
  assert.equal(dayOfWeek('2026-10-04'), 0); // الأحد
  assert.equal(dayOfWeek('2026-10-09'), 5); // الجمعة
  const weekendMask = (1 << 5) | (1 << 6); // الجمعة والسبت
  assert.equal(dowIncluded(weekendMask, '2026-10-09'), true);
  assert.equal(dowIncluded(weekendMask, '2026-10-07'), false);
});

test('اليوم حسب منطقة المنشأة وليس منطقة السيرفر', () => {
  const instant = new Date('2026-07-14T22:30:00Z'); // 01:30 بعد منتصف الليل في القاهرة (UTC+3 صيفًا)
  assert.equal(todayIn('Africa/Cairo', instant), '2026-07-15');
  assert.equal(todayIn('UTC', instant), '2026-07-14');
});

test('نهاية الشهر', () => {
  assert.equal(endOfMonth('2026-02-10'), '2026-02-28');
  assert.equal(endOfMonth('2028-02-10'), '2028-02-29');
  assert.equal(endOfMonth('2026-12-01'), '2026-12-31');
});

test('الفلوس: التقريب والنِّسَب بالقروش', () => {
  assert.equal(applyBps(10_000, 1400), 1400); // 14% من 100 جنيه
  assert.equal(applyBps(333, 1400), 47); // 46.62 → 47
  assert.equal(roundHalfUp(2.5), 3);
  assert.equal(roundHalfUp(-2.5), -3);
  assert.equal(toMinor('12.34'), 1234);
  assert.equal(toMinor(0.1 + 0.2), 30);
});

test('الهاتف: توحيد الصيغ', () => {
  assert.equal(normalizePhone('01012345678'), '+201012345678');
  assert.equal(normalizePhone('+20 101 234 5678'), '+201012345678');
  assert.equal(normalizePhone('0020 101 234 5678'), '+201012345678');
  assert.equal(normalizePhone('201012345678'), '+201012345678');
  assert.equal(normalizePhone('+44 7700 900123'), '+447700900123');
  assert.equal(normalizePhone(''), null);
  assert.equal(lastDigits('+201012345678'), '5678');
});

test('كلمة المرور: السياسة', () => {
  assert.deepEqual(passwordIssues('Str0ng-Pass-123!'), []);
  assert.ok(passwordIssues('short1').length > 0);
  assert.ok(passwordIssues('aaaaaaaaaaaa').length > 0);
  assert.ok(passwordIssues('password').length > 0);
  assert.deepEqual(passwordIssues('a long passphrase with words only'), []);
});

test('أدوات الأمان: مدد وصيغ', () => {
  assert.equal(ttlToMs('15m'), 900_000);
  assert.equal(ttlToMs('30d'), 30 * 86_400_000);
  assert.throws(() => ttlToMs('soon'));
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});
