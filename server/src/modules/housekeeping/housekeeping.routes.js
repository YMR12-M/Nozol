import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { idParams } from '../../utils/schemas.js';
import { housekeeping } from './housekeeping.service.js';
import {
  listTasksQuery, createTaskSchema, updateTaskSchema, completeTaskSchema, generateSchema,
} from './housekeeping.validation.js';

const router = Router({ mergeParams: true });
const withId = validate({ params: idParams('id') });

const brief = (task) => ({ unit_code: task.unit_code, type: task.type, status: task.status, assigned_to: task.assigned_to });

router.get('/board', requirePermission('housekeeping.read'),
  asyncHandler(async (req, res) => ok(res, await housekeeping.board(req.property))));

router.get('/assignees', requirePermission('housekeeping.read'),
  asyncHandler(async (req, res) => ok(res, await housekeeping.assignees(req.property))));

router.get('/tasks', requirePermission('housekeeping.read'), validate({ query: listTasksQuery }),
  asyncHandler(async (req, res) => ok(res, await housekeeping.list(req.property, req.query, req.user))));

router.post('/tasks', requirePermission('housekeeping.manage'), validate({ body: createTaskSchema }),
  asyncHandler(async (req, res) => {
    const task = await housekeeping.create(req.property, req.body, req.user);
    await audit(req, { action: 'housekeeping.create', entity: 'housekeeping_task', entityId: task.id, after: brief(task) });
    created(res, task);
  }));

router.patch('/tasks/:id', requirePermission('housekeeping.manage'), validate({ params: idParams('id'), body: updateTaskSchema }),
  asyncHandler(async (req, res) => {
    const { before, after } = await housekeeping.update(req.property, req.params.id, req.body);
    await audit(req, { action: 'housekeeping.update', entity: 'housekeeping_task', entityId: after.id, before: brief(before), after: brief(after) });
    ok(res, after);
  }));

router.post('/tasks/:id/start', requirePermission('housekeeping.write'), withId,
  asyncHandler(async (req, res) => ok(res, await housekeeping.start(req.property, req.params.id, req.user))));

router.post('/tasks/:id/complete', requirePermission('housekeeping.write'), validate({ params: idParams('id'), body: completeTaskSchema }),
  asyncHandler(async (req, res) => ok(res, await housekeeping.complete(req.property, req.params.id, req.body, req.user))));

router.post('/tasks/:id/verify', requirePermission('housekeeping.manage'), withId,
  asyncHandler(async (req, res) => {
    const task = await housekeeping.verify(req.property, req.params.id, req.user);
    await audit(req, { action: 'housekeeping.verify', entity: 'housekeeping_task', entityId: task.id, after: brief(task) });
    ok(res, task);
  }));

router.post('/tasks/:id/skip', requirePermission('housekeeping.manage'), withId,
  asyncHandler(async (req, res) => ok(res, await housekeeping.skip(req.property, req.params.id))));

router.post('/generate', requirePermission('housekeeping.manage'), validate({ body: generateSchema }),
  asyncHandler(async (req, res) => ok(res, { created: await housekeeping.generateStayovers(req.property, req.body.date, req.user) })));

export default router;
