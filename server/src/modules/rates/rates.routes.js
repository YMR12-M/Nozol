import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { idParams } from '../../utils/schemas.js';
import {
  ratePlansController as plans, priceRulesController as rules,
  promoCodesController as promos, servicesController as services,
} from './rates.controller.js';
import {
  createRatePlanSchema, updateRatePlanSchema, createPriceRuleSchema, updatePriceRuleSchema, listPriceRulesQuery,
  createPromoSchema, updatePromoSchema, createServiceSchema, updateServiceSchema,
} from './rates.validation.js';

/** يبني مسارات CRUD القياسية لمورد واحد */
function crud(router, path, controller, { create, update, listQuery, read, write }) {
  const id = validate({ params: idParams('id') });
  router.get(path, requirePermission(read), ...(listQuery ? [validate({ query: listQuery })] : []), controller.list);
  router.post(path, requirePermission(write), validate({ body: create }), controller.create);
  router.get(`${path}/:id`, requirePermission(read), id, controller.get);
  router.patch(`${path}/:id`, requirePermission(write), validate({ params: idParams('id'), body: update }), controller.update);
  router.delete(`${path}/:id`, requirePermission(write), id, controller.remove);
}

const router = Router({ mergeParams: true });

crud(router, '/rate-plans', plans, { create: createRatePlanSchema, update: updateRatePlanSchema, read: 'rates.read', write: 'rates.write' });
crud(router, '/price-rules', rules, { create: createPriceRuleSchema, update: updatePriceRuleSchema, listQuery: listPriceRulesQuery, read: 'rates.read', write: 'rates.write' });
crud(router, '/promo-codes', promos, { create: createPromoSchema, update: updatePromoSchema, read: 'rates.read', write: 'rates.write' });
// الخدمات تُقرأ من الاستقبال لإضافتها على الفاتورة، وتُعدَّل بصلاحية الأسعار
crud(router, '/services', services, { create: createServiceSchema, update: updateServiceSchema, read: 'property.read', write: 'rates.write' });

export default router;
