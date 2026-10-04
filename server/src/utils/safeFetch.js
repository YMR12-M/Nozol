/**
 * ═══════════════════════════════════════════════════════════════
 *  جلب رابط خارجي بأمان (SSRF)
 *
 *  رابط iCal يكتبه المستخدم، فيستطيع أن يكتب `http://169.254.169.254/` أو
 *  `http://localhost:3306` ليجعل السيرفر نفسه يقرأ من شبكته الداخلية. نمنع ذلك:
 *   • http/https فقط، بلا اسم مستخدم/كلمة مرور في الرابط.
 *   • نحلّ الاسم **عند الاتصال نفسه** (lookup مخصّص) ونرفض أي عنوان داخلي،
 *     فلا ينفع تلاعب DNS (يرجع عنوانًا عامًّا عند الفحص وداخليًّا عند الاتصال).
 *   • كل تحويلة (redirect) تمرّ على نفس الفحص، بحدّ أقصى 3.
 *   • مهلة قصيرة وحدّ حجم للاستجابة.
 * ═══════════════════════════════════════════════════════════════
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { ApiError } from './ApiError.js';

/** عنوان IP داخلي/خاص/محجوز؟ (IPv4 و IPv6 و IPv4-mapped) */
export function isPrivateIp(address) {
  let ip = address.toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7); // ::ffff:127.0.0.1

  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 192 && b === 0);
  }
  if (net.isIPv6(ip)) {
    return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd')
      || ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')
      || ip.startsWith('ff');
  }
  return true; // لا نفهمه ← نرفضه
}

const blocked = () => ApiError.badRequest('الرابط ده غير مسموح (لازم عنوان عام على الإنترنت)', { code: 'URL_NOT_ALLOWED' });

/** فحص شكل الرابط قبل أي اتصال */
export function assertSafeUrl(urlString, { allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw ApiError.badRequest('الرابط غير صالح', { code: 'URL_INVALID' });
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw blocked();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && net.isIP(host) && isPrivateIp(host)) throw blocked();
  return url;
}

function guardedLookup(allowPrivate) {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const allowed = allowPrivate ? addresses : addresses.filter((entry) => !isPrivateIp(entry.address));
      if (allowed.length === 0) return callback(blocked());
      if (options.all) return callback(null, allowed);
      return callback(null, allowed[0].address, allowed[0].family);
    });
  };
}

function requestOnce(url, { timeoutMs, maxBytes, allowPrivate }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.get(url, {
      lookup: guardedLookup(allowPrivate),
      timeout: timeoutMs,
      headers: { 'User-Agent': 'Nozol-iCal/1.0', Accept: 'text/calendar, text/plain, */*' },
    }, (response) => {
      const { statusCode, headers } = response;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume();
        resolve({ redirect: new URL(headers.location, url).toString() });
        return;
      }
      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`الخادم رد بـ HTTP ${statusCode}`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(new Error('الملف أكبر من المسموح')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('انتهت مهلة الاتصال')));
    request.on('error', reject);
  });
}

/** يجلب نصًّا من رابط عام، مع تتبّع تحويلات آمنة */
export async function fetchText(urlString, {
  timeoutMs = 10_000, maxBytes = 1_000_000, maxRedirects = 3, allowPrivate = false,
} = {}) {
  let current = urlString;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = assertSafeUrl(current, { allowPrivate });
    const result = await requestOnce(url, { timeoutMs, maxBytes, allowPrivate });
    if (result.text !== undefined) return result.text;
    current = result.redirect;
  }
  throw new Error('تحويلات كتير');
}
