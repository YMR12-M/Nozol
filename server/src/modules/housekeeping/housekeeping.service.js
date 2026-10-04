/**
 * ═══════════════════════════════════════════════════════════════
 *  التنظيف والتجهيز
 *
 *  دورة المهمة:  pending ─start→ in_progress ─complete→ done ─verify→ verified
 *  وتتبعها حالة الغرفة:  dirty → cleaning → clean → inspected
 *
 *  المهام تُولَّد تلقائيًّا عند الخروج (checkout_clean)، ويدويًّا من المشرف،
 *  أو بضغطة «ولّد مهام اليوم» لتنظيف الغرف المقيمة (stayover).
 *  عامل التنظيف لا يرى ولا يغيّر إلا مهامه أو غير المُسنَدة.
 * ═══════════════════════════════════════════════════════════════
 */
import { query, queryOne, execute, transaction } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { todayIn } from '../../utils/dates.js';
import { enqueuePush } from '../../services/notifications/outbox.js';

const TASK_SQL = `SELECT t.*, u.code AS unit_code, u.housekeeping_status, ut.name_ar AS unit_type_name_ar,
         a.full_name AS assigned_name, r.code AS reservation_code
    FROM housekeeping_tasks t
    JOIN units u ON u.id = t.unit_id
    JOIN unit_types ut ON ut.id = u.unit_type_id
    LEFT JOIN users a ON a.id = t.assigned_to
    LEFT JOIN reservations r ON r.id = t.reservation_id`;

const PRIORITY_ORDER = "FIELD(t.priority, 'urgent', 'high', 'normal')";

async function findTask(propertyId, id, executor = { queryOne }) {
  const task = await executor.queryOne(`${TASK_SQL} WHERE t.id = ? AND t.property_id = ?`, [id, propertyId]);
  if (!task) throw ApiError.notFound('المهمة غير موجودة');
  return task;
}

/** عامل التنظيف: مهامه أو غير المُسنَدة فقط */
function assertCanWork(task, user) {
  if (user.role === 'housekeeping' && task.assigned_to && task.assigned_to !== user.id) {
    throw ApiError.forbidden('المهمة دي مُسنَدة لموظف تاني', { code: 'NOT_YOUR_TASK' });
  }
}

async function assertAssignee(property, userId) {
  if (!userId) return;
  const user = await queryOne(
    `SELECT u.id FROM users u WHERE u.id = ? AND u.organization_id = ? AND u.status = 'active' AND u.deleted_at IS NULL
        AND (u.role = 'owner' OR EXISTS (SELECT 1 FROM user_properties up WHERE up.user_id = u.id AND up.property_id = ?))`,
    [userId, property.organization_id, property.id],
  );
  if (!user) throw ApiError.badRequest('الموظف غير موجود أو ليس له وصول للمنشأة', { code: 'BAD_ASSIGNEE', details: { assigned_to: 'غير صالح' } });
}

