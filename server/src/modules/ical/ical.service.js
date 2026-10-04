/**
 * ═══════════════════════════════════════════════════════════════
 *  مزامنة iCal مع Airbnb وBooking.com وغيرهما
 *
 *  • التصدير: لكل وحدة رابط سرّي (توكن عشوائي) تقرؤه المنصّة، فتغلق الليالي
 *    المحجوزة عندنا. لا نُصدّر أسماء النزلاء، ولا نُصدّر الحجب المستورَد
 *    نفسه (وإلا دارت الأحداث بين النظامين في حلقة لا تنتهي).
 *  • الاستيراد: نقرأ تقويم الوحدة عند المنصّة ونحوّل كل حدث لحجب يغلق الليالي
 *    عندنا بنفس قفل unit_nights. لو تعارض مع حجز لدينا لا نحجب، ونُنبّه
 *    المدير (هذا حجز مزدوج حقيقي يحتاج قرارًا بشريًّا).
 *  • فشل الجلب المؤقت لا يمسح الحجب الحالي: الأمان أن نُبقي الليالي مغلقة.
 * ═══════════════════════════════════════════════════════════════
 */
import { z } from 'zod';
import { query, queryOne, execute, transaction, isDuplicate } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { addDays, eachNight, todayIn } from '../../utils/dates.js';
import { randomToken } from '../../utils/security.js';
import { assertSafeUrl, fetchText } from '../../utils/safeFetch.js';
import { idSchema } from '../../utils/schemas.js';
import { logger } from '../../utils/logger.js';
import { notifyStaff } from '../../services/notifications/staff.js';
import { buildCalendar, parseEvents } from './ical.js';

export const createFeedSchema = z.object({
  unit_id: idSchema,
  name: z.string().trim().min(2).max(120),
  url: z.string().trim().url().max(600),
});
export const updateFeedSchema = z.object({
  name: z.string().trim().min(2).max(120),
  url: z.string().trim().url().max(600),
  is_active: z.boolean(),
}).partial();

// في الاختبارات نسمح بخادم محلّي، وفي أي بيئة أخرى لا استثناء أبدًا
const allowPrivate = () => env.isTest;

const placeholdersFor = (rows, width) =>
  Array.from({ length: rows }, () => `(${Array(width).fill('?').join(',')})`).join(',');

async function loadFeed(propertyId, id) {
  const feed = await queryOne(
    `SELECT f.*, u.code AS unit_code FROM ical_feeds f JOIN units u ON u.id = f.unit_id
      WHERE f.id = ? AND f.property_id = ?`,
    [id, propertyId],
  );
  if (!feed) throw ApiError.notFound('التقويم غير موجود');
  return { ...feed, is_active: Boolean(feed.is_active) };
}

async function assertUnit(propertyId, unitId) {
  const unit = await queryOne(
    "SELECT id FROM units WHERE id = ? AND property_id = ? AND deleted_at IS NULL AND status <> 'archived'",
    [unitId, propertyId],
  );
  if (!unit) throw ApiError.badRequest('الوحدة غير موجودة', { code: 'BAD_UNIT', details: { unit_id: 'غير موجودة' } });
}

/**
 * يزامن تقويم واحدًا. يعيد ملخّصًا ويكتب الحالة على الصفّ.
 * التفاضل: حدث جديد/متغيّر ← حجب جديد، وحدث اختفى ← يُحذف حجبه.
 */
