/**
 * مسارات الحجز العام: /api/v1/public/properties/:slug/...
 * بلا مصادقة، لذا كلها بحدود معدّل. CORS مفتوح لها وحدها (يُضمَّن الـ widget في مواقع الفنادق).
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { publicBookingLimiter, publicLimiter } from '../../middleware/rateLimiters.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import {
  cancelBody, cancelBooking, createBooking, findPublicProperty, lookupBooking, lookupQuery,
  propertyInfo, publicBookingSchema, publicSearchQuery, search,
} from './public.service.js';

const router = Router();

/** يحمّل المنشأة العامة ويضعها على الطلب */
router.param('slug', (req, _res, next, slug) => {
  findPublicProperty(slug).then((property) => { req.publicProperty = property; next(); }).catch(next);
});

router.get('/properties/:slug', publicLimiter,
  asyncHandler(async (req, res) => ok(res, await propertyInfo(req.publicProperty))));

router.get('/properties/:slug/availability', publicLimiter, validate({ query: publicSearchQuery }),
  asyncHandler(async (req, res) => ok(res, await search(req.publicProperty, req.query))));

router.post('/properties/:slug/bookings', publicBookingLimiter, validate({ body: publicBookingSchema }),
  asyncHandler(async (req, res) => {
    const booking = await createBooking(req.publicProperty, req.body);
    await audit(req, {
      action: 'reservation.create_public', entity: 'reservation', propertyId: req.publicProperty.id,
      after: { code: booking.code, check_in: booking.check_in, check_out: booking.check_out, total_minor: booking.total_minor },
    });
    created(res, booking);
  }));

router.get('/properties/:slug/bookings/:code', publicLimiter, validate({ query: lookupQuery }),
  asyncHandler(async (req, res) => ok(res, await lookupBooking(req.publicProperty, req.params.code, req.query.phone))));

router.post('/properties/:slug/bookings/:code/cancel', publicBookingLimiter, validate({ body: cancelBody }),
  asyncHandler(async (req, res) => {
    const view = await cancelBooking(req.publicProperty, req.params.code, req.body);
    await audit(req, {
      action: 'reservation.cancel_public', entity: 'reservation', propertyId: req.publicProperty.id, after: { code: view.code },
    });
    ok(res, view);
  }));

export default router;
