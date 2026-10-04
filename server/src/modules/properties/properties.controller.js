import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { propertiesService } from './properties.service.js';

/** الحقول التي تغيّرت فقط — سجل التدقيق أقصر وأوضح من نسختين كاملتين */
function diff(before, after) {
  const changedBefore = {};
  const changedAfter = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }
  return { before: changedBefore, after: changedAfter };
}

export const propertiesController = {
  list: asyncHandler(async (req, res) => ok(res, await propertiesService.list(req.user))),

  create: asyncHandler(async (req, res) => {
    const property = await propertiesService.create(req.user, req.body);
    await audit(req, { action: 'property.create', entity: 'property', entityId: property.id, propertyId: property.id, after: { name_ar: property.name_ar, slug: property.slug } });
    created(res, property);
  }),

  get: asyncHandler(async (req, res) => ok(res, {
    ...req.property,
    summary: await propertiesService.summary(req.property),
  })),

  update: asyncHandler(async (req, res) => {
    const updated = await propertiesService.update(req.property, req.body);
    const { before, after } = diff(req.property, updated);
    if (Object.keys(after).length > 0) {
      await audit(req, { action: 'property.update', entity: 'property', entityId: updated.id, before, after });
    }
    ok(res, updated);
  }),

  archive: asyncHandler(async (req, res) => {
    await propertiesService.archive(req.property);
    await audit(req, { action: 'property.archive', entity: 'property', entityId: req.property.id });
    noContent(res);
  }),
};
