/**
 * ═══════════════════════════════════════════════════════════════
 *  تغيير الإقامة بعد الحجز: تعديل التواريخ (تمديد/تقصير/تأجيل) ونقل الغرفة.
 *
 *  القاعدة الذهبية: **نقفل قبل أن نحرّر**. عند النقل نقفل ليالي الوحدة الجديدة
 *  أولًا؛ لو فشل القفل لم نلمس القديمة، فلا يضيع حجز النزيل لحظةً بين خطوتين.
 *  وكل شيء داخل معاملة واحدة تُلغى كلها عند أي خطأ.
 *
 *  التسعير عند تغيير التواريخ: الليالي الباقية تحتفظ بسعرها وقت الحجز (لا
 *  نغيّر ما اتّفق عليه النزيل)، والليالي المضافة فقط تُسعَّر بالأسعار الحالية.
 * ═══════════════════════════════════════════════════════════════
 */
import { isDuplicate } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { eachNight, todayIn } from '../../utils/dates.js';
import { evaluateStay, priceUnitStay } from '../pricing/engine.js';
import { loadRules } from '../pricing/quote.service.js';
import { findAvailableUnits, orderByBestFit } from '../availability/availability.service.js';
import { recalculateReservation } from '../billing/totals.js';
import {
  describeConflicts, lockNights, refreshSegmentTotals, releaseNights, writeNightPrices,
} from './stay.js';

const occupied = (message, details) => ApiError.conflict(message, { code: 'UNIT_NOT_AVAILABLE', details });

/** نوع الوحدة وخطة السعر والقواعد لجزء (للتسعير والتحقّق) */
async function pricingContext(tx, property, segment, from, to) {
  const unitType = await tx.queryOne('SELECT * FROM unit_types WHERE id = ?', [segment.unit_type_id]);
  const ratePlan = segment.rate_plan_id
    ? await tx.queryOne('SELECT * FROM rate_plans WHERE id = ?', [segment.rate_plan_id])
    : null;
  const rules = await loadRules(property.id, unitType.id, from, to);
  return { unitType, ratePlan, rules };
}

/** يسعّر ليالي [from, to) لجزء ويكتبها */
async function priceAndWrite(tx, property, segment, from, to) {
  const { unitType, ratePlan, rules } = await pricingContext(tx, property, segment, from, to);
  const stay = priceUnitStay({
    unitType, ratePlan, rules, checkIn: from, checkOut: to, adults: segment.adults, children: segment.children,
  });
  await writeNightPrices(tx, segment.id, stay.nights);
}

/**
 * يمدّد جزءًا بليالٍ إضافية. لو الوحدة مشغولة:
 *  • allowReassign وجزء وحيد في السطر وغير مقيم ← ننقل كل الإقامة لوحدة فاضية من نفس النوع.
 *  • غير ذلك ← نشرح من يشغلها (والحلّ نقل غرفة صريح).
 */
async function extendSegment(tx, property, reservation, segment, { from, to, newStart, newEnd, allowReassign, lineLength }) {
  const added = eachNight(from, to);
  try {
    await lockNights(tx, segment.unit_id, added, segment.id);
  } catch (error) {
    if (!isDuplicate(error)) throw error;

    const canReassign = allowReassign && lineLength === 1 && reservation.status !== 'checked_in';
    if (!canReassign) {
      throw occupied('الوحدة دي مشغولة في الليالي المضافة — انقل النزيل لغرفة تانية أو غيّر التواريخ', {
        occupied: await describeConflicts(tx, segment.unit_id, from, to),
      });
    }

    // نحرّر ليالي الجزء الحالية (تُعاد على الوحدة الجديدة) ثم نبحث عن بديل لكل المدى الجديد
    await tx.execute('DELETE FROM unit_nights WHERE reservation_unit_id = ?', [segment.id]);
    const candidates = await orderByBestFit(
      (await findAvailableUnits(property.id, segment.unit_type_id, newStart, newEnd, { tx })).filter((u) => u.id !== segment.unit_id),
      newStart, newEnd, { tx },
    );
    let moved = false;
    for (const candidate of candidates) {
      try {
        await lockNights(tx, candidate.id, eachNight(newStart, newEnd), segment.id);
        await tx.execute('UPDATE reservation_units SET unit_id = ? WHERE id = ?', [candidate.id, segment.id]);
        segment.unit_id = candidate.id;
        moved = true;
        break;
      } catch (innerError) {
        if (!isDuplicate(innerError)) throw innerError;
      }
    }
    if (!moved) {
      throw ApiError.conflict('مفيش وحدة فاضية من نفس النوع للتواريخ الجديدة', { code: 'NO_AVAILABILITY' });
    }
  }
  await priceAndWrite(tx, property, segment, from, to);
}

