/**
 * إعادة حساب أرقام الحجز من مصادرها: أجزاء الإقامة + بنود الفاتورة + الخصم
 * + المدفوعات. تُستدعى بعد كل تغيير يمسّ المال (تعديل تواريخ، بند، دفعة، إلغاء)
 * وتكتب النتيجة في أعمدة الحجز، فتبقى القوائم والتقارير سريعة بلا حساب متكرّر.
 *
 * يجب أن تعمل داخل معاملة (`tx`)، ونقفل صفّ الحجز (FOR UPDATE) قبل القراءة
 * لنمنع دفعتين متزامنتين من كتابة رقم مدفوع واحد كلٌّ على حدة.
 */
import { diffDays } from '../../utils/dates.js';
import { sum } from '../../utils/money.js';
import { computeTotals, promoDiscount, reservationLines } from '../pricing/engine.js';

const INACTIVE = new Set(['cancelled', 'no_show']);

export async function recalculateReservation(tx, reservationId) {
  const reservation = await tx.queryOne(
    `SELECT r.id, r.status, r.promo_code_id,
            p.tax_bps, p.service_charge_bps, p.tax_on_service_charge, p.prices_include_tax, p.city_fee_per_night_minor
       FROM reservations r JOIN properties p ON p.id = r.property_id
      WHERE r.id = ? FOR UPDATE`,
    [reservationId],
  );

  // الملغى وعدم الحضور: لا إيراد إقامة، وتبقى الرسوم (غرامة إلغاء) فقط
  const stays = INACTIVE.has(reservation.status)
    ? []
    : await tx.query(
      'SELECT rooms_minor, extra_guest_minor, meal_minor, check_in, check_out FROM reservation_units WHERE reservation_id = ?',
      [reservationId],
    );

  const items = await tx.query(
    'SELECT type, amount_minor, taxable, service_chargeable FROM folio_items WHERE reservation_id = ? AND voided_at IS NULL',
    [reservationId],
  );

  let promoDiscountMinor = 0;
  if (stays.length > 0 && reservation.promo_code_id) {
    const promo = await tx.queryOne('SELECT * FROM promo_codes WHERE id = ?', [reservation.promo_code_id]);
    const base = sum(stays.map((stay) => stay.rooms_minor + stay.extra_guest_minor));
    promoDiscountMinor = promoDiscount({ promo, base });
  }

  const totals = computeTotals({
    lines: reservationLines({ stays, folioItems: items, promoDiscountMinor }),
    unitNights: sum(stays.map((stay) => diffDays(stay.check_in, stay.check_out))),
    property: reservation,
  });

  const { paid } = await tx.queryOne(
    `SELECT COALESCE(SUM(CASE WHEN type = 'payment' THEN amount_minor ELSE -amount_minor END), 0) AS paid
       FROM payments WHERE reservation_id = ? AND voided_at IS NULL`,
    [reservationId],
  );

  const snapshot = {
    rooms_minor: totals.breakdown.rooms_minor,
    extra_guest_minor: totals.breakdown.extra_guest_minor,
    meal_minor: totals.breakdown.meal_minor,
    extras_minor: totals.breakdown.extras_minor,
    discount_minor: totals.breakdown.discount_minor,
    service_charge_minor: totals.service_charge_minor,
    tax_minor: totals.tax_minor,
    city_fee_minor: totals.city_fee_minor,
    total_minor: totals.total_minor,
    paid_minor: Number(paid),
  };

  await tx.execute(
    `UPDATE reservations SET rooms_minor = ?, extra_guest_minor = ?, meal_minor = ?, extras_minor = ?,
            discount_minor = ?, service_charge_minor = ?, tax_minor = ?, city_fee_minor = ?, total_minor = ?, paid_minor = ?
      WHERE id = ?`,
    [...Object.values(snapshot), reservationId],
  );
  return { ...snapshot, subtotal_minor: totals.subtotal_minor };
}
