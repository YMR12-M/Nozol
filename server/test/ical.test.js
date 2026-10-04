import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { query } from '../src/config/db.js';
import { buildCalendar, parseEvents } from '../src/modules/ical/ical.js';
import { assertSafeUrl, fetchText, isPrivateIp } from '../src/utils/safeFetch.js';
import { API, bearer, bootstrapOwner, makeApp, resetDatabase, shutdown } from './helpers.js';
import { day, get, makeHotel, mustBook, post } from './fixtures.js';

const compact = (iso) => iso.replaceAll('-', '');
const ics = (events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => [
  'BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${compact(e.start)}`, `DTEND;VALUE=DATE:${compact(e.end)}`,
  `SUMMARY:${e.summary ?? 'Reserved'}`, ...(e.status ? [`STATUS:${e.status}`] : []), 'END:VEVENT',
]), 'END:VCALENDAR'].join('\r\n');

describe('قارئ iCal', () => {
  test('أحداث يوم كامل، وSTATUS:CANCELLED يُهمَل، وبلا نهاية = ليلة واحدة', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:a1', 'DTSTART;VALUE=DATE:20261010', 'DTEND;VALUE=DATE:20261013', 'SUMMARY:Airbnb (Not available)', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:a2', 'DTSTART;VALUE=DATE:20261020', 'STATUS:CANCELLED', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:a3', 'DTSTART;VALUE=DATE:20261101', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    assert.deepEqual(parseEvents(text), [
      { uid: 'a1', start: '2026-10-10', end: '2026-10-13', summary: 'Airbnb (Not available)' },
      { uid: 'a3', start: '2026-11-01', end: '2026-11-02', summary: 'Reserved' },
    ]);
  });

  test('الأوقات: UTC يتحوّل لتاريخ المنشأة، والمحلّي يبقى، والحدث داخل اليوم = ليلة', () => {
    const text = [
      'BEGIN:VEVENT', 'UID:z1', 'DTSTART:20261010T230000Z', 'DTEND:20261012T090000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:l1', 'DTSTART;TZID=Africa/Cairo:20261015T140000', 'DTEND;TZID=Africa/Cairo:20261015T180000', 'END:VEVENT',
    ].join('\n');
    const [utc, local] = parseEvents(text, 'Africa/Cairo');
    assert.equal(utc.start, '2026-10-11', '23:00Z = 02:00 القاهرة صباح اليوم التالي');
    assert.equal(utc.end, '2026-10-12');
    assert.deepEqual([local.start, local.end], ['2026-10-15', '2026-10-16']);
  });

  test('الأسطر المطوية تُفكّ، والملفات الفاسدة لا تُسقط القارئ', () => {
    const folded = 'BEGIN:VEVENT\r\nUID:f1\r\nSUMMARY:Very long\r\n  summary text\r\nDTSTART;VALUE=DATE:20261010\r\nDTEND;VALUE=DATE:20261011\r\nEND:VEVENT';
    assert.equal(parseEvents(folded)[0].summary, 'Very long summary text');
    assert.deepEqual(parseEvents('garbage'), []);
    assert.deepEqual(parseEvents('BEGIN:VEVENT\nUID:x\nDTSTART:not-a-date\nEND:VEVENT'), []);
  });

  test('الكتابة: CRLF، بلا أسماء، تواريخ يوم كامل', () => {
    const out = buildCalendar({
      name: 'غرفة 101', host: 'api.example.com', now: new Date('2026-10-04T10:00:00Z'),
      events: [{ uid: 'nozol-stay-1', start: '2026-10-10', end: '2026-10-12', summary: 'Reserved' }],
    });
    assert.ok(out.includes('\r\n'));
    assert.ok(out.includes('UID:nozol-stay-1@api.example.com'));
    assert.ok(out.includes('DTSTART;VALUE=DATE:20261010'));
    assert.ok(out.includes('DTEND;VALUE=DATE:20261012'));
    assert.ok(out.endsWith('END:VCALENDAR\r\n'));
  });
});

