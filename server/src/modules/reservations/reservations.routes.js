/**
 * مسارات الحجوزات + فوترتها (بنود، دفعات، فواتير).
 * التسجيل في سجل التدقيق هنا (طبقة HTTP) لأنه يحتاج المستخدم والـ IP.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, paged } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { idParams } from '../../utils/schemas.js';
import { reservations } from './reservations.service.js';
import { folio, payments, invoices } from '../billing/billing.service.js';
import {
  folioItemSchema, paymentSchema, voidSchema, invoiceSchema,
} from '../billing/billing.validation.js';
import {
  createReservationSchema, quoteReservationSchema, updateReservationSchema, confirmSchema, checkInSchema, checkOutSchema,
  cancelSchema, noShowSchema, changeDatesSchema, moveSchema, listReservationsQuery,
} from './reservations.validation.js';

const router = Router({ mergeParams: true });
const withId = validate({ params: idParams('id') });

const brief = (reservation) => ({
  code: reservation.code, status: reservation.status, check_in: reservation.check_in,
  check_out: reservation.check_out, total_minor: reservation.total_minor, paid_minor: reservation.paid_minor,
});

/* ── القوائم والإنشاء ── */

router.get('/', requirePermission('reservations.read'), validate({ query: listReservationsQuery }),
  asyncHandler(async (req, res) => {
    const { rows, meta } = await reservations.list(req.property.id, req.query);
    paged(res, rows, meta);
  }));

/** معاينة سعر حجز كامل (غرف متعدّدة + خصم واحد على المجموع) بلا كتابة في القاعدة */
router.post('/quote', requirePermission('reservations.read'), validate({ body: quoteReservationSchema }),
  asyncHandler(async (req, res) => ok(res, await reservations.quote(req.property, req.body))));

router.post('/', requirePermission('reservations.write'), validate({ body: createReservationSchema }),
  asyncHandler(async (req, res) => {
    const reservation = await reservations.create(req.property, req.body, { user: req.user });
    await audit(req, { action: 'reservation.create', entity: 'reservation', entityId: reservation.id, after: { ...brief(reservation), source: reservation.source } });
    created(res, reservation);
  }));

router.get('/:id', requirePermission('reservations.read'), withId,
  asyncHandler(async (req, res) => ok(res, await reservations.get(req.property, req.params.id))));

router.patch('/:id', requirePermission('reservations.write'), validate({ params: idParams('id'), body: updateReservationSchema }),
  asyncHandler(async (req, res) => {
    const { before, after } = await reservations.update(req.property, req.params.id, req.body);
    await audit(req, { action: 'reservation.update', entity: 'reservation', entityId: after.id, before: brief(before), after: brief(after) });
    ok(res, after);
  }));

/* ── دورة الحياة ── */

router.post('/:id/confirm', requirePermission('reservations.write'), validate({ params: idParams('id'), body: confirmSchema }),
  asyncHandler(async (req, res) => {
    const reservation = await reservations.confirm(req.property, req.params.id, req.body);
    await audit(req, { action: 'reservation.confirm', entity: 'reservation', entityId: reservation.id, after: brief(reservation) });
    ok(res, reservation);
  }));

router.post('/:id/check-in', requirePermission('reservations.checkin'), validate({ params: idParams('id'), body: checkInSchema }),
  asyncHandler(async (req, res) => {
    const result = await reservations.checkIn(req.property, req.params.id, req.body);
    await audit(req, { action: 'reservation.check_in', entity: 'reservation', entityId: result.reservation.id, after: { ...brief(result.reservation), early: req.body.early, force_dirty: req.body.force_dirty } });
    ok(res, result);
  }));

router.post('/:id/check-out', requirePermission('reservations.checkin'), validate({ params: idParams('id'), body: checkOutSchema }),
  asyncHandler(async (req, res) => {
    const result = await reservations.checkOut(req.property, req.params.id, req.body, req.user);
    await audit(req, { action: 'reservation.check_out', entity: 'reservation', entityId: result.reservation.id, after: { ...brief(result.reservation), allow_unpaid: req.body.allow_unpaid, note: req.body.note } });
    ok(res, result);
  }));

router.post('/:id/cancel', requirePermission('reservations.cancel'), validate({ params: idParams('id'), body: cancelSchema }),
  asyncHandler(async (req, res) => {
    const result = await reservations.cancel(req.property, req.params.id, req.body);
    await audit(req, { action: 'reservation.cancel', entity: 'reservation', entityId: result.reservation.id, after: { ...brief(result.reservation), reason: req.body.reason, fee_minor: req.body.fee_minor } });
    ok(res, result);
  }));

router.post('/:id/no-show', requirePermission('reservations.cancel'), validate({ params: idParams('id'), body: noShowSchema }),
  asyncHandler(async (req, res) => {
    const result = await reservations.noShow(req.property, req.params.id, req.body);
    await audit(req, { action: 'reservation.no_show', entity: 'reservation', entityId: result.reservation.id, after: { ...brief(result.reservation), fee_minor: req.body.fee_minor } });
    ok(res, result);
  }));

