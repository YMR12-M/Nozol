/**
 * تقديم المرفقات الخاصة بعد التحقّق من صلاحية قراءة كيانها.
 * المسار: GET /properties/:propertyId/attachments/:id/file
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { can } from '../../config/permissions.js';
import { idParams } from '../../utils/schemas.js';
import { attachmentsService, READ_PERMISSION } from './attachments.service.js';

const router = Router({ mergeParams: true });

router.get('/:id/file', validate({ params: idParams('id') }), asyncHandler(async (req, res) => {
  const row = await attachmentsService.find(req.property.id, req.params.id);
  if (!can(req.user.role, READ_PERMISSION[row.entity])) {
    throw ApiError.forbidden('لا تملك صلاحية لهذا الملف', { code: 'FORBIDDEN' });
  }

  // لا نسمح للمتصفّح بتخمين نوع الملف أو تنفيذه، ولا بتخزينه في وسيط عام
  res.setHeader('Content-Type', row.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  res.sendFile(attachmentsService.absolutePath(row), { dotfiles: 'deny' });
}));

export default router;
