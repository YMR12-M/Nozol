import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/response.js';
import { quoteStay, publicQuote } from '../pricing/quote.service.js';
import { searchAvailability, calendar, listAvailableUnits } from './availability.service.js';
import { searchQuery, calendarQuery, quoteBody, availableUnitsQuery } from './availability.validation.js';

const router = Router({ mergeParams: true });

router.get('/availability', requirePermission('reservations.read'), validate({ query: searchQuery }),
  asyncHandler(async (req, res) => ok(res, await searchAvailability(req.property, req.query))));

/** الوحدات الفارغة فعلًا لنوع وتواريخ — لاختيار غرفة بعينها عند الحجز */
router.get('/availability/units', requirePermission('reservations.read'), validate({ query: availableUnitsQuery }),
  asyncHandler(async (req, res) => ok(res, await listAvailableUnits(req.property, req.query))));

router.get('/calendar', requirePermission('reservations.read'), validate({ query: calendarQuery }),
  asyncHandler(async (req, res) => ok(res, await calendar(req.property, req.query))));

router.post('/quote', requirePermission('reservations.read'), validate({ body: quoteBody }),
  asyncHandler(async (req, res) => ok(res, publicQuote(await quoteStay(req.property, req.body)))));

export default router;
