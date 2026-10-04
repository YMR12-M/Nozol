import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { idParams } from '../../utils/schemas.js';
import { unitsController as c } from './units.controller.js';
import {
  createUnitSchema, updateUnitSchema, bulkCreateSchema, listUnitsQuery, housekeepingStatusSchema, blockSchema,
} from './units.validation.js';

const router = Router({ mergeParams: true });

router.get('/', requirePermission('units.read'), validate({ query: listUnitsQuery }), c.list);
router.post('/', requirePermission('units.write'), validate({ body: createUnitSchema }), c.create);
router.post('/bulk', requirePermission('units.write'), validate({ body: bulkCreateSchema }), c.bulkCreate);

router.get('/:id', requirePermission('units.read'), validate({ params: idParams('id') }), c.get);
router.patch('/:id', requirePermission('units.write'), validate({ params: idParams('id'), body: updateUnitSchema }), c.update);
router.delete('/:id', requirePermission('units.write'), validate({ params: idParams('id') }), c.remove);

router.patch('/:id/housekeeping', requirePermission('housekeeping.write'), validate({ params: idParams('id'), body: housekeepingStatusSchema }), c.setHousekeeping);

router.get('/:id/blocks', requirePermission('units.read'), validate({ params: idParams('id') }), c.listBlocks);
router.post('/:id/blocks', requirePermission('units.write'), validate({ params: idParams('id'), body: blockSchema }), c.createBlock);

export default router;

/** حذف حجب بمعرّفه: /properties/:propertyId/blocks/:blockId */
export const blocksRouter = Router({ mergeParams: true });
blocksRouter.delete('/:blockId', requirePermission('units.write'), validate({ params: idParams('blockId') }), c.removeBlock);
