import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * إعداد Vite للوحة الإدارة.
 *
 * المنافذ: 5180 للتطوير و4180 للمعاينة (تطبيق الموبايل 5181 — بجواره بلا تصادم).
 * `strictPort` مقصود: لو كان المنفذ مشغولًا فالأفضل أن يفشل بصوت عالٍ من أن
 * ينتقل بصمت لمنفذ آخر فيفتح أحدهم الرابط القديم ويرى تطبيقًا مختلفًا.
 *
 * البروكسي يوجّه /api و/uploads للسيرفر ويحذف ترويسة Origin: السيرفر يستمع
 * على كل الواجهات لتفتحه من جوّال حقيقي، وحينها يتغيّر الأصل (عنوان الحاسوب
 * في الشبكة) فترفضه قائمة CORS. الحذف يضع الطلب على مسار «من الأصل نفسه».
 * هذا للتطوير وحده؛ الإنتاج في docs/DEPLOY.md.
 */
const API_TARGET = process.env.NOZOL_API_TARGET || 'http://localhost:4010';

const proxyToApi = {
  target: API_TARGET,
  changeOrigin: true,
  configure(proxy) {
    proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'));
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5180,
    strictPort: true,
    proxy: { '/api': proxyToApi, '/uploads': proxyToApi },
  },
  preview: { port: 4180, strictPort: true },
  build: { sourcemap: false, chunkSizeWarningLimit: 800 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
    globals: true,
  },
});
