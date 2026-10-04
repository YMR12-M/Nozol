import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireRole } from '../../middleware/authorize.js';
import { propertyScope } from '../../middleware/propertyScope.js';
import propertyRoutes from '../../routes/property.routes.js';
import { propertiesController as c } from './properties.controller.js';
import { createPropertySchema } from './properties.validation.js';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('property.read'), c.list);
router.post('/', requireRole('owner'), validate({ body: createPropertySchema }), c.create);

// كل ما تحت /properties/:propertyId مقيَّد بالمنشأة وصلاحية المستخدم عليها
router.use('/:propertyId', propertyScope, propertyRoutes);

export default router;
