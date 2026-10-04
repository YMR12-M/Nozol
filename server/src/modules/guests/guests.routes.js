import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { uploader } from '../../middleware/upload.js';
import { uploadLimiter } from '../../middleware/rateLimiters.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent, paged } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { idParams } from '../../utils/schemas.js';
import { attachmentsService } from '../attachments/attachments.service.js';
import { guestsService } from './guests.service.js';
import { createGuestSchema, updateGuestSchema, listGuestsQuery } from './guests.validation.js';

const router = Router({ mergeParams: true });
const idOnly = validate({ params: idParams('id') });

router.get('/', requirePermission('guests.read'), validate({ query: listGuestsQuery }),
  asyncHandler(async (req, res) => {
    const { rows, meta } = await guestsService.list(req.property.id, req.query);
    paged(res, rows, meta);
  }));

router.post('/', requirePermission('guests.write'), validate({ body: createGuestSchema }),
  asyncHandler(async (req, res) => {
    const guest = await guestsService.create(req.property.id, req.body);
    await audit(req, { action: 'guest.create', entity: 'guest', entityId: guest.id, after: { full_name: guest.full_name } });
    created(res, guest);
  }));

router.get('/:id', requirePermission('guests.read'), idOnly,
  asyncHandler(async (req, res) => ok(res, await guestsService.get(req.property.id, req.params.id))));

router.patch('/:id', requirePermission('guests.write'), validate({ params: idParams('id'), body: updateGuestSchema }),
  asyncHandler(async (req, res) => {
    const { before, after } = await guestsService.update(req.property.id, req.params.id, req.body);
    await audit(req, {
      action: 'guest.update', entity: 'guest', entityId: after.id,
      before: { full_name: before.full_name, is_blacklisted: before.is_blacklisted, is_vip: before.is_vip },
      after: { full_name: after.full_name, is_blacklisted: after.is_blacklisted, is_vip: after.is_vip },
    });
    ok(res, after);
  }));

router.delete('/:id', requirePermission('guests.write'), idOnly,
  asyncHandler(async (req, res) => {
    const removed = await guestsService.remove(req.property.id, req.params.id);
    await audit(req, { action: 'guest.delete', entity: 'guest', entityId: removed.id, before: { full_name: removed.full_name } });
    noContent(res);
  }));

/* صور الهويّات: مرفقات خاصة (صور أو PDF) */
router.get('/:id/documents', requirePermission('guests.read'), idOnly,
  asyncHandler(async (req, res) => {
    await guestsService.find(req.property.id, req.params.id);
    ok(res, await attachmentsService.list(req.property.id, 'guest', req.params.id));
  }));

router.post('/:id/documents', requirePermission('guests.write'), uploadLimiter, idOnly, uploader.array('documents', 4),
  asyncHandler(async (req, res) => {
    await guestsService.find(req.property.id, req.params.id);
    const files = await attachmentsService.add({
      propertyId: req.property.id, entity: 'guest', entityId: req.params.id,
      files: req.files, visibility: 'private', allowPdf: true, userId: req.user.id,
    });
    await audit(req, { action: 'guest.document_upload', entity: 'guest', entityId: Number(req.params.id), after: { count: files.length } });
    created(res, files);
  }));

router.delete('/:id/documents/:documentId', requirePermission('guests.write'), validate({ params: idParams('id', 'documentId') }),
  asyncHandler(async (req, res) => {
    await attachmentsService.remove(req.property.id, req.params.documentId, 'guest');
    await audit(req, { action: 'guest.document_delete', entity: 'guest', entityId: Number(req.params.id) });
    noContent(res);
  }));

export default router;
