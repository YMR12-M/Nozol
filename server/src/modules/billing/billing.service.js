/**
 * ═══════════════════════════════════════════════════════════════
 *  الفوترة: بنود الفاتورة، المدفوعات، الورديات النقدية، الفواتير، المصروفات
 *
 *  مبادئ:
 *   • لا حذف للفلوس أبدًا: البند أو الدفعة تُلغى (voided) بسبب مكتوب ومَن ألغى،
 *     فيبقى أثرها للتدقيق ولا يتغيّر رصيد وردية أُغلقت.
 *   • كل تغيير مالي داخل معاملة تقفل صفّ الحجز ثم تعيد الحساب (recalculate).
 *   • الدفعة النقدية تُربَط بوردية الموظف المفتوحة تلقائيًّا، فيُحاسَب كل موظف
 *     على ما استلمه وحده.
 * ═══════════════════════════════════════════════════════════════
 */
import { query, queryOne, execute, transaction, safeInt } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { todayIn } from '../../utils/dates.js';
import { nextCounter, formatSequence } from '../../utils/counters.js';
import { pageMeta } from '../../utils/response.js';
import { recalculateReservation } from './totals.js';

/* ── أدوات داخلية ─────────────────────────────────────────── */

async function lockReservation(tx, propertyId, reservationId) {
  const reservation = await tx.queryOne(
    'SELECT * FROM reservations WHERE id = ? AND property_id = ? FOR UPDATE',
    [reservationId, propertyId],
  );
  if (!reservation) throw ApiError.notFound('الحجز غير موجود');
  return reservation;
}

const openShiftOf = (tx, propertyId, userId) => tx.queryOne(
  'SELECT id FROM cash_shifts WHERE property_id = ? AND user_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1',
  [propertyId, userId],
);

/* ═══════════════ بنود الفاتورة ═══════════════ */

