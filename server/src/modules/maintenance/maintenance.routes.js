import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { uploader } from '../../middleware/upload.js';
import { uploadLimiter } from '../../middleware/rateLimiters.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { idParams } from '../../utils/schemas.js';
import { attachmentsService } from '../attachments/attachments.service.js';
import {
  maintenance, createRequestSchema, updateRequestSchema, listRequestsQuery,
} from './maintenance.service.js';

const router = Router({ mergeParams: true });
const brief = (m) => ({ title: m.title, priority: m.priority, status: m.status, unit_code: m.unit_code, cost_minor: m.cost_minor });

router.get('/', requirePermission('maintenance.read'), validate({ query: listRequestsQuery }),
  asyncHandler(async (req, res) => ok(res, await maintenance.list(req.property.id, req.query, req.user))));

router.post('/', requirePermission('maintenance.write'), validate({ body: createRequestSchema }),
  asyncHandler(async (req, res) => {
    const request = await maintenance.create(req.property, req.body, req.user);
    await audit(req, { action: 'maintenance.create', entity: 'maintenance', entityId: request.id, after: brief(request) });
    created(res, request);
  }));

router.get('/:id', requirePermission('maintenance.read'), validate({ params: idParams('id') }),
  asyncHandler(async (req, res) => {
    const request = await maintenance.find(req.property.id, req.params.id);
    ok(res, { ...request, attachments: await attachmentsService.list(req.property.id, 'maintenance', request.id) });
  }));

router.patch('/:id', requirePermission('maintenance.write'), validate({ params: idParams('id'), body: updateRequestSchema }),
  asyncHandler(async (req, res) => {
    const { before, after } = await maintenance.update(req.property, req.params.id, req.body, req.user);
    await audit(req, { action: 'maintenance.update', entity: 'maintenance', entityId: after.id, before: brief(before), after: brief(after) });
    ok(res, after);
  }));

router.post('/:id/photos', requirePermission('maintenance.write'), uploadLimiter, validate({ params: idParams('id') }), uploader.array('photos', 6),
  asyncHandler(async (req, res) => {
    await maintenance.find(req.property.id, req.params.id);
    created(res, await attachmentsService.add({
      propertyId: req.property.id, entity: 'maintenance', entityId: req.params.id,
      files: req.files, visibility: 'private', userId: req.user.id,
    }));
  }));

router.delete('/:id/photos/:photoId', requirePermission('maintenance.write'), validate({ params: idParams('id', 'photoId') }),
  asyncHandler(async (req, res) => {
    await attachmentsService.remove(req.property.id, req.params.photoId, 'maintenance');
    noContent(res);
  }));

export default router;
