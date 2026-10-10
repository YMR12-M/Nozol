// إعداد Vite لبناء النسخة التجريبية (عرض فقط).
//
// App.jsx بيستورد صفحات لسه ما اتكتبتش، وVite بيرفض يبني لو أي استيراد ناقص.
// بدل ما نلمس المشروع، بناخد إعداده الأصلي ونضيف plugin بيحوّل أي صفحة
// ناقصة لمكوّن بسيط مكتوب فيه «قيد البناء». أول ما الصفحة الحقيقية تتكتب
// بتاخد مكانه لوحدها.
//
// التشغيل:  cd client && npx vite build --config vite.demo.config.mjs
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import base from './vite.config.js';

const PREFIX = '\0nozol-missing-page:';

const missingPages = {
  name: 'nozol-missing-pages',
  enforce: 'pre',
  resolveId(source, importer) {
    if (!importer || !/\/pages\/[^/]+\.jsx$/.test(source)) return null;
    const file = resolve(dirname(importer), source);
    if (existsSync(file)) return null;
    return PREFIX + file.split('/').pop().replace(/\.jsx$/, '');
  },
  load(id) {
    if (!id.startsWith(PREFIX)) return null;
    const name = id.slice(PREFIX.length);
    return `
      import { createElement } from 'react';
      export default function MissingPage() {
        return createElement('div', {
          style: { padding: '64px 24px', textAlign: 'center', color: 'inherit', font: 'inherit' },
        }, 'صفحة «${name}» قيد البناء — لسه ما اتكتبتش.');
      }`;
  },
};

export default { ...base, plugins: [missingPages, ...(base.plugins ?? [])] };