export const housekeeping = {
  async list(property, filters, user) {
    const where = ['t.property_id = ?'];
    const params = [property.id];
    const today = todayIn(property.timezone);

    if (filters.date) { where.push('t.due_date = ?'); params.push(filters.date); }
    if (filters.from) { where.push('t.due_date >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('t.due_date <= ?'); params.push(filters.to); }
    if (!filters.date && !filters.from && !filters.to && !filters.open) { where.push('t.due_date = ?'); params.push(today); }
    if (filters.open) where.push("t.status IN ('pending','in_progress')");
    if (filters.status) { where.push('t.status = ?'); params.push(filters.status); }
    if (filters.unit_id) { where.push('t.unit_id = ?'); params.push(filters.unit_id); }
    if (filters.assigned_to) { where.push('t.assigned_to = ?'); params.push(filters.assigned_to); }
    if (filters.mine || user.role === 'housekeeping') {
      // عامل التنظيف يرى مهامه + غير المُسنَدة (ليأخذها)
      where.push('(t.assigned_to = ? OR t.assigned_to IS NULL)');
      params.push(user.id);
    }

    return query(`${TASK_SQL} WHERE ${where.join(' AND ')} ORDER BY ${PRIORITY_ORDER}, t.status, u.code`, params);
  },

  /**
   * لوحة الغرف اليوم: كل وحدة بحالة تنظيفها وحالة إشغالها الآن
   * (مقيم · يغادر اليوم · يصل اليوم · فاضية) ومهامها المفتوحة.
   */
  async board(property) {
    const today = todayIn(property.timezone);
    const units = await query(
      `SELECT u.id, u.code, u.floor, u.status, u.housekeeping_status, u.housekeeping_updated_at,
              ut.name_ar AS unit_type_name_ar, ut.sort_order AS type_order
         FROM units u JOIN unit_types ut ON ut.id = u.unit_type_id
        WHERE u.property_id = ? AND u.deleted_at IS NULL AND u.status <> 'archived'
        ORDER BY ut.sort_order, u.sort_order, u.code`,
      [property.id],
    );
    const stays = await query(
      `SELECT ru.unit_id, ru.check_in, ru.check_out, r.status, r.code, g.full_name AS guest_name
         FROM reservation_units ru
         JOIN reservations r ON r.id = ru.reservation_id
         JOIN guests g ON g.id = r.guest_id
        WHERE r.property_id = ? AND r.status IN ('confirmed','checked_in')
          AND ru.check_in <= ? AND ru.check_out >= ?`,
      [property.id, today, today],
    );
    const tasks = await query(
      `SELECT id, unit_id, type, status, priority, assigned_to FROM housekeeping_tasks
        WHERE property_id = ? AND status IN ('pending','in_progress') AND due_date <= ?`,
      [property.id, today],
    );

    return units.map((unit) => {
      const here = stays.filter((s) => s.unit_id === unit.id);
      const inHouse = here.find((s) => s.status === 'checked_in' && s.check_in <= today && s.check_out > today);
      const departing = here.find((s) => s.status === 'checked_in' && s.check_out === today);
      const arriving = here.find((s) => s.status === 'confirmed' && s.check_in === today);
      let occupancy = 'vacant';
      if (departing) occupancy = 'departing';
      else if (inHouse) occupancy = 'occupied';
      else if (arriving) occupancy = 'arriving';
      const guest = (departing ?? inHouse ?? arriving);

      return {
        ...unit,
        occupancy,
        guest_name: guest?.guest_name ?? null,
        reservation_code: guest?.code ?? null,
        open_tasks: tasks.filter((task) => task.unit_id === unit.id),
      };
    });
  },

  async create(property, input, user) {
    const unit = await queryOne(
      "SELECT id, code FROM units WHERE id = ? AND property_id = ? AND deleted_at IS NULL AND status <> 'archived'",
      [input.unit_id, property.id],
    );
    if (!unit) throw ApiError.badRequest('الوحدة غير موجودة', { code: 'BAD_UNIT', details: { unit_id: 'غير موجودة' } });
    await assertAssignee(property, input.assigned_to);

    const result = await execute(
      `INSERT INTO housekeeping_tasks (property_id, unit_id, type, priority, due_date, assigned_to, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [property.id, unit.id, input.type, input.priority, input.due_date ?? todayIn(property.timezone),
        input.assigned_to ?? null, input.note ?? null, user.id],
    );
    if (input.assigned_to) {
      await enqueuePush({
        propertyId: property.id, userId: input.assigned_to,
        payload: { title: 'مهمة تنظيف جديدة', body: `الوحدة ${unit.code}`, url: '/housekeeping' },
      });
    }
    return findTask(property.id, result.insertId);
  },

  async update(property, id, input) {
    const task = await findTask(property.id, id);
    if (input.assigned_to) await assertAssignee(property, input.assigned_to);

    const fields = ['priority', 'due_date', 'assigned_to', 'note'].filter((f) => input[f] !== undefined);
    if (fields.length > 0) {
      await execute(
        `UPDATE housekeeping_tasks SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ? AND property_id = ?`,
        [...fields.map((f) => input[f]), id, property.id],
      );
    }
    if (input.assigned_to && input.assigned_to !== task.assigned_to) {
      await enqueuePush({
        propertyId: property.id, userId: input.assigned_to,
        payload: { title: 'مهمة تنظيف جديدة', body: `الوحدة ${task.unit_code}`, url: '/housekeeping' },
      });
    }
    return { before: task, after: await findTask(property.id, id) };
  },

  async start(property, id, user) {
    return transaction(async (tx) => {
      const task = await findTask(property.id, id, tx);
      assertCanWork(task, user);
      if (task.status !== 'pending') throw ApiError.conflict('المهمة دي بدأت أو خلصت بالفعل', { code: 'BAD_STATUS' });

      await tx.execute(
        `UPDATE housekeeping_tasks SET status = 'in_progress', started_at = NOW(), assigned_to = COALESCE(assigned_to, ?) WHERE id = ?`,
        [user.id, id],
      );
      await tx.execute("UPDATE units SET housekeeping_status = 'cleaning', housekeeping_updated_at = NOW() WHERE id = ?", [task.unit_id]);
      return findTask(property.id, id, tx);
    });
  },

  async complete(property, id, input, user) {
    return transaction(async (tx) => {
      const task = await findTask(property.id, id, tx);
      assertCanWork(task, user);
      if (!['pending', 'in_progress'].includes(task.status)) {
        throw ApiError.conflict('المهمة دي خلصت بالفعل', { code: 'BAD_STATUS' });
      }
      await tx.execute(
        `UPDATE housekeeping_tasks SET status = 'done', completed_at = NOW(), started_at = COALESCE(started_at, NOW()),
                assigned_to = COALESCE(assigned_to, ?), note = COALESCE(?, note) WHERE id = ?`,
        [user.id, input.note ?? null, id],
      );
      // نخفض حالة الغرفة إلى «نظيفة» لكن لا نتجاوز «تم الفحص» لو سبقتها
      await tx.execute(
        `UPDATE units SET housekeeping_status = 'clean', housekeeping_updated_at = NOW()
          WHERE id = ? AND housekeeping_status <> 'inspected'`,
        [task.unit_id],
      );
      return findTask(property.id, id, tx);
    });
  },

  async verify(property, id, user) {
    return transaction(async (tx) => {
      const task = await findTask(property.id, id, tx);
      if (task.status !== 'done') throw ApiError.conflict('الفحص بعد إنهاء التنظيف', { code: 'BAD_STATUS' });
      await tx.execute(
        "UPDATE housekeeping_tasks SET status = 'verified', verified_by = ?, verified_at = NOW() WHERE id = ?",
        [user.id, id],
      );
      await tx.execute("UPDATE units SET housekeeping_status = 'inspected', housekeeping_updated_at = NOW() WHERE id = ?", [task.unit_id]);
      return findTask(property.id, id, tx);
    });
  },

  async skip(property, id) {
    const task = await findTask(property.id, id);
    if (!['pending', 'in_progress'].includes(task.status)) throw ApiError.conflict('المهمة دي خلصت بالفعل', { code: 'BAD_STATUS' });
    await execute("UPDATE housekeeping_tasks SET status = 'skipped' WHERE id = ?", [id]);
    return findTask(property.id, id);
  },

  /** مهام «تنظيف الإقامة» لكل غرفة مقيمة لا مهمة لها اليوم (آمن للتكرار) */
  async generateStayovers(property, date, user) {
    const day = date ?? todayIn(property.timezone);

    const inHouse = await query(
      `SELECT DISTINCT ru.unit_id, r.id AS reservation_id
         FROM reservation_units ru JOIN reservations r ON r.id = ru.reservation_id
        WHERE r.property_id = ? AND r.status = 'checked_in' AND ru.check_in <= ? AND ru.check_out > ?
          AND NOT EXISTS (SELECT 1 FROM housekeeping_tasks t WHERE t.unit_id = ru.unit_id AND t.due_date = ?
                          AND t.status <> 'skipped')`,
      [property.id, day, day, day],
    );
    for (const row of inHouse) {
      await execute(
        `INSERT INTO housekeeping_tasks (property_id, unit_id, reservation_id, type, due_date, created_by)
         VALUES (?, ?, ?, 'stayover_clean', ?, ?)`,
        [property.id, row.unit_id, row.reservation_id, day, user.id],
      );
    }
    return inHouse.length;
  },

  /** الموظفون الذين يمكن إسناد مهام لهم في هذه المنشأة */
  assignees: (property) => query(
    `SELECT u.id, u.full_name, u.role FROM users u
      WHERE u.organization_id = ? AND u.status = 'active' AND u.deleted_at IS NULL
        AND u.role IN ('owner','manager','front_desk','housekeeping')
        AND (u.role = 'owner' OR EXISTS (SELECT 1 FROM user_properties up WHERE up.user_id = u.id AND up.property_id = ?))
      ORDER BY u.role = 'housekeeping' DESC, u.full_name`,
    [property.organization_id, property.id],
  ),
};
