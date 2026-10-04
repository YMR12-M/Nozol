import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { can } from '../../config/permissions.js';
import { ok, created, noContent } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { unitsService } from './units.service.js';

const brief = (unit) => ({ id: unit.id, code: unit.code, unit_type_id: unit.unit_type_id, status: unit.status });

export const unitsController = {
  list: asyncHandler(async (req, res) => ok(res, await unitsService.list(req.property.id, req.query))),

  get: asyncHandler(async (req, res) => ok(res, await unitsService.find(req.property.id, req.params.id))),

  create: asyncHandler(async (req, res) => {
    const unit = await unitsService.create(req.property.id, req.body);
    await audit(req, { action: 'unit.create', entity: 'unit', entityId: unit.id, after: brief(unit) });
    created(res, unit);
  }),

  bulkCreate: asyncHandler(async (req, res) => {
    const units = await unitsService.bulkCreate(req.property.id, req.body);
    await audit(req, { action: 'unit.bulk_create', entity: 'unit', after: { unit_type_id: req.body.unit_type_id, count: units.length } });
    created(res, units);
  }),

  update: asyncHandler(async (req, res) => {
    const { before, after, affected_reservations: affected } = await unitsService.update(req.property, req.params.id, req.body);
    await audit(req, { action: 'unit.update', entity: 'unit', entityId: after.id, before: brief(before), after: brief(after) });
    ok(res, { unit: after, affected_reservations: affected });
  }),

  remove: asyncHandler(async (req, res) => {
    const { before, archived } = await unitsService.remove(req.property, req.params.id);
    await audit(req, { action: archived ? 'unit.archive' : 'unit.delete', entity: 'unit', entityId: before.id, before: brief(before) });
    if (archived) return ok(res, { archived: true });
    return noContent(res);
  }),

  setHousekeeping: asyncHandler(async (req, res) => {
    // «تم الفحص» اعتماد إشرافي: لا يمنحه عامل التنظيف لنفسه
    if (req.body.status === 'inspected' && !can(req.user.role, 'housekeeping.manage')) {
      throw ApiError.forbidden('الفحص النهائي للمشرف فقط', { code: 'FORBIDDEN' });
    }
    ok(res, await unitsService.setHousekeepingStatus(req.property.id, req.params.id, req.body.status));
  }),

  listBlocks: asyncHandler(async (req, res) => ok(res, await unitsService.listBlocks(req.property.id, req.params.id))),

  createBlock: asyncHandler(async (req, res) => {
    const block = await unitsService.createBlock(req.property.id, req.params.id, req.body, req.user.id);
    await audit(req, {
      action: 'unit.block', entity: 'unit', entityId: Number(req.params.id),
      after: { start_date: block.start_date, end_date: block.end_date, reason: block.reason },
    });
    created(res, block);
  }),

  removeBlock: asyncHandler(async (req, res) => {
    const block = await unitsService.removeBlock(req.property.id, req.params.blockId);
    await audit(req, {
      action: 'unit.unblock', entity: 'unit', entityId: block.unit_id,
      before: { start_date: block.start_date, end_date: block.end_date },
    });
    noContent(res);
  }),
};