export async function syncFeed(property, feed) {
  const today = todayIn(property.timezone);
  const summary = { events: 0, created: 0, removed: 0, conflicts: [] };

  let events;
  try {
    const text = await fetchText(feed.url, { allowPrivate: allowPrivate() });
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('الملف مش تقويم iCal صالح');
    events = parseEvents(text, property.timezone).filter((event) => event.end > today);
  } catch (error) {
    const status = `فشل: ${error.message}`.slice(0, 190);
    await execute('UPDATE ical_feeds SET last_synced_at = NOW(), last_status = ? WHERE id = ?', [status, feed.id]);
    logger.warn(`فشل مزامنة iCal #${feed.id}: ${error.message}`);
    return { ...summary, error: error.message };
  }
  summary.events = events.length;

  const wanted = new Map(events.map((event) => [event.uid, event]));
  const existing = await query(
    'SELECT id, external_uid, start_date, end_date FROM unit_blocks WHERE ical_feed_id = ?',
    [feed.id],
  );

  await transaction(async (tx) => {
    // 1) نحذف ما اختفى أو تغيّرت تواريخه
    for (const block of existing) {
      const event = wanted.get(block.external_uid);
      const unchanged = event && event.start === block.start_date && event.end === block.end_date;
      if (unchanged) { wanted.delete(block.external_uid); continue; }
      if (block.end_date > today) {
        await tx.execute('DELETE FROM unit_blocks WHERE id = ?', [block.id]);
        summary.removed += 1;
      }
    }

    // 2) نضيف الجديد/المتغيّر
    for (const event of wanted.values()) {
      const nights = eachNight(event.start, event.end);
      const block = await tx.execute(
        `INSERT INTO unit_blocks (property_id, unit_id, start_date, end_date, reason, note, external_uid, ical_feed_id)
         VALUES (?, ?, ?, ?, 'ical', ?, ?, ?)`,
        [property.id, feed.unit_id, event.start, event.end, `${feed.name}: ${event.summary}`.slice(0, 255), event.uid, feed.id],
      );
      try {
        await tx.execute(
          `INSERT INTO unit_nights (unit_id, night, block_id) VALUES ${placeholdersFor(nights.length, 3)}`,
          nights.flatMap((night) => [feed.unit_id, night, block.insertId]),
        );
        summary.created += 1;
      } catch (error) {
        if (!isDuplicate(error)) throw error;
        // الليالي مشغولة عندنا بحجز: لا نحجب فوقه، ونسجّل التعارض ليراجعه المدير
        await tx.execute('DELETE FROM unit_blocks WHERE id = ?', [block.insertId]);
        const holder = await tx.queryOne(
          `SELECT r.code FROM unit_nights n JOIN reservation_units ru ON ru.id = n.reservation_unit_id
             JOIN reservations r ON r.id = ru.reservation_id
            WHERE n.unit_id = ? AND n.night >= ? AND n.night < ? LIMIT 1`,
          [feed.unit_id, event.start, event.end],
        );
        summary.conflicts.push({ uid: event.uid, start: event.start, end: event.end, reservation: holder?.code ?? null });
      }
    }
  });

  const status = summary.conflicts.length > 0
    ? `${summary.events} حدث — ${summary.conflicts.length} تعارض مع حجوزات عندنا`
    : `${summary.events} حدث — تمّت المزامنة`;

  // ننبّه مرّة عند تغيّر حالة التعارض فقط (لا إزعاج كل 15 دقيقة)
  if (summary.conflicts.length > 0 && feed.last_status !== status) {
    await notifyStaff(property, {
      roles: ['manager'],
      payload: {
        title: 'حجز مزدوج محتمل',
        body: `تقويم ${feed.name} (وحدة ${feed.unit_code ?? ''}) فيه ${summary.conflicts.length} حجز يتعارض مع حجوزاتنا`,
        url: '/calendar',
      },
    });
  }

  await execute(
    'UPDATE ical_feeds SET last_synced_at = NOW(), last_status = ?, last_event_count = ? WHERE id = ?',
    [status.slice(0, 190), summary.events, feed.id],
  );
  return summary;
}

