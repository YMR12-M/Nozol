import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/response.js';
import { startOfMonth, todayIn } from '../../utils/dates.js';
import { isoDate } from '../../utils/schemas.js';
import { audit } from '../../utils/audit.js';
import { reports } from './reports.service.js';

const router = Router({ mergeParams: true });

/** المدى الافتراضي: الشهر الحالي حتى اليوم */
const rangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() })
  .refine((q) => !q.from || !q.to || q.to >= q.from, { message: 'النهاية قبل البداية', path: ['to'] });

const withDefaults = (property, query) => {
  const today = todayIn(property.timezone);
  return { from: query.from ?? startOfMonth(today), to: query.to ?? today };
};

router.get('/today', requirePermission('reservations.read'),
  asyncHandler(async (req, res) => ok(res, await reports.today(req.property))));

router.get('/occupancy', requirePermission('reports.read'), validate({ query: rangeQuery }),
  asyncHandler(async (req, res) => ok(res, await reports.occupancy(req.property, withDefaults(req.property, req.query)))));

router.get('/revenue', requirePermission('reports.read'), validate({ query: rangeQuery }),
  asyncHandler(async (req, res) => ok(res, await reports.revenue(req.property, withDefaults(req.property, req.query)))));

router.get('/forecast', requirePermission('reports.read'),
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(120).default(30) }) }),
  asyncHandler(async (req, res) => ok(res, await reports.forecast(req.property, { days: req.query.days }))));

/** التصدير: ملفات حسّاسة (أسماء وهواتف) فنسجّل مَن صدّر */
function csvRoute(name, build) {
  router.get(`/export/${name}.csv`, requirePermission('reports.read'), validate({ query: rangeQuery }),
    asyncHandler(async (req, res) => {
      const range = withDefaults(req.property, req.query);
      const body = await build(req.property, range);
      await audit(req, { action: `report.export_${name}`, entity: 'report', after: range });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}-${range.from}_${range.to}.csv"`);
      res.send(body);
    }));
}
csvRoute('reservations', (property, range) => reports.reservationsCsv(property, range));
csvRoute('payments', (property, range) => reports.paymentsCsv(property, range));

export default router;

