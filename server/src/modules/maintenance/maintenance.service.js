/**
 * طلبات الصيانة: عطل في غرفة أو مرفق، من الإبلاغ إلى الإصلاح، مع صور وتكلفة.
 * عند الإبلاغ يمكن حجب الغرفة عن البيع لمدة (block_unit) كي لا تُباع وفيها عطل.
 */
import { z } from 'zod';
import { query, queryOne, execute, transaction, isDuplicate } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { eachNight } from '../../utils/dates.js';
import { idSchema, isoDate, minorAmount, optionalText } from '../../utils/schemas.js';
import { notifyStaff } from '../../services/notifications/staff.js';
import { enqueuePush } from '../../services/notifications/outbox.js';
import { describeConflicts } from '../reservations/stay.js';

export const createRequestSchema = z.object({
  unit_id: idSchema.nullish(),
  title: z.string().trim().min(3).max(190),
  description: optionalText(3000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  assigned_to: idSchema.nullish(),
  /** حجب الغرفة عن البيع طوال فترة الإصلاح */
  block_unit: z.object({ start_date: isoDate, end_date: isoDate })
    .refine((b) => b.end_date > b.start_date, 'النهاية بعد البداية').optional(),
});

export const updateRequestSchema = z.object({
  title: z.string().trim().min(3).max(190),
  description: optionalText(3000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  status: z.enum(['open', 'in_progress', 'waiting_parts', 'resolved', 'cancelled']),
  assigned_to: idSchema.nullable(),
  cost_minor: minorAmount.nullable(),
}).partial();

export const listRequestsQuery = z.object({
  status: z.enum(['open', 'in_progress', 'waiting_parts', 'resolved', 'cancelled']).optional(),
  open: z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1').optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  unit_id: idSchema.optional(),
  mine: z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1').optional(),
});

const REQUEST_SQL = `SELECT m.*, u.code AS unit_code, rb.full_name AS reported_by_name, a.full_name AS assigned_name
    FROM maintenance_requests m
    LEFT JOIN units u ON u.id = m.unit_id
    LEFT JOIN users rb ON rb.id = m.reported_by
    LEFT JOIN users a ON a.id = m.assigned_to`;

const PRIORITY_ORDER = "FIELD(m.priority, 'urgent', 'high', 'normal', 'low')";

export const maintenance = {
  list(propertyId, filters, user) {
    const where = ['m.property_id = ?'];
    const params = [propertyId];
    if (filters.status) { where.push('m.status = ?'); params.push(filters.status); }
    if (filters.open) where.push("m.status IN ('open','in_progress','waiting_parts')");
    if (filters.priority) { where.push('m.priority = ?'); params.push(filters.priority); }
    if (filters.unit_id) { where.push('m.unit_id = ?'); params.push(filters.unit_id); }
    if (filters.mine) { where.push('(m.assigned_to = ? OR m.reported_by = ?)'); params.push(user.id, user.id); }
    return query(`${REQUEST_SQL} WHERE ${where.join(' AND ')} ORDER BY ${PRIORITY_ORDER}, m.created_at DESC LIMIT 300`, params);
  },

  async find(propertyId, id, executor = { queryOne }) {
    const row = await executor.queryOne(`${REQUEST_SQL} WHERE m.id = ? AND m.property_id = ?`, [id, propertyId]);
    if (!row) throw ApiError.notFound('طلب الصيانة غير موجود');
    return row;
  },

  async create(property, input, user) {
    let unit = null;
    if (input.unit_id) {
      unit = await queryOne(
        "SELECT id, code FROM units WHERE id = ? AND property_id = ? AND deleted_at IS NULL AND status <> 'archived'",
        [input.unit_id, property.id],
      );
      if (!unit) throw ApiError.badRequest('الوحدة غير موجودة', { code: 'BAD_UNIT', details: { unit_id: 'غير موجودة' } });
    }
    if (input.block_unit && !unit) {
      throw ApiError.badRequest('حدّد الوحدة لحجبها', { code: 'VALIDATION_ERROR', details: { unit_id: 'مطلوبة للحجب' } });
    }

    try {
      const id = await transaction(async (tx) => {
        const result = await tx.execute(
          `INSERT INTO maintenance_requests (property_id, unit_id, title, description, priority, assigned_to, reported_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [property.id, unit?.id ?? null, input.title, input.description ?? null, input.priority, input.assigned_to ?? null, user.id],
        );

        if (input.block_unit) {
          const block = await tx.execute(
            `INSERT INTO unit_blocks (property_id, unit_id, start_date, end_date, reason, note, created_by)
             VALUES (?, ?, ?, ?, 'maintenance', ?, ?)`,
            [property.id, unit.id, input.block_unit.start_date, input.block_unit.end_date, input.title, user.id],
          );
          const nights = eachNight(input.block_unit.start_date, input.block_unit.end_date);
          await tx.execute(
            `INSERT INTO unit_nights (unit_id, night, block_id) VALUES ${nights.map(() => '(?,?,?)').join(',')}`,
            nights.flatMap((night) => [unit.id, night, block.insertId]),
          );
        }

        if (input.assigned_to) {
          await enqueuePush({
            propertyId: property.id, userId: input.assigned_to,
            payload: { title: 'طلب صيانة جديد', body: input.title, url: '/maintenance' },
          }, tx);
        }
        if (['high', 'urgent'].includes(input.priority)) {
          await notifyStaff(property, {
            roles: ['manager'], excludeUserId: user.id,
            payload: { title: input.priority === 'urgent' ? 'عطل عاجل' : 'عطل مهم', body: `${unit ? `${unit.code} — ` : ''}${input.title}`, url: '/maintenance' },
          }, tx);
        }
        return result.insertId;
      });
      return this.find(property.id, id);
    } catch (error) {
      if (isDuplicate(error)) {
        throw ApiError.conflict('الوحدة مشغولة في بعض ليالي فترة الحجب', {
          code: 'NIGHTS_OCCUPIED',
          details: { occupied: await describeConflicts({ query }, unit.id, input.block_unit.start_date, input.block_unit.end_date) },
        });
      }
      throw error;
    }
  },

  async update(property, id, input, user) {
    const before = await this.find(property.id, id);
    if (input.assigned_to) {
      const assignee = await queryOne(
        "SELECT id FROM users WHERE id = ? AND organization_id = ? AND status = 'active' AND deleted_at IS NULL",
        [input.assigned_to, property.organization_id],
      );
      if (!assignee) throw ApiError.badRequest('الموظف غير موجود', { code: 'BAD_ASSIGNEE', details: { assigned_to: 'غير موجود' } });
    }

    const fields = ['title', 'description', 'priority', 'status', 'assigned_to', 'cost_minor'].filter((f) => input[f] !== undefined);
    if (fields.length > 0) {
      const sets = fields.map((f) => `${f} = ?`);
      const params = fields.map((f) => input[f]);
      if (input.status === 'resolved') sets.push('resolved_at = NOW()');
      else if (input.status && input.status !== 'resolved') sets.push('resolved_at = NULL');
      await execute(`UPDATE maintenance_requests SET ${sets.join(', ')} WHERE id = ? AND property_id = ?`, [...params, id, property.id]);
    }

    if (input.assigned_to && input.assigned_to !== before.assigned_to && input.assigned_to !== user.id) {
      await enqueuePush({
        propertyId: property.id, userId: input.assigned_to,
        payload: { title: 'طلب صيانة مُسنَد لك', body: before.title, url: '/maintenance' },
      });
    }
    return { before, after: await this.find(property.id, id) };
  },
};
