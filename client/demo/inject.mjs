/* ============================================
   خطوة بعد البناء للنسخة التجريبية (عرض فقط):
   بتنسخ demo-api.js جوه dist وبتحط وسم السكريبت في أول <head> في index.html.
   مفيش أي تعديل في كود التطبيق نفسه - السكريبت ده بيعترض /api/* قبل ما
   التطبيق يطلب أي حاجة، وبيرد من بيانات وهمية في المتصفح.

   التشغيل:  node demo/inject.mjs [مجلد-dist]      (الافتراضي ../dist)
   ============================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(here, '..', 'dist'));
const indexPath = path.join(dist, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error(`❌ مفيش ${indexPath} - شغّل بناء الواجهة الأول.`);
  process.exit(1);
}

fs.copyFileSync(path.join(here, 'demo-api.js'), path.join(dist, 'demo-api.js'));

const html = fs.readFileSync(indexPath, 'utf8');
if (html.includes('/demo-api.js')) {
  console.log('✓ السكريبت متحط قبل كده.');
  process.exit(0);
}
const head = /<head[^>]*>/i;
if (!head.test(html)) {
  console.error('❌ مش لاقي وسم <head> في index.html.');
  process.exit(1);
}
// من غير defer ولا type=module عمدًا: لازم يشتغل قبل سكريبتات التطبيق (module = مؤجّل)
fs.writeFileSync(indexPath, html.replace(head, (tag) => `${tag}\n    <script src="/demo-api.js"></script>`));
console.log(`✅ النسخة التجريبية جاهزة في ${dist}`);
