import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { ratePlans, priceRules, promoCodes, services } from './rates.service.js';

/** كل مورد: list/get/create/update/remove بنفس الشكل، ويُسجَّل تدقيقه */
function resourceController({ service, entity, brief }) {
  return {
    list: asyncHandler(async (req, res) => ok(res, await service.list(req.property.id, req.query))),

    get: asyncHandler(async (req, res) => ok(res, await service.find(req.property.id, req.params.id))),

    create: asyncHandler(async (req, res) => {
      const result = await service.create(req.property.id, req.body);
      for (const row of [].concat(result)) {
        await audit(req, { action: `${entity}.create`, entity, entityId: row.id, after: brief(row) });
      }
      created(res, result);
    }),

    update: asyncHandler(async (req, res) => {
      const { before, after } = await service.update(req.property.id, req.params.id, req.body);
      await audit(req, { action: `${entity}.update`, entity, entityId: after.id, before: brief(before), after: brief(after) });
      ok(res, after);
    }),

    remove: asyncHandler(async (req, res) => {
      const result = await service.remove(req.property.id, req.params.id);
      const before = result.before ?? result;
      await audit(req, { action: `${entity}.delete`, entity, entityId: before.id, before: brief(before) });
      if (result.deactivated) return ok(res, { deactivated: true });
      return noContent(res);
    }),
  };
}

export const ratePlansController = resourceController({
  service: ratePlans,
  entity: 'rate_plan',
  brief: (r) => ({ code: r.code, name_ar: r.name_ar, meal_plan: r.meal_plan, discount_bps: r.discount_bps, is_active: r.is_active }),
});

export const priceRulesController = resourceController({
  service: priceRules,
  entity: 'price_rule',
  brief: (r) => ({
    unit_type_id: r.unit_type_id, name: r.name, start_date: r.start_date, end_date: r.end_date,
    kind: r.kind, price_minor: r.price_minor, percent_bps: r.percent_bps, is_active: r.is_active,
  }),
});

export const promoCodesController = resourceController({
  service: promoCodes,
  entity: 'promo_code',
  brief: (r) => ({ code: r.code, discount_type: r.discount_type, value: r.value, is_active: r.is_active }),
});

export const servicesController = resourceController({
  service: { ...services, list: (propertyId) => services.list(propertyId) },
  entity: 'service',
  brief: (r) => ({ name_ar: r.name_ar, price_minor: r.price_minor, is_active: r.is_active }),
});