export const folio = {
  list: (reservationId) => query(
    `SELECT f.*, u.full_name AS posted_by_name FROM folio_items f
       LEFT JOIN users u ON u.id = f.posted_by
      WHERE f.reservation_id = ? ORDER BY f.id`,
    [reservationId],
  ),

  /** يضيف بندًا ويعيد الحساب. `input.kind`: service | charge | discount | fee */
  async add(property, reservationId, input, user) {
    return transaction(async (tx) => {
      const reservation = await lockReservation(tx, property.id, reservationId);
      if (reservation.status === 'cancelled' && input.kind !== 'fee') {
        throw ApiError.conflict('الحجز ملغي — مينفعش تضيف بنود', { code: 'RESERVATION_CANCELLED' });
      }

      let row;
      if (input.kind === 'service') {
        const service = await tx.queryOne(
          'SELECT * FROM services WHERE id = ? AND property_id = ? AND is_active = 1',
          [input.service_id, property.id],
        );
        if (!service) throw ApiError.badRequest('الخدمة غير متاحة', { code: 'BAD_SERVICE', details: { service_id: 'غير متاحة' } });
        row = {
          type: 'service', service_id: service.id,
          description: input.description || service.name_ar,
          quantity: input.quantity, unit_price_minor: service.price_minor,
          amount_minor: Math.round(service.price_minor * input.quantity),
          taxable: service.taxable, service_chargeable: service.service_chargeable,
        };
      } else if (input.kind === 'charge') {
        row = {
          type: 'charge', service_id: null, description: input.description,
          quantity: input.quantity, unit_price_minor: input.unit_price_minor,
          amount_minor: Math.round(input.unit_price_minor * input.quantity),
          taxable: input.taxable, service_chargeable: input.service_chargeable,
        };
      } else if (input.kind === 'discount') {
        row = {
          type: 'discount', service_id: null, description: input.description,
          quantity: 1, unit_price_minor: -input.amount_minor, amount_minor: -input.amount_minor,
          taxable: true, service_chargeable: true,
        };
      } else {
        row = {
          type: 'fee', service_id: null, description: input.description,
          quantity: 1, unit_price_minor: input.amount_minor, amount_minor: input.amount_minor,
          taxable: input.taxable, service_chargeable: input.service_chargeable,
        };
      }

      const result = await tx.execute(
        `INSERT INTO folio_items
           (property_id, reservation_id, type, service_id, description, quantity, unit_price_minor, amount_minor,
            taxable, service_chargeable, posted_on, posted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [property.id, reservationId, row.type, row.service_id, row.description, row.quantity, row.unit_price_minor,
          row.amount_minor, row.taxable, row.service_chargeable, todayIn(property.timezone), user.id],
      );
      const totals = await recalculateReservation(tx, reservationId);
      return { item: await tx.queryOne('SELECT * FROM folio_items WHERE id = ?', [result.insertId]), totals };
    });
  },

  async void(property, reservationId, itemId, reason, user) {
    return transaction(async (tx) => {
      await lockReservation(tx, property.id, reservationId);
      const item = await tx.queryOne(
        'SELECT * FROM folio_items WHERE id = ? AND reservation_id = ? AND property_id = ?',
        [itemId, reservationId, property.id],
      );
      if (!item) throw ApiError.notFound('البند غير موجود');
      if (item.voided_at) throw ApiError.conflict('البند ده ملغي بالفعل', { code: 'ALREADY_VOIDED' });

      await tx.execute(
        'UPDATE folio_items SET voided_at = NOW(), voided_by = ?, void_reason = ? WHERE id = ?',
        [user.id, reason, itemId],
      );
      return { item, totals: await recalculateReservation(tx, reservationId) };
    });
  },
};

/* ═══════════════ المدفوعات ═══════════════ */

/**
 * يسجّل دفعة أو مرتجعًا داخل معاملة قائمة (`tx`) — يُستدعى أيضًا من إنشاء الحجز.
 * لا مرتجع أكبر من صافي المدفوع، فلا يخرج من الصندوق ما لم يدخله.
 */
export async function recordPayment(tx, { property, reservationId, user, input }) {
  const reservation = await lockReservation(tx, property.id, reservationId);

  if (input.type === 'refund' && input.amount_minor > reservation.paid_minor) {
    throw ApiError.unprocessable('المرتجع أكبر من المدفوع فعلًا', {
      code: 'REFUND_EXCEEDS_PAID',
      details: { amount_minor: `المدفوع ${reservation.paid_minor / 100}` },
    });
  }

  const shift = await openShiftOf(tx, property.id, user.id);
  const result = await tx.execute(
    `INSERT INTO payments (property_id, reservation_id, type, method, amount_minor, reference, note, received_by, shift_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [property.id, reservationId, input.type, input.method, input.amount_minor,
      input.reference ?? null, input.note ?? null, user.id, shift?.id ?? null],
  );
  const totals = await recalculateReservation(tx, reservationId);
  return { payment: await tx.queryOne('SELECT * FROM payments WHERE id = ?', [result.insertId]), totals };
}

export const payments = {
  add: (property, reservationId, input, user) =>
    transaction((tx) => recordPayment(tx, { property, reservationId, user, input })),

  list: (reservationId) => query(
    `SELECT p.*, u.full_name AS received_by_name FROM payments p
       LEFT JOIN users u ON u.id = p.received_by
      WHERE p.reservation_id = ? ORDER BY p.received_at, p.id`,
    [reservationId],
  ),

  async void(property, reservationId, paymentId, reason, user) {
    return transaction(async (tx) => {
      await lockReservation(tx, property.id, reservationId);
      const payment = await tx.queryOne(
        'SELECT * FROM payments WHERE id = ? AND reservation_id = ? AND property_id = ?',
        [paymentId, reservationId, property.id],
      );
      if (!payment) throw ApiError.notFound('الدفعة غير موجودة');
      if (payment.voided_at) throw ApiError.conflict('الدفعة دي ملغاة بالفعل', { code: 'ALREADY_VOIDED' });

      // لا نلغي دفعة وردية مُغلقة: رصيدها اتسلّم وتحاسب عليه — التصحيح يكون بمرتجع
      if (payment.shift_id) {
        const shift = await tx.queryOne('SELECT closed_at FROM cash_shifts WHERE id = ?', [payment.shift_id]);
        if (shift?.closed_at) {
          throw ApiError.conflict('الدفعة دي في وردية اتقفلت — صحّحها بمرتجع', { code: 'SHIFT_CLOSED' });
        }
      }

      await tx.execute(
        'UPDATE payments SET voided_at = NOW(), voided_by = ?, void_reason = ? WHERE id = ?',
        [user.id, reason, paymentId],
      );
      return { payment, totals: await recalculateReservation(tx, reservationId) };
    });
  },

  async listAll(propertyId, { page, page_size: pageSize, from, to, method, shift_id: shiftId }) {
    const where = ['p.property_id = ?', 'p.voided_at IS NULL'];
    const params = [propertyId];
    if (from) { where.push('DATE(p.received_at) >= ?'); params.push(from); }
    if (to) { where.push('DATE(p.received_at) <= ?'); params.push(to); }
    if (method) { where.push('p.method = ?'); params.push(method); }
    if (shiftId) { where.push('p.shift_id = ?'); params.push(shiftId); }

    const total = (await queryOne(`SELECT COUNT(*) AS n FROM payments p WHERE ${where.join(' AND ')}`, params)).n;
    const rows = await query(
      `SELECT p.*, r.code AS reservation_code, g.full_name AS guest_name, u.full_name AS received_by_name
         FROM payments p
         JOIN reservations r ON r.id = p.reservation_id
         JOIN guests g ON g.id = r.guest_id
         LEFT JOIN users u ON u.id = p.received_by
        WHERE ${where.join(' AND ')} ORDER BY p.received_at DESC, p.id DESC
        LIMIT ${safeInt(pageSize, { min: 1, max: 100, fallback: 25 })} OFFSET ${safeInt((page - 1) * pageSize)}`,
      params,
    );
    return { rows, meta: pageMeta(page, pageSize, total) };
  },
};

/* ═══════════════ الورديات النقدية ═══════════════ */

/** نقد الوردية = العهدة + دفعات نقدية − مرتجعات نقدية − مصروفات نقدية */
async function shiftTotals(executor, shift) {
  const cash = await executor.queryOne(
    `SELECT COALESCE(SUM(CASE WHEN type = 'payment' THEN amount_minor ELSE -amount_minor END), 0) AS net
       FROM payments WHERE shift_id = ? AND method = 'cash' AND voided_at IS NULL`,
    [shift.id],
  );
  const expenses = await executor.queryOne(
    "SELECT COALESCE(SUM(amount_minor), 0) AS total FROM expenses WHERE shift_id = ? AND method = 'cash' AND voided_at IS NULL",
    [shift.id],
  );
  const byMethod = await executor.query(
    `SELECT method, SUM(CASE WHEN type = 'payment' THEN amount_minor ELSE -amount_minor END) AS net
       FROM payments WHERE shift_id = ? AND voided_at IS NULL GROUP BY method`,
    [shift.id],
  );
  return {
    cash_in_minor: Number(cash.net),
    cash_expenses_minor: Number(expenses.total),
    expected_cash_minor: shift.opening_float_minor + Number(cash.net) - Number(expenses.total),
    by_method: byMethod.map((row) => ({ method: row.method, net_minor: Number(row.net) })),
  };
}

export const shifts = {
  /** وردية الموظف المفتوحة (أو null) مع الأرقام الحالية */
  async current(propertyId, userId) {
    const shift = await queryOne(
      'SELECT * FROM cash_shifts WHERE property_id = ? AND user_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1',
      [propertyId, userId],
    );
    if (!shift) return null;
    return { ...shift, ...(await shiftTotals({ query, queryOne }, shift)) };
  },

  async open(propertyId, userId, openingFloatMinor) {
    return transaction(async (tx) => {
      if (await openShiftOf(tx, propertyId, userId)) {
        throw ApiError.conflict('عندك وردية مفتوحة بالفعل — اقفلها الأول', { code: 'SHIFT_ALREADY_OPEN' });
      }
      const result = await tx.execute(
        'INSERT INTO cash_shifts (property_id, user_id, opening_float_minor) VALUES (?, ?, ?)',
        [propertyId, userId, openingFloatMinor],
      );
      return tx.queryOne('SELECT * FROM cash_shifts WHERE id = ?', [result.insertId]);
    });
  },

  async close(propertyId, userId, { counted_cash_minor: counted, note }) {
    return transaction(async (tx) => {
      const shift = await tx.queryOne(
        'SELECT * FROM cash_shifts WHERE property_id = ? AND user_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [propertyId, userId],
      );
      if (!shift) throw ApiError.conflict('مفيش وردية مفتوحة عندك', { code: 'NO_OPEN_SHIFT' });

      const totals = await shiftTotals(tx, shift);
      const difference = counted - totals.expected_cash_minor;
      await tx.execute(
        `UPDATE cash_shifts SET closed_at = NOW(), counted_cash_minor = ?, expected_cash_minor = ?, difference_minor = ?, note = ?
          WHERE id = ?`,
        [counted, totals.expected_cash_minor, difference, note ?? null, shift.id],
      );
      return { ...(await tx.queryOne('SELECT * FROM cash_shifts WHERE id = ?', [shift.id])), ...totals };
    });
  },

  async list(propertyId, { page, page_size: pageSize, user_id: userId }) {
    const where = ['s.property_id = ?'];
    const params = [propertyId];
    if (userId) { where.push('s.user_id = ?'); params.push(userId); }
    const total = (await queryOne(`SELECT COUNT(*) AS n FROM cash_shifts s WHERE ${where.join(' AND ')}`, params)).n;
    const rows = await query(
      `SELECT s.*, u.full_name AS user_name FROM cash_shifts s JOIN users u ON u.id = s.user_id
        WHERE ${where.join(' AND ')} ORDER BY s.opened_at DESC
        LIMIT ${safeInt(pageSize, { min: 1, max: 100, fallback: 25 })} OFFSET ${safeInt((page - 1) * pageSize)}`,
      params,
    );
    return { rows, meta: pageMeta(page, pageSize, total) };
  },

  async get(propertyId, id) {
    const shift = await queryOne(
      'SELECT s.*, u.full_name AS user_name FROM cash_shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.property_id = ?',
      [id, propertyId],
    );
    if (!shift) throw ApiError.notFound('الوردية غير موجودة');
    return { ...shift, ...(await shiftTotals({ query, queryOne }, shift)) };
  },
};

/* ═══════════════ المصروفات ═══════════════ */

export const expenses = {
  async create(property, input, user) {
    return transaction(async (tx) => {
      const shift = input.method === 'cash' ? await openShiftOf(tx, property.id, user.id) : null;
      const result = await tx.execute(
        `INSERT INTO expenses (property_id, category, description, amount_minor, spent_on, method, shift_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [property.id, input.category, input.description, input.amount_minor, input.spent_on, input.method, shift?.id ?? null, user.id],
      );
      return tx.queryOne('SELECT * FROM expenses WHERE id = ?', [result.insertId]);
    });
  },

  async list(propertyId, { page, page_size: pageSize, from, to, category }) {
    const where = ['e.property_id = ?', 'e.voided_at IS NULL'];
    const params = [propertyId];
    if (from) { where.push('e.spent_on >= ?'); params.push(from); }
    if (to) { where.push('e.spent_on <= ?'); params.push(to); }
    if (category) { where.push('e.category = ?'); params.push(category); }

    const total = (await queryOne(`SELECT COUNT(*) AS n, COALESCE(SUM(e.amount_minor), 0) AS sum FROM expenses e WHERE ${where.join(' AND ')}`, params));
    const rows = await query(
      `SELECT e.*, u.full_name AS created_by_name FROM expenses e LEFT JOIN users u ON u.id = e.created_by
        WHERE ${where.join(' AND ')} ORDER BY e.spent_on DESC, e.id DESC
        LIMIT ${safeInt(pageSize, { min: 1, max: 100, fallback: 25 })} OFFSET ${safeInt((page - 1) * pageSize)}`,
      params,
    );
    return { rows, meta: { ...pageMeta(page, pageSize, total.n), sum_minor: Number(total.sum) } };
  },

  async void(propertyId, id, reason) {
    const expense = await queryOne('SELECT * FROM expenses WHERE id = ? AND property_id = ?', [id, propertyId]);
    if (!expense) throw ApiError.notFound('المصروف غير موجود');
    if (expense.voided_at) throw ApiError.conflict('المصروف ده ملغي بالفعل', { code: 'ALREADY_VOIDED' });
    if (expense.shift_id) {
      const shift = await queryOne('SELECT closed_at FROM cash_shifts WHERE id = ?', [expense.shift_id]);
      if (shift?.closed_at) throw ApiError.conflict('المصروف ده في وردية اتقفلت', { code: 'SHIFT_CLOSED' });
    }
    await execute('UPDATE expenses SET voided_at = NOW(), void_reason = ? WHERE id = ?', [reason, id]);
    return expense;
  },
};

/* ═══════════════ الفواتير ═══════════════ */

export const invoices = {
  async list(propertyId, reservationId) {
    return query(
      `SELECT id, number, status, bill_to_name, total_minor, paid_minor, issued_at, voided_at
         FROM invoices WHERE property_id = ? AND reservation_id = ? ORDER BY id DESC`,
      [propertyId, reservationId],
    );
  },

  async get(propertyId, id) {
    const invoice = await queryOne('SELECT * FROM invoices WHERE id = ? AND property_id = ?', [id, propertyId]);
    if (!invoice) throw ApiError.notFound('الفاتورة غير موجودة');
    return { ...invoice, lines: typeof invoice.lines_json === 'string' ? JSON.parse(invoice.lines_json) : invoice.lines_json };
  },

  /** فاتورة واحدة سارية لكل حجز: لإعادة الإصدار بعد تعديل يلزم إلغاء السابقة أولًا */
  async issue(property, reservationId, input, user) {
    return transaction(async (tx) => {
      const reservation = await lockReservation(tx, property.id, reservationId);
      if (reservation.status === 'pending') {
        throw ApiError.conflict('أكّد الحجز قبل إصدار الفاتورة', { code: 'RESERVATION_PENDING' });
      }
      const existing = await tx.queryOne(
        "SELECT number FROM invoices WHERE reservation_id = ? AND status = 'issued'",
        [reservationId],
      );
      if (existing) {
        throw ApiError.conflict(`فيه فاتورة سارية (${existing.number}) — ألغِها الأول لو عايز تصدر جديدة`, { code: 'INVOICE_EXISTS' });
      }

      const totals = await recalculateReservation(tx, reservationId);
      const guest = await tx.queryOne('SELECT full_name FROM guests WHERE id = ?', [reservation.guest_id]);

      const lines = [];
      const segments = await tx.query(
        `SELECT ru.id, u.code AS unit_code, t.name_ar AS type_name
           FROM reservation_units ru JOIN units u ON u.id = ru.unit_id JOIN unit_types t ON t.id = ru.unit_type_id
          WHERE ru.reservation_id = ? ORDER BY ru.check_in, ru.id`,
        [reservationId],
      );
      if (reservation.status !== 'cancelled' && reservation.status !== 'no_show') {
        for (const segment of segments) {
          const nights = await tx.query(
            'SELECT night, room_minor, extra_guest_minor, meal_minor FROM reservation_nights WHERE reservation_unit_id = ? ORDER BY night',
            [segment.id],
          );
          const label = `${segment.type_name} — ${segment.unit_code}`;
          for (const [kind, column, title] of [
            ['room', 'room_minor', 'إقامة'], ['extra_guest', 'extra_guest_minor', 'أفراد إضافيون'], ['meal', 'meal_minor', 'وجبات'],
          ]) {
            let run = null;
            const flush = () => { if (run) lines.push({ kind, description: `${title}: ${label} (${run.from} ← ${run.to})`, quantity: run.qty, unit_minor: run.price, amount_minor: run.qty * run.price }); run = null; };
            for (const night of nights) {
              const price = night[column];
              if (price === 0) { flush(); continue; }
              if (run && run.price === price) { run.qty += 1; run.to = night.night; } else { flush(); run = { price, qty: 1, from: night.night, to: night.night }; }
            }
            flush();
          }
        }
      }
      const items = await tx.query(
        'SELECT type, description, quantity, unit_price_minor, amount_minor FROM folio_items WHERE reservation_id = ? AND voided_at IS NULL ORDER BY id',
        [reservationId],
      );
      for (const item of items) {
        lines.push({
          kind: item.type === 'discount' ? 'discount' : 'item', description: item.description,
          quantity: Number(item.quantity), unit_minor: item.unit_price_minor, amount_minor: item.amount_minor,
        });
      }
      if (totals.discount_minor > 0 && reservation.promo_code_id) {
        // الخصم الترويجي يظهر كسطر مستقل ما لم يكن بندًا يدويًّا
        const folioDiscounts = items.filter((item) => item.type === 'discount').reduce((sumValue, item) => sumValue - item.amount_minor, 0);
        const promoPart = totals.discount_minor - folioDiscounts;
        if (promoPart > 0) lines.push({ kind: 'discount', description: 'خصم ترويجي', quantity: 1, unit_minor: -promoPart, amount_minor: -promoPart });
      }

      const sequence = await nextCounter(tx, property.id, 'invoice');
      const number = formatSequence(property.invoice_prefix, sequence);
      const result = await tx.execute(
        `INSERT INTO invoices
           (property_id, reservation_id, number, bill_to_name, bill_to_tax_id, bill_to_address,
            subtotal_minor, discount_minor, service_charge_minor, tax_minor, city_fee_minor, total_minor, paid_minor,
            lines_json, issued_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [property.id, reservationId, number, input.bill_to_name || guest.full_name, input.bill_to_tax_id ?? null,
          input.bill_to_address ?? null, totals.subtotal_minor, totals.discount_minor, totals.service_charge_minor,
          totals.tax_minor, totals.city_fee_minor, totals.total_minor, totals.paid_minor, JSON.stringify(lines), user.id],
      );
      return tx.queryOne('SELECT * FROM invoices WHERE id = ?', [result.insertId]);
    });
  },

  async void(propertyId, id, reason) {
    const invoice = await queryOne('SELECT * FROM invoices WHERE id = ? AND property_id = ?', [id, propertyId]);
    if (!invoice) throw ApiError.notFound('الفاتورة غير موجودة');
    if (invoice.status === 'void') throw ApiError.conflict('الفاتورة ملغاة بالفعل', { code: 'ALREADY_VOIDED' });
    await execute("UPDATE invoices SET status = 'void', voided_at = NOW(), void_reason = ? WHERE id = ?", [reason, id]);
    return invoice;
  },
};

