import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { uploader } from '../../middleware/upload.js';
import { uploadLimiter } from '../../middleware/rateLimiters.js';
import { idParams } from '../../utils/schemas.js';
import { unitTypesController as c } from './unitTypes.controller.js';
import { createUnitTypeSchema, updateUnitTypeSchema, listUnitTypesQuery } from './unitTypes.validation.js';

const router = Router({ mergeParams: true });

router.get('/', requirePermission('units.read'), validate({ query: listUnitTypesQuery }), c.list);
router.post('/', requirePermission('units.write'), validate({ body: createUnitTypeSchema }), c.create);
router.get('/:id', requirePermission('units.read'), validate({ params: idParams('id') }), c.get);
router.patch('/:id', requirePermission('units.write'), validate({ params: idParams('id'), body: updateUnitTypeSchema }), c.update);
router.delete('/:id', requirePermission('units.write'), validate({ params: idParams('id') }), c.remove);

router.post('/:id/photos', requirePermission('units.write'), uploadLimiter, validate({ params: idParams('id') }), uploader.array('photos', 6), c.addPhotos);
router.delete('/:id/photos/:photoId', requirePermission('units.write'), validate({ params: idParams('id', 'photoId') }), c.removePhoto);

export default router;