/**
 * يعدّل نافذة الإقامة كلها [newIn, newOut) لكل سطر غرفة في الحجز.
 *  1) قصّ: ما خرج عن النافذة يُحرَّر.  2) تمديد البداية/النهاية بليالٍ مسعّرة.
 *  3) لو لم يبقَ شيء (نافذة جديدة منفصلة تمامًا) ننشئ جزءًا جديدًا على نفس الوحدة.
 */
export async function resizeStayInTx(tx, property, reservation, { checkIn: newIn, checkOut: newOut, allowReassign = false, overrideRestrictions = false }) {
  const segments = await tx.query(
    'SELECT * FROM reservation_units WHERE reservation_id = ? ORDER BY line_no, check_in, id',
    [reservation.id],
  );
  const lines = new Map();
  for (const segment of segments) {
    if (!lines.has(segment.line_no)) lines.set(segment.line_no, []);
    lines.get(segment.line_no).push(segment);
  }

  for (const track of lines.values()) {
    const head = track[0];

    // قيود التسعير على النافذة الجديدة كاملة (مع نوع أول جزء وخطته)
    const ctx = await pricingContext(tx, property, head, newIn, newOut);
    const { violations } = evaluateStay({
      rules: ctx.rules, ratePlan: ctx.ratePlan, unitType: ctx.unitType,
      checkIn: newIn, checkOut: newOut, adults: head.adults, children: head.children,
    });
    if (violations.length > 0 && !overrideRestrictions) {
      throw ApiError.unprocessable(violations[0].message, { code: 'STAY_RESTRICTED', details: { violations } });
    }

    // 1) قصّ
    const kept = [];
    for (const segment of track) {
      const from = segment.check_in > newIn ? segment.check_in : newIn;
      const to = segment.check_out < newOut ? segment.check_out : newOut;
      if (from >= to) {
        await releaseNights(tx, segment.id);
        await tx.execute('DELETE FROM reservation_units WHERE id = ?', [segment.id]);
        continue;
      }
      if (from > segment.check_in) await releaseNights(tx, segment.id, { to: from });
      if (to < segment.check_out) await releaseNights(tx, segment.id, { from: to });
      if (from !== segment.check_in || to !== segment.check_out) {
        await tx.execute('UPDATE reservation_units SET check_in = ?, check_out = ? WHERE id = ?', [from, to, segment.id]);
      }
      kept.push({ ...segment, check_in: from, check_out: to });
    }

    // 3) نافذة منفصلة: جزء جديد على وحدة أول جزء (أو بديلها عند الطلب)
    if (kept.length === 0) {
      const created = await tx.execute(
        `INSERT INTO reservation_units (reservation_id, line_no, unit_id, unit_type_id, check_in, check_out, adults, children, rate_plan_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [reservation.id, head.line_no, head.unit_id, head.unit_type_id, newIn, newOut, head.adults, head.children, head.rate_plan_id],
      );
      const fresh = { ...head, id: created.insertId, check_in: newIn, check_out: newOut };
      await extendSegment(tx, property, reservation, fresh, {
        from: newIn, to: newOut, newStart: newIn, newEnd: newOut, allowReassign, lineLength: 1,
      });
      await refreshSegmentTotals(tx, fresh.id);
      continue;
    }

    // 2) تمديد البداية ثم النهاية
    const first = kept[0];
    if (newIn < first.check_in) {
      await extendSegment(tx, property, reservation, first, {
        from: newIn, to: first.check_in, newStart: newIn, newEnd: kept[kept.length - 1].check_out, allowReassign, lineLength: kept.length,
      });
      await tx.execute('UPDATE reservation_units SET check_in = ? WHERE id = ?', [newIn, first.id]);
      first.check_in = newIn;
    }
    const last = kept[kept.length - 1];
    if (newOut > last.check_out) {
      await extendSegment(tx, property, reservation, last, {
        from: last.check_out, to: newOut, newStart: kept[0].check_in, newEnd: newOut, allowReassign, lineLength: kept.length,
      });
      await tx.execute('UPDATE reservation_units SET check_out = ? WHERE id = ?', [newOut, last.id]);
      last.check_out = newOut;
    }
    for (const segment of kept) await refreshSegmentTotals(tx, segment.id);
  }

  await tx.execute(
    `UPDATE reservations r SET
       check_in = (SELECT MIN(check_in) FROM reservation_units WHERE reservation_id = r.id),
       check_out = (SELECT MAX(check_out) FROM reservation_units WHERE reservation_id = r.id)
     WHERE r.id = ?`,
    [reservation.id],
  );
  await tx.execute('UPDATE reservations SET nights = DATEDIFF(check_out, check_in) WHERE id = ?', [reservation.id]);
  return recalculateReservation(tx, reservation.id);
}

/**
 * نقل غرفة. لو effective == بداية الجزء ننقل الجزء كله في مكانه، وإلا نقسمه:
 * القديم يُقصَّر حتى تاريخ النقل، وجزء جديد يبدأ منه على الغرفة الجديدة.
 * نوع مختلف (ترقية/تنزيل) ← تُعاد تسعير الليالي المنقولة بسعر النوع الجديد.
 */
export async function moveSegmentInTx(tx, property, reservation, { segmentId, toUnitId, effectiveDate }) {
  const segment = await tx.queryOne(
    'SELECT * FROM reservation_units WHERE id = ? AND reservation_id = ?',
    [segmentId, reservation.id],
  );
  if (!segment) throw ApiError.notFound('جزء الإقامة غير موجود في الحجز ده');

  const today = todayIn(property.timezone);
  const effective = effectiveDate
    ?? (reservation.status === 'checked_in' && today > segment.check_in ? today : segment.check_in);

  if (effective < segment.check_in || effective >= segment.check_out) {
    throw ApiError.unprocessable('تاريخ النقل لازم يكون داخل فترة الجزء ده', {
      code: 'VALIDATION_ERROR', details: { effective_date: `بين ${segment.check_in} و${segment.check_out}` },
    });
  }
  if (reservation.status === 'checked_in' && effective < today) {
    throw ApiError.conflict('مينفعش تنقل ليالي فاتت', { code: 'PAST_NIGHTS' });
  }

  const target = await tx.queryOne(
    "SELECT id, unit_type_id, code, status, housekeeping_status FROM units WHERE id = ? AND property_id = ? AND deleted_at IS NULL",
    [toUnitId, property.id],
  );
  if (!target || target.status !== 'active') {
    throw ApiError.badRequest('الغرفة المطلوبة غير متاحة', { code: 'BAD_UNIT', details: { to_unit_id: 'غير متاحة' } });
  }
  if (target.id === segment.unit_id) {
    throw ApiError.badRequest('الغرفة دي هي الغرفة الحالية', { code: 'SAME_UNIT' });
  }

  const nights = eachNight(effective, segment.check_out);
  const inPlace = effective === segment.check_in;
  const sameType = target.unit_type_id === segment.unit_type_id;

  // الجزء الذي سيحمل الليالي على الغرفة الجديدة
  let destinationId = segment.id;
  if (!inPlace) {
    const created = await tx.execute(
      `INSERT INTO reservation_units (reservation_id, line_no, unit_id, unit_type_id, check_in, check_out, adults, children, rate_plan_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reservation.id, segment.line_no, target.id, target.unit_type_id, effective, segment.check_out,
        segment.adults, segment.children, segment.rate_plan_id],
    );
    destinationId = created.insertId;
  }

  // 1) نقفل الجديدة (لو فشلت لم نلمس القديمة) — ثم 2) نحرّر القديمة
  try {
    if (inPlace) await tx.execute('DELETE FROM unit_nights WHERE reservation_unit_id = ?', [segment.id]);
    await lockNights(tx, target.id, nights, destinationId);
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    throw occupied('الغرفة الجديدة مشغولة في بعض الليالي دي', {
      occupied: await describeConflicts(tx, target.id, effective, segment.check_out),
    });
  }

  if (inPlace) {
    await tx.execute('UPDATE reservation_units SET unit_id = ?, unit_type_id = ? WHERE id = ?', [target.id, target.unit_type_id, segment.id]);
  } else {
    await tx.execute('DELETE FROM unit_nights WHERE reservation_unit_id = ? AND night >= ?', [segment.id, effective]);
    await tx.execute('UPDATE reservation_units SET check_out = ? WHERE id = ?', [effective, segment.id]);
  }

  // 3) الأسعار: نفس النوع ← تنتقل كما هي؛ نوع مختلف ← تُسعَّر من جديد
  if (sameType) {
    if (!inPlace) {
      await tx.execute(
        'UPDATE reservation_nights SET reservation_unit_id = ? WHERE reservation_unit_id = ? AND night >= ?',
        [destinationId, segment.id, effective],
      );
    }
  } else {
    await tx.execute(
      'DELETE FROM reservation_nights WHERE reservation_unit_id = ? AND night >= ?',
      [segment.id, effective],
    );
    await priceAndWrite(
      tx, property,
      { id: destinationId, unit_type_id: target.unit_type_id, rate_plan_id: segment.rate_plan_id, adults: segment.adults, children: segment.children },
      effective, segment.check_out,
    );
  }

  await refreshSegmentTotals(tx, segment.id);
  if (!inPlace) await refreshSegmentTotals(tx, destinationId);
  const totals = await recalculateReservation(tx, reservation.id);

  return {
    totals,
    from_unit_id: segment.unit_id,
    to_unit_id: target.id,
    effective,
    type_changed: !sameType,
    target_not_ready: !['clean', 'inspected'].includes(target.housekeeping_status),
    target_code: target.code,
  };
}