router.post('/:id/change-dates', requirePermission('reservations.write'), validate({ params: idParams('id'), body: changeDatesSchema }),
  asyncHandler(async (req, res) => {
    const before = await reservations.get(req.property, req.params.id);
    const reservation = await reservations.changeDates(req.property, req.params.id, req.body, req.user);
    await audit(req, { action: 'reservation.change_dates', entity: 'reservation', entityId: reservation.id, before: brief(before), after: brief(reservation) });
    ok(res, reservation);
  }));

router.post('/:id/move', requirePermission('reservations.write'), validate({ params: idParams('id'), body: moveSchema }),
  asyncHandler(async (req, res) => {
    const result = await reservations.moveUnit(req.property, req.params.id, req.body);
    await audit(req, { action: 'reservation.move_unit', entity: 'reservation', entityId: result.reservation.id, after: result.moved });
    ok(res, result);
  }));

/* ── بنود الفاتورة ── */

router.post('/:id/items', requirePermission('billing.write'), validate({ params: idParams('id'), body: folioItemSchema }),
  asyncHandler(async (req, res) => {
    const result = await folio.add(req.property, Number(req.params.id), req.body, req.user);
    await audit(req, { action: 'folio.add', entity: 'reservation', entityId: Number(req.params.id), after: { item_id: result.item.id, type: result.item.type, amount_minor: result.item.amount_minor, description: result.item.description } });
    created(res, result);
  }));

router.post('/:id/items/:itemId/void', requirePermission('billing.void'), validate({ params: idParams('id', 'itemId'), body: voidSchema }),
  asyncHandler(async (req, res) => {
    const result = await folio.void(req.property, Number(req.params.id), Number(req.params.itemId), req.body.reason, req.user);
    await audit(req, { action: 'folio.void', entity: 'reservation', entityId: Number(req.params.id), before: { item_id: result.item.id, amount_minor: result.item.amount_minor, description: result.item.description }, after: { reason: req.body.reason } });
    ok(res, result);
  }));

/* ── المدفوعات ── */

router.post('/:id/payments', requirePermission('billing.write'), validate({ params: idParams('id'), body: paymentSchema }),
  asyncHandler(async (req, res) => {
    const result = await payments.add(req.property, Number(req.params.id), req.body, req.user);
    await audit(req, { action: `payment.${req.body.type}`, entity: 'reservation', entityId: Number(req.params.id), after: { payment_id: result.payment.id, method: result.payment.method, amount_minor: result.payment.amount_minor } });
    created(res, result);
  }));

router.post('/:id/payments/:paymentId/void', requirePermission('billing.void'), validate({ params: idParams('id', 'paymentId'), body: voidSchema }),
  asyncHandler(async (req, res) => {
    const result = await payments.void(req.property, Number(req.params.id), Number(req.params.paymentId), req.body.reason, req.user);
    await audit(req, { action: 'payment.void', entity: 'reservation', entityId: Number(req.params.id), before: { payment_id: result.payment.id, method: result.payment.method, amount_minor: result.payment.amount_minor }, after: { reason: req.body.reason } });
    ok(res, result);
  }));

/* ── الفواتير ── */

router.get('/:id/invoices', requirePermission('billing.read'), withId,
  asyncHandler(async (req, res) => {
    await reservations.get(req.property, req.params.id);
    ok(res, await invoices.list(req.property.id, Number(req.params.id)));
  }));

router.post('/:id/invoices', requirePermission('billing.write'), validate({ params: idParams('id'), body: invoiceSchema }),
  asyncHandler(async (req, res) => {
    const invoice = await invoices.issue(req.property, Number(req.params.id), req.body, req.user);
    await audit(req, { action: 'invoice.issue', entity: 'invoice', entityId: invoice.id, after: { number: invoice.number, total_minor: invoice.total_minor } });
    created(res, await invoices.get(req.property.id, invoice.id));
  }));

export default router;

/** /properties/:propertyId/invoices/:id — عرض وإلغاء فاتورة بمعرّفها */
export const invoicesRouter = Router({ mergeParams: true });

invoicesRouter.get('/:id', requirePermission('billing.read'), withId,
  asyncHandler(async (req, res) => ok(res, await invoices.get(req.property.id, req.params.id))));

invoicesRouter.post('/:id/void', requirePermission('billing.void'), validate({ params: idParams('id'), body: voidSchema }),
  asyncHandler(async (req, res) => {
    const invoice = await invoices.void(req.property.id, req.params.id, req.body.reason);
    await audit(req, { action: 'invoice.void', entity: 'invoice', entityId: invoice.id, before: { number: invoice.number }, after: { reason: req.body.reason } });
    ok(res, await invoices.get(req.property.id, invoice.id));
  }));