export const ical = {
  async listFeeds(propertyId) {
    const rows = await query(
      `SELECT f.id, f.unit_id, u.code AS unit_code, f.name, f.url, f.is_active, f.last_synced_at, f.last_status, f.last_event_count
         FROM ical_feeds f JOIN units u ON u.id = f.unit_id WHERE f.property_id = ? ORDER BY u.code, f.id`,
      [propertyId],
    );
    return rows.map((row) => ({ ...row, is_active: Boolean(row.is_active) }));
  },

  async createFeed(property, input) {
    await assertUnit(property.id, input.unit_id);
    assertSafeUrl(input.url, { allowPrivate: allowPrivate() });
    const result = await execute(
      'INSERT INTO ical_feeds (property_id, unit_id, name, url) VALUES (?, ?, ?, ?)',
      [property.id, input.unit_id, input.name, input.url],
    );
    return loadFeed(property.id, result.insertId);
  },

  async updateFeed(property, id, input) {
    const before = await loadFeed(property.id, id);
    if (input.url) assertSafeUrl(input.url, { allowPrivate: allowPrivate() });
    const fields = ['name', 'url', 'is_active'].filter((f) => input[f] !== undefined);
    if (fields.length > 0) {
      await execute(`UPDATE ical_feeds SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, [...fields.map((f) => input[f]), id]);
    }
    return { before, after: await loadFeed(property.id, id) };
  },

  /** حذف التقويم يرفع الحجب الذي جاء منه (الليالي تتحرّر بالـ CASCADE) */
  async removeFeed(property, id) {
    const feed = await loadFeed(property.id, id);
    await transaction(async (tx) => {
      await tx.execute('DELETE FROM unit_blocks WHERE ical_feed_id = ?', [id]);
      await tx.execute('DELETE FROM ical_feeds WHERE id = ?', [id]);
    });
    return feed;
  },

  async syncNow(property, id) {
    return syncFeed(property, await loadFeed(property.id, id));
  },

  /** رابط التصدير السرّي لوحدة. rotate يبطل القديم (لو تسرّب). */
  async exportLink(property, unitId, { rotate = false } = {}) {
    await assertUnit(property.id, unitId);
    let row = await queryOne('SELECT token FROM ical_export_tokens WHERE unit_id = ?', [unitId]);
    if (!row || rotate) {
      const token = randomToken(36).slice(0, 48);
      await execute(
        `INSERT INTO ical_export_tokens (unit_id, token) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE token = VALUES(token), created_at = NOW()`,
        [unitId, token],
      );
      row = { token };
    }
    return { token: row.token, url: `${env.apiPublicUrl}${env.apiPrefix}/ical/${row.token}.ics` };
  },

  /** نص .ics لتوكن (مسار عام بلا مصادقة، التوكن هو السرّ) */
  async exportCalendar(token) {
    const unit = await queryOne(
      `SELECT u.id, u.code, p.id AS property_id, p.name_ar, p.timezone
         FROM ical_export_tokens t JOIN units u ON u.id = t.unit_id JOIN properties p ON p.id = u.property_id
        WHERE t.token = ? AND u.deleted_at IS NULL AND p.status = 'active'`,
      [token],
    );
    if (!unit) throw ApiError.notFound('الرابط غير صالح');

    const today = todayIn(unit.timezone);
    const from = addDays(today, -30);

    const stays = await query(
      `SELECT ru.id, ru.check_in, ru.check_out FROM reservation_units ru JOIN reservations r ON r.id = ru.reservation_id
        WHERE ru.unit_id = ? AND r.status IN ('pending','confirmed','checked_in') AND ru.check_out > ?`,
      [unit.id, from],
    );
    // الحجب غير المستورَد فقط (نحذف ما جاء من iCal كي لا نُعيده لمصدره)
    const blocks = await query(
      `SELECT id, start_date, end_date FROM unit_blocks WHERE unit_id = ? AND ical_feed_id IS NULL AND end_date > ?`,
      [unit.id, from],
    );

    const events = [
      ...stays.map((s) => ({ uid: `nozol-stay-${s.id}`, start: s.check_in, end: s.check_out, summary: 'Reserved' })),
      ...blocks.map((b) => ({ uid: `nozol-block-${b.id}`, start: b.start_date, end: b.end_date, summary: 'Not available' })),
    ];
    const host = new URL(env.apiPublicUrl).hostname;
    return buildCalendar({ name: `${unit.name_ar} — ${unit.code}`, host, events });
  },
};

/** مهمة خلفية: يزامن كل التقاويم الفعّالة (واحدًا واحدًا لا بالتوازي) */
export async function syncAllFeeds() {
  const feeds = await query(
    `SELECT f.*, u.code AS unit_code FROM ical_feeds f JOIN units u ON u.id = f.unit_id
      JOIN properties p ON p.id = f.property_id
      WHERE f.is_active = 1 AND p.status = 'active' AND u.deleted_at IS NULL
        AND (f.last_synced_at IS NULL OR f.last_synced_at < DATE_SUB(NOW(), INTERVAL 14 MINUTE))
      ORDER BY f.last_synced_at LIMIT 100`,
  );
  for (const feed of feeds) {
    const property = await queryOne('SELECT * FROM properties WHERE id = ?', [feed.property_id]);
    try {
      await syncFeed(property, feed);
    } catch (error) {
      logger.error(`مزامنة iCal #${feed.id}: ${error.message}`);
    }
  }
  return feeds.length;
}
