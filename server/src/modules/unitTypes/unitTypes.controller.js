import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { attachmentsService } from '../attachments/attachments.service.js';
import { unitTypesService } from './unitTypes.service.js';

const brief = (type) => ({
  id: type.id, code: type.code, name_ar: type.name_ar, base_price_minor: type.base_price_minor, is_active: type.is_active,
});

export const unitTypesController = {
  list: asyncHandler(async (req, res) => ok(res, await unitTypesService.list(req.property.id, req.query))),

  get: asyncHandler(async (req, res) => ok(res, await unitTypesService.get(req.property.id, req.params.id))),

  create: asyncHandler(async (req, res) => {
    const type = await unitTypesService.create(req.property.id, req.body);
    await audit(req, { action: 'unit_type.create', entity: 'unit_type', entityId: type.id, after: brief(type) });
    created(res, type);
  }),

  update: asyncHandler(async (req, res) => {
    const { before, after } = await unitTypesService.update(req.property.id, req.params.id, req.body);
    await audit(req, {
      action: 'unit_type.update', entity: 'unit_type', entityId: after.id,
      before: { base_price_minor: before.base_price_minor, name_ar: before.name_ar, is_active: before.is_active },
      after: { base_price_minor: after.base_price_minor, name_ar: after.name_ar, is_active: after.is_active },
    });
    ok(res, after);
  }),

  remove: asyncHandler(async (req, res) => {
    const removed = await unitTypesService.remove(req.property.id, req.params.id);
    await audit(req, { action: 'unit_type.delete', entity: 'unit_type', entityId: removed.id, before: brief(removed) });
    noContent(res);
  }),

  addPhotos: asyncHandler(async (req, res) => {
    await unitTypesService.find(req.property.id, req.params.id);
    const photos = await attachmentsService.add({
      propertyId: req.property.id,
      entity: 'unit_type',
      entityId: req.params.id,
      files: req.files,
      visibility: 'public',
      userId: req.user.id,
    });
    created(res, photos);
  }),

  removePhoto: asyncHandler(async (req, res) => {
    await attachmentsService.remove(req.property.id, req.params.photoId, 'unit_type');
    noContent(res);
  }),
};