describe('حماية SSRF', () => {
  test('العناوين الداخلية مرفوضة (IPv4 وIPv6 والمُحوَّلة)', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.5.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      assert.equal(isPrivateIp(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111']) {
      assert.equal(isPrivateIp(ip), false, ip);
    }
  });

  test('الرابط: بروتوكول وبيانات اعتماد وعناوين IP حرفية', () => {
    assert.throws(() => assertSafeUrl('file:///etc/passwd'), /غير مسموح/);
    assert.throws(() => assertSafeUrl('ftp://example.com/x'), /غير مسموح/);
    assert.throws(() => assertSafeUrl('http://user:pass@example.com/x'), /غير مسموح/);
    assert.throws(() => assertSafeUrl('http://127.0.0.1:3306/'), /غير مسموح/);
    assert.throws(() => assertSafeUrl('http://[::1]/'), /غير مسموح/);
    assert.throws(() => assertSafeUrl('not a url'), /غير صالح/);
    assert.doesNotThrow(() => assertSafeUrl('https://example.com/cal.ics'));
  });

  test('الاتصال بـ localhost مرفوض عند الاتصال نفسه (لا يكفي فحص الاسم)', async () => {
    await assert.rejects(fetchText('http://localhost:9/cal.ics', { timeoutMs: 2000 }), /غير مسموح|URL_NOT_ALLOWED/);
  });
});

