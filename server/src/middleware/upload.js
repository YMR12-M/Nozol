/**
 * ═══════════════════════════════════════════════════════════════
 *  رفع الملفات
 *
 *  • الملف يُقرأ في الذاكرة (حدّ الحجم صغير)، ثم نفحص **أول بايتات
 *    الملف** (magic bytes) لنعرف نوعه الحقيقي — لا نصدّق `Content-Type`
 *    ولا امتداد الاسم، فهما يُزوَّران بسهولة.
 *  • الاسم على القرص عشوائي بامتداد من النوع المكتشف؛ اسم العميل
 *    الأصلي لا يلمس نظام الملفات أبدًا (يُخزَّن للعرض فقط بعد تنظيفه).
 *  • مجلّدان منفصلان:
 *      public/   صور الوحدات — تُقدَّم علنًا من /uploads
 *      private/  صور الهويّات والإيصالات — لا تُقدَّم إلا عبر مسار
 *                مصادَق عليه يتحقّق من الصلاحية.
 * ═══════════════════════════════════════════════════════════════
 */
import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** النوع الحقيقي من أول البايتات، أو null لو غير مدعوم */
export function sniffMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  return null;
}

export const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploads.maxFileMb * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, callback) => {
    if (EXT_BY_MIME[file.mimetype]) return callback(null, true);
    return callback(ApiError.badRequest('نوع الملف غير مدعوم — صور JPG أو PNG أو WebP أو ملف PDF فقط', { code: 'FILE_TYPE' }));
  },
});

const cleanName = (name) => String(name || 'file')
  // eslint-disable-next-line no-control-regex -- نزيل محارف التحكّم عمدًا
  .replace(/[\u0000-\u001f\\/]/g, '')
  .slice(-120);

/**
 * يحفظ الملف على القرص بعد التحقّق من نوعه.
 *
 * @param {object} file                ملف multer
 * @param {object} options
 * @param {'public'|'private'} options.visibility
 * @param {number} options.propertyId  لتنظيم المجلّدات (رقم فقط — لا مدخلات مستخدم)
 * @param {boolean} [options.allowPdf]
 */
export async function persistUpload(file, { visibility, propertyId, allowPdf = false }) {
  const mime = sniffMime(file.buffer);
  if (!mime || (mime === 'application/pdf' && !allowPdf)) {
    throw ApiError.badRequest(
      allowPdf ? 'الملف تالف أو نوعه غير مدعوم' : 'الملف لازم يكون صورة JPG أو PNG أو WebP',
      { code: 'FILE_TYPE' },
    );
  }

  const month = new Date().toISOString().slice(0, 7);
  const relative = join(visibility, `p${Number(propertyId)}`, month, `${crypto.randomUUID()}.${EXT_BY_MIME[mime]}`);
  const absolute = join(env.uploads.dir, relative);

  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, file.buffer, { flag: 'wx' });

  return {
    path: relative.split(sep).join('/'),
    mime,
    size: file.size,
    originalName: cleanName(file.originalname),
  };
}

/** رابط علني لملف داخل public/ فقط */
export const publicFileUrl = (path) => `${env.uploads.publicUrl || env.apiPublicUrl}/uploads/${path.replace(/^public\//, '')}`;
