/**
 * الفوترة على مستوى المنشأة: الورديات النقدية، سجل المدفوعات، المصروفات.
 * (بنود الحجز ودفعاته وفواتيره تحت /reservations/:id.)
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, paged } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { idParams } from '../../utils/schemas.js';
import { shifts, payments, expenses } from './billing.service.js';
import {
  openShiftSchema, closeShiftSchema, listShiftsQuery, listPaymentsQuery, expenseSchema, listExpensesQuery, voidSchema,
} from './billing.validation.js';

const router = Router({ mergeParams: true });

/* الورديات: كل موظف يفتح وردية ويقفلها بنفسه */
router.get('/shifts/current', requirePermission('billing.shift'),
  asyncHandler(async (req, res) => ok(res, await shifts.current(req.property.id, req.user.id))));

router.post('/shifts/open', requirePermission('billing.shift'), validate({ body: openShiftSchema }),
  asyncHandler(async (req, res) => {
    const shift = await shifts.open(req.property.id, req.user.id, req.body.opening_float_minor);
    await audit(req, { action: 'shift.open', entity: 'shift', entityId: shift.id, after: { opening_float_minor: shift.opening_float_minor } });
    created(res, shift);
  }));

router.post('/shifts/close', requirePermission('billing.shift'), validate({ body: closeShiftSchema }),
  asyncHandler(async (req, res) => {
    const shift = await shifts.close(req.property.id, req.user.id, req.body);
    await audit(req, { action: 'shift.close', entity: 'shift', entityId: shift.id, after: { expected_cash_minor: shift.expected_cash_minor, counted_cash_minor: shift.counted_cash_minor, difference_minor: shift.difference_minor } });
    ok(res, shift);
  }));

router.get('/shifts', requirePermission('billing.read'), validate({ query: listShiftsQuery }),
  asyncHandler(async (req, res) => {
    const { rows, meta } = await shifts.list(req.property.id, req.query);
    paged(res, rows, meta);
  }));

router.get('/shifts/:id', requirePermission('billing.read'), validate({ params: idParams('id') }),
  asyncHandler(async (req, res) => ok(res, await shifts.get(req.property.id, req.params.id))));

/* سجل المدفوعات */
router.get('/payments', requirePermission('billing.read'), validate({ query: listPaymentsQuery }),
  asyncHandler(async (req, res) => {
    const { rows, meta } = await payments.listAll(req.property.id, req.query);
    paged(res, rows, meta);
  }));

/* المصروفات */
router.get('/expenses', requirePermission('expenses.read'), validate({ query: listExpensesQuery }),
  asyncHandler(async (req, res) => {
    const { rows, meta } = await expenses.list(req.property.id, req.query);
    paged(res, rows, meta);
  }));

router.post('/expenses', requirePermission('expenses.write'), validate({ body: expenseSchema }),
  asyncHandler(async (req, res) => {
    const expense = await expenses.create(req.property, req.body, req.user);
    await audit(req, { action: 'expense.create', entity: 'expense', entityId: expense.id, after: { category: expense.category, amount_minor: expense.amount_minor } });
    created(res, expense);
  }));

router.post('/expenses/:id/void', requirePermission('expenses.write'), validate({ params: idParams('id'), body: voidSchema }),
  asyncHandler(async (req, res) => {
    const expense = await expenses.void(req.property.id, req.params.id, req.body.reason);
    await audit(req, { action: 'expense.void', entity: 'expense', entityId: expense.id, before: { category: expense.category, amount_minor: expense.amount_minor }, after: { reason: req.body.reason } });
    ok(res, { id: expense.id, voided: true });
  }));

export default router;