describe('المزامنة والتصدير', () => {
  const { http: api } = makeApp();
  let hotel;
  let ctx;
  let server;
  let feedUrl;
  let events = [];
  let failing = false;

  before(async () => {
    await resetDatabase();
    ctx = await bootstrapOwner(api);
    hotel = await makeHotel(api, ctx.token, { rooms: 2 });

    server = http.createServer((req, res) => {
      if (failing) { res.writeHead(500).end('boom'); return; }
      res.writeHead(200, { 'Content-Type': 'text/calendar' }).end(ics(events));
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    feedUrl = `http://127.0.0.1:${server.address().port}/airbnb.ics`;
  });
  after(async () => {
    await new Promise((resolve) => { server.close(resolve); });
    await shutdown();
  });

  test('الاستيراد: حدث حرّ يصير حجبًا، والمتعارض مع حجز عندنا يُسجَّل تعارضًا ولا يحجب', async () => {
    const [unit] = hotel.units;
    const ours = await mustBook(api, hotel, { check_in: day(20), check_out: day(22), rooms: [{ unit_type_id: hotel.type.id, unit_id: unit.id }] });
    events = [
      { uid: 'airbnb-1', start: day(10), end: day(13) },
      { uid: 'airbnb-conflict', start: day(21), end: day(24) },
    ];

    const feed = await post(api, hotel, '/ical/feeds', { unit_id: unit.id, name: 'Airbnb', url: feedUrl });
    assert.equal(feed.status, 201);

    const sync = await post(api, hotel, `/ical/feeds/${feed.body.data.id}/sync`);
    assert.equal(sync.status, 200, JSON.stringify(sync.body));
    assert.equal(sync.body.data.created, 1);
    assert.equal(sync.body.data.conflicts.length, 1);
    assert.equal(sync.body.data.conflicts[0].reservation, ours.code);

    // الحدث الحرّ أغلق الوحدة 101 (ليالي 10-12)، فلا يمكن حجزها
    const blocked = await api.post(`${hotel.base}/reservations`).set(bearer(hotel.token)).send({
      guest: { full_name: 'نزيل تاني', phone: '01022223333' }, check_in: day(11), check_out: day(12), adults: 2,
      rooms: [{ unit_type_id: hotel.type.id, unit_id: unit.id }],
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'UNIT_NOT_AVAILABLE');

    const listed = await get(api, hotel, '/ical/feeds');
    assert.match(listed.body.data[0].last_status, /1 تعارض/);

    // تنبيه المدير بالتعارض (Push في الصندوق للمالك)
    const alerts = await query("SELECT payload FROM notification_outbox WHERE channel = 'push'");
    assert.ok(alerts.some((row) => JSON.stringify(row.payload).includes('حجز مزدوج')));
  });

  test('إعادة المزامنة لا تكرّر، وتغيير التواريخ يحدّث الحجب، واختفاء الحدث يرفعه', async () => {
    const [feed] = (await get(api, hotel, '/ical/feeds')).body.data;
    const again = await post(api, hotel, `/ical/feeds/${feed.id}/sync`);
    assert.equal(again.body.data.created, 0);
    assert.equal(again.body.data.removed, 0);

    events = [{ uid: 'airbnb-1', start: day(10), end: day(11) }];
    const changed = await post(api, hotel, `/ical/feeds/${feed.id}/sync`);
    assert.equal(changed.body.data.removed, 1);
    assert.equal(changed.body.data.created, 1);
    const nights = await query("SELECT COUNT(*) AS n FROM unit_nights n JOIN unit_blocks b ON b.id = n.block_id WHERE b.ical_feed_id = ?", [feed.id]);
    assert.equal(nights[0].n, 1);

    events = [];
    await post(api, hotel, `/ical/feeds/${feed.id}/sync`);
    const left = await query('SELECT COUNT(*) AS n FROM unit_blocks WHERE ical_feed_id = ?', [feed.id]);
    assert.equal(left[0].n, 0);
  });

  test('فشل جلب مؤقت لا يمسح الحجب الحالي ويسجّل الحالة', async () => {
    const [feed] = (await get(api, hotel, '/ical/feeds')).body.data;
    events = [{ uid: 'keep-me', start: day(30), end: day(32) }];
    await post(api, hotel, `/ical/feeds/${feed.id}/sync`).expect(200);

    failing = true;
    const result = await post(api, hotel, `/ical/feeds/${feed.id}/sync`);
    failing = false;
    assert.ok(result.body.data.error);
    const blocks = await query('SELECT COUNT(*) AS n FROM unit_blocks WHERE ical_feed_id = ?', [feed.id]);
    assert.equal(blocks[0].n, 1, 'الليالي تبقى مغلقة أمانًا');
    const status = (await get(api, hotel, '/ical/feeds')).body.data[0].last_status;
    assert.match(status, /^فشل/);
  });

  test('حذف التقويم يرفع حجبه', async () => {
    const [feed] = (await get(api, hotel, '/ical/feeds')).body.data;
    await api.delete(`${hotel.base}/ical/feeds/${feed.id}`).set(bearer(hotel.token)).expect(204);
    const blocks = await query('SELECT COUNT(*) AS n FROM unit_blocks WHERE reason = ?', ['ical']);
    assert.equal(blocks[0].n, 0);
  });

  test('رابط التقويم المحلّي مرفوض خارج بيئة الاختبار (منطق الإنتاج)', () => {
    assert.throws(() => assertSafeUrl('http://169.254.169.254/latest/meta-data/', { allowPrivate: false }), /غير مسموح/);
  });

  test('التصدير: رابط سرّي، حجوزات بلا أسماء، بلا حجب مستورَد، والتدوير يبطل القديم', async () => {
    const [unit] = hotel.units;
    const link = await post(api, hotel, `/ical/units/${unit.id}/export-link`, {});
    assert.equal(link.status, 200);
    const token = link.body.data.token;

    await post(api, hotel, `/units/${unit.id}/blocks`, { start_date: day(40), end_date: day(42), reason: 'maintenance' }).expect(201);
    const feed = await post(api, hotel, '/ical/feeds', { unit_id: unit.id, name: 'Booking', url: feedUrl });
    events = [{ uid: 'imported', start: day(50), end: day(52) }];
    await post(api, hotel, `/ical/feeds/${feed.body.data.id}/sync`).expect(200);

    const response = await api.get(`${API}/ical/${token}.ics`);
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/calendar/);
    assert.ok(response.text.includes(`DTSTART;VALUE=DATE:${compact(day(20))}`), 'حجزنا في الملف');
    assert.ok(response.text.includes(`DTSTART;VALUE=DATE:${compact(day(40))}`), 'حجب الصيانة في الملف');
    assert.ok(!response.text.includes(compact(day(50))), 'الحجب المستورَد لا يُصدَّر (لا حلقة)');
    assert.ok(!response.text.includes('نزيل اختبار'), 'بلا أسماء نزلاء');

    const rotated = await post(api, hotel, `/ical/units/${unit.id}/export-link`, { rotate: true });
    assert.notEqual(rotated.body.data.token, token);
    assert.equal((await api.get(`${API}/ical/${token}.ics`)).status, 404);
    assert.equal((await api.get(`${API}/ical/${rotated.body.data.token}.ics`)).status, 200);
    assert.equal((await api.get(`${API}/ical/short.ics`)).status, 404);
  });
});
