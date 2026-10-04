import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { publicLimiter } from '../../middleware/rateLimiters.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { idParams } from '../../utils/schemas.js';
import { ical, createFeedSchema, updateFeedSchema } from './ical.service.js';

/** مسارات المنشأة (مصادَق عليها): /properties/:propertyId/ical/... */
const router = Router({ mergeParams: true });

router.get('/feeds', requirePermission('ical.manage'),
  asyncHandler(async (req, res) => ok(res, await ical.listFeeds(req.property.id))));

router.post('/feeds', requirePermission('ical.manage'), validate({ body: createFeedSchema }),
  asyncHandler(async (req, res) => {
    const feed = await ical.createFeed(req.property, req.body);
    await audit(req, { action: 'ical.feed_create', entity: 'ical_feed', entityId: feed.id, after: { name: feed.name, unit_id: feed.unit_id } });
    created(res, feed);
  }));

router.patch('/feeds/:id', requirePermission('ical.manage'), validate({ params: idParams('id'), body: updateFeedSchema }),
  asyncHandler(async (req, res) => {
    const { after } = await ical.updateFeed(req.property, req.params.id, req.body);
    ok(res, after);
  }));

router.delete('/feeds/:id', requirePermission('ical.manage'), validate({ params: idParams('id') }),
  asyncHandler(async (req, res) => {
    const feed = await ical.removeFeed(req.property, req.params.id);
    await audit(req, { action: 'ical.feed_delete', entity: 'ical_feed', entityId: feed.id, before: { name: feed.name } });
    noContent(res);
  }));

router.post('/feeds/:id/sync', requirePermission('ical.manage'), validate({ params: idParams('id') }),
  asyncHandler(async (req, res) => ok(res, await ical.syncNow(req.property, req.params.id))));

router.post('/units/:id/export-link', requirePermission('ical.manage'),
  validate({ params: idParams('id'), body: z.object({ rotate: z.boolean().default(false) }) }),
  asyncHandler(async (req, res) => {
    const link = await ical.exportLink(req.property, req.params.id, { rotate: req.body.rotate });
    if (req.body.rotate) await audit(req, { action: 'ical.export_rotate', entity: 'unit', entityId: Number(req.params.id) });
    ok(res, link);
  }));

export default router;

/** المسار العام: /api/v1/ical/:token.ics — التوكن هو السرّ */
export const publicIcalRouter = Router();

publicIcalRouter.get('/:file', publicLimiter, asyncHandler(async (req, res) => {
  const match = /^([A-Za-z0-9_-]{20,64})\.ics$/.exec(req.params.file);
  if (!match) return res.status(404).type('text/plain').send('Not found');
  const body = await ical.exportCalendar(match[1]);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Disposition', 'inline; filename="calendar.ics"');
  return res.send(body);
}));
