/**
 * كل مسارات المنشأة: /api/v1/properties/:propertyId/...
 *
 * يصلها الطلب بعد `authenticate` و`propertyScope`، فـ `req.user` و`req.property`
 * جاهزان. كل وحدة تحت تتحقّق من صلاحيتها بنفسها وتقيّد استعلاماتها
 * بـ `req.property.id`.
 */
import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requirePermission, requireRole } from '../middleware/authorize.js';
import { propertiesController as properties } from '../modules/properties/properties.controller.js';
import { updatePropertySchema } from '../modules/properties/properties.validation.js';
import unitTypeRoutes from '../modules/unitTypes/unitTypes.routes.js';
import unitRoutes, { blocksRouter } from '../modules/units/units.routes.js';
import rateRoutes from '../modules/rates/rates.routes.js';
import availabilityRoutes from '../modules/availability/availability.routes.js';
import guestRoutes from '../modules/guests/guests.routes.js';
import reservationRoutes, { invoicesRouter } from '../modules/reservations/reservations.routes.js';
import billingRoutes from '../modules/billing/billing.routes.js';
import attachmentRoutes from '../modules/attachments/attachments.routes.js';
import housekeepingRoutes from '../modules/housekeeping/housekeeping.routes.js';
import maintenanceRoutes from '../modules/maintenance/maintenance.routes.js';
import auditRoutes from '../modules/audit/audit.routes.js';
import icalRoutes from '../modules/ical/ical.routes.js';
import reportRoutes from '../modules/reports/reports.routes.js';

const router = Router({ mergeParams: true });

router.get('/', requirePermission('property.read'), properties.get);
router.patch('/', requirePermission('property.write'), validate({ body: updatePropertySchema }), properties.update);
router.post('/archive', requireRole('owner'), properties.archive);

router.use('/unit-types', unitTypeRoutes);
router.use('/units', unitRoutes);
router.use('/blocks', blocksRouter);
router.use('/', rateRoutes); // /rate-plans · /price-rules · /promo-codes · /services
router.use('/', availabilityRoutes); // /availability · /calendar · /quote
router.use('/guests', guestRoutes);
router.use('/reservations', reservationRoutes);
router.use('/invoices', invoicesRouter);
router.use('/', billingRoutes); // /shifts · /payments · /expenses
router.use('/attachments', attachmentRoutes);
router.use('/housekeeping', housekeepingRoutes);
router.use('/maintenance', maintenanceRoutes);
router.use('/audit-logs', auditRoutes);
router.use('/ical', icalRoutes);
router.use('/reports', reportRoutes);

export default router;
