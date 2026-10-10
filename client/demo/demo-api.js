/* ============================================
   النسخة التجريبية (عرض فقط) - النواة المشتركة

   بتعترض طلبات fetch لمسار الـ API وبترد عليها من بيانات وهمية متخزنة في
   localStorage عند الزائر نفسه. مفيش سيرفر ولا قاعدة بيانات: كل زائر معاه
   نسخته الخاصة، ومفيش أي حاجة بتتبعت لأي مكان.

   الملف ده مش بيتحمّل في النسخة الحقيقية خالص - بيتحط في index.html بتاع
   النسخة التجريبية بس (demo/inject.mjs). ومفيش أي تعديل على كود الواجهة.
   ============================================ */

function createDemo(cfg) {
  'use strict';

  var pad = function (n) {
    return String(n).padStart(2, '0');
  };

  var H = {
    pad: pad,
    now: function () {
      return Date.now();
    },
    // "YYYY-MM-DD HH:MM:SS" بتوقيت UTC (زي DATETIME من MySQL)
    utc: function (ms) {
      var d = new Date(ms);
      return (
        d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
        pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds())
      );
    },
    day: function (ms) {
      return H.utc(ms).slice(0, 10);
    },
    iso: function (ms) {
      return new Date(ms).toISOString();
    },
    // أيام نسبية لـ "النهارده" بتوقيت الزائر (YYYY-MM-DD)
    localDay: function (offset) {
      var d = new Date();
      d.setDate(d.getDate() + (offset || 0));
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },
    // رقم ثابت 0..999 من نص: عشان البيانات المتولّدة تبقى متكررة مش عشوائية
    hash: function (str) {
      var h = 2166136261;
      str = String(str);
      for (var i = 0; i < str.length; i += 1) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0) % 1000;
    },
    code: function (length, alphabet) {
      alphabet = alphabet || 'abcdefghijklmnopqrstuvwxyz0123456789';
      var out = '';
      for (var i = 0; i < length; i += 1) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
      return out;
    },
    ok: function (body, status) {
      return { status: status || 200, body: body };
    },
    seq: function (db, kind) {
      db.seq = db.seq || {};
      db.seq[kind] = (db.seq[kind] || 0) + 1;
      return db.seq[kind];
    },
    clone: function (value) {
      return JSON.parse(JSON.stringify(value));
    },
  };

  var db = null;

  function load() {
    try {
      var raw = localStorage.getItem(cfg.key);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.__v === cfg.version) return parsed;
      }
    } catch (e) {
      /* التخزين المحلي مقفول - هنكمّل من الذاكرة */
    }
    return null;
  }

  function save() {
    try {
      localStorage.setItem(cfg.key, JSON.stringify(db));
    } catch (e) {
      /* الكوتا خلصت أو التخزين مقفول - الجلسة الحالية شغّالة من الذاكرة */
    }
  }

  function reset() {
    db = { __v: cfg.version, seq: {} };
    cfg.seed(db, H);
    save();
  }

  db = load();
  if (!db) reset();

  /* ---------- اعتراض fetch ---------- */

  var prefixes = [].concat(cfg.prefix);
  var realFetch = window.fetch.bind(window);

  function matchPrefix(pathname) {
    for (var i = 0; i < prefixes.length; i += 1) {
      var p = prefixes[i];
      if (pathname === p || pathname.indexOf(p + '/') === 0) return pathname.slice(p.length) || '/';
    }
    return null;
  }

  function headerValue(headers, name) {
    if (!headers) return undefined;
    if (typeof headers.get === 'function') return headers.get(name);
    var lower = name.toLowerCase();
    for (var k in headers) if (k.toLowerCase() === lower) return headers[k];
    return undefined;
  }

  window.fetch = function (input, init) {
    var raw = typeof input === 'string' ? input : input && (input.url || input.href);
    var parsed;
    try {
      parsed = new URL(raw, window.location.origin);
    } catch (e) {
      return realFetch(input, init);
    }
    var path = parsed.origin === window.location.origin ? matchPrefix(parsed.pathname) : null;
    if (path === null) return realFetch(input, init);

    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var headers = (init && init.headers) || (input && input.headers) || {};
    var body = null;
    var rawBody = init && init.body;
    if (typeof rawBody === 'string' && rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch (e) {
        body = null;
      }
    }
    var query = {};
    parsed.searchParams.forEach(function (v, k) {
      query[k] = v;
    });

    var result;
    try {
      result = cfg.handle({ method: method, path: path, query: query, body: body, headers: headers, header: function (n) { return headerValue(headers, n); } }, db, H);
      if (!result) result = { status: 404, body: cfg.notFound ? cfg.notFound(path) : { message: 'المسار ده مش موجود في النسخة التجريبية' } };
      save();
    } catch (e) {
      if (window.console) console.error('[demo]', e);
      result = { status: 500, body: cfg.serverError ? cfg.serverError() : { message: 'حصل خطأ في النسخة التجريبية' } };
    }

    return new Promise(function (resolve) {
      setTimeout(function () {
        var h = Object.assign({ 'Content-Type': 'application/json' }, result.headers || {});
        var payload = result.status === 204 ? null : result.raw ? result.body : JSON.stringify(result.body);
        resolve(new Response(payload, { status: result.status, headers: h }));
      }, 40 + Math.floor(Math.random() * 80));
    });
  };

  /* ---------- شريط التجربة ---------- */

  var API = {
    db: function () {
      return db;
    },
    H: H,
    save: save,
    reset: function () {
      try {
        localStorage.removeItem(cfg.key);
      } catch (e) {
        /* لا شيء */
      }
      if (cfg.onReset) cfg.onReset();
      window.location.href = cfg.home || '/';
    },
    go: function (url) {
      save();
      window.location.href = url || cfg.home || '/';
    },
  };

  function mountBar() {
    if (document.getElementById('demo-bar')) return;
    var bar = cfg.bar || {};
    var style = document.createElement('style');
    style.textContent =
      '#demo-bar{position:fixed;left:10px;bottom:10px;z-index:2147483000;font-family:inherit;direction:rtl;font-size:13px;line-height:1.5}' +
      '#demo-bar *{box-sizing:border-box}' +
      '#demo-toggle{display:flex;align-items:center;gap:6px;background:#1c1c24;color:#fff;border:1px solid rgba(255,255,255,.28);' +
      'border-radius:999px;padding:7px 13px;font:inherit;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.35)}' +
      '#demo-toggle i{width:8px;height:8px;border-radius:50%;background:#f5b93a;display:inline-block}' +
      '#demo-panel{display:none;position:absolute;left:0;bottom:calc(100% + 8px);width:min(290px,calc(100vw - 20px));' +
      'background:#fff;color:#1c1c24;border:1px solid #d6d6dc;border-radius:14px;padding:12px;box-shadow:0 12px 32px rgba(0,0,0,.3)}' +
      '#demo-panel p{margin:0 0 8px;font-size:12.5px;color:#454552}' +
      '#demo-panel button{display:block;width:100%;margin-top:6px;padding:9px 11px;border-radius:10px;border:1px solid #1c1c24;' +
      'background:#fff;color:#1c1c24;font:inherit;font-weight:700;text-align:right;cursor:pointer}' +
      '#demo-panel button.primary{background:#1c1c24;color:#fff}' +
      '#demo-panel small{display:block;margin-top:9px;font-size:11.5px;color:#6a6a78}';
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.id = 'demo-bar';
    var actions = (bar.actions || [])
      .map(function (a, i) {
        return '<button type="button" class="' + (a.primary ? 'primary' : '') + '" data-i="' + i + '"></button>';
      })
      .join('');
    wrap.innerHTML =
      '<div id="demo-panel" role="dialog" aria-label="خيارات النسخة التجريبية">' +
      '<p></p>' + actions +
      '<button type="button" data-reset="1">إعادة ضبط البيانات</button><small></small></div>' +
      '<button id="demo-toggle" type="button" aria-expanded="false" aria-controls="demo-panel"><i></i><span></span></button>';
    document.body.appendChild(wrap);

    var panel = wrap.querySelector('#demo-panel');
    var toggle = wrap.querySelector('#demo-toggle');
    toggle.querySelector('span').textContent = bar.label || 'نسخة تجريبية';
    panel.querySelector('p').textContent =
      bar.intro || 'ده عرض للتطبيق ببيانات وهمية متخزنة على جهازك بس.';
    panel.querySelector('small').textContent = bar.note || '';
    (bar.actions || []).forEach(function (a, i) {
      panel.querySelector('button[data-i="' + i + '"]').textContent = a.label;
    });

    function setOpen(open) {
      panel.style.display = open ? 'block' : 'none';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    toggle.addEventListener('click', function () {
      setOpen(panel.style.display !== 'block');
    });
    panel.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.getAttribute('data-reset')) return API.reset();
      var idx = t.getAttribute('data-i');
      if (idx !== null && bar.actions[Number(idx)]) bar.actions[Number(idx)].run(API);
    });
    if (bar.openFirst && !sessionStorage.getItem(cfg.key + ':seen')) {
      try {
        sessionStorage.setItem(cfg.key + ':seen', '1');
      } catch (e) {
        /* لا شيء */
      }
      setOpen(true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBar);
  else mountBar();

  return API;
}
/* ============================================
   نُزُل - الباك إند التجريبي
   فندق وهمي كامل (غرف وحجوزات وتسعير وفوترة وتقويم) في localStorage الزائر.
   الأشكال مطابقة لـ server/src/modules/* (الغلاف {success, data, meta}).
   الفلوس بالقروش (أعداد صحيحة) زي السيرفر.
   ============================================ */

(function () {
  'use strict';

  const DEMO_PASSWORD = 'Demo@1234';
  const DAY = 86400000;

  const ROLE_PERMISSIONS = {
    owner: null, // الكل
    front_desk: [
      'property.read', 'units.read', 'rates.read', 'guests.read', 'guests.write',
      'reservations.read', 'reservations.write', 'reservations.checkin', 'reservations.cancel',
      'billing.read', 'billing.write', 'billing.shift', 'housekeeping.read', 'housekeeping.write',
      'maintenance.read', 'maintenance.write',
    ],
  };
  const ALL_PERMISSIONS = [
    'property.read', 'property.write', 'users.read', 'users.write', 'units.read', 'units.write', 'rates.read', 'rates.write',
    'guests.read', 'guests.write', 'reservations.read', 'reservations.write', 'reservations.checkin', 'reservations.cancel',
    'billing.read', 'billing.write', 'billing.void', 'billing.shift', 'expenses.read', 'expenses.write',
    'housekeeping.read', 'housekeeping.write', 'housekeeping.manage', 'maintenance.read', 'maintenance.write',
    'reports.read', 'audit.read', 'ical.manage',
  ];
  const STATUS_LABELS = { pending: 'معلّق', confirmed: 'مؤكّد', checked_in: 'مقيم', checked_out: 'غادر', cancelled: 'ملغي', no_show: 'لم يحضر' };
  const HOLDING = ['pending', 'confirmed', 'checked_in'];
  const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  const ok = (data, o) => ({ status: (o && o.status) || 200, body: { success: true, data: data === undefined ? null : data, ...(o && o.meta ? { meta: o.meta } : {}) } });
  const created = (data) => ok(data, { status: 201 });
  const noContent = () => ({ status: 204, body: null });
  const fail = (status, message, code, errors) => ({ status, body: { success: false, message, code: code || null, errors: errors || null } });
  const pageMeta = (page, size, total) => ({ page, page_size: size, total, total_pages: Math.max(1, Math.ceil(total / size)) });

  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const diffDays = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / DAY);
  const eachNight = (a, b) => { const out = []; for (let d = a; d < b; d = addDays(d, 1)) out.push(d); return out; };
  const weekday = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const iso = (ms) => new Date(ms).toISOString();

  /* ---------- بيانات البداية ---------- */

  function seed(db, H) {
    const now = H.now();
    const t = H.localDay(0);
    db.session = null;

    db.users = [
      { id: 1, uuid: 'u-1', full_name: 'ياسر حسن', email: 'owner@nozol.demo', phone: '01001110001', role: 'owner', preferred_lang: 'ar', must_change_password: 0, password: DEMO_PASSWORD, organization_id: 1, organization_name: 'مجموعة النيل للضيافة' },
      { id: 2, uuid: 'u-2', full_name: 'ريم فؤاد', email: 'frontdesk@nozol.demo', phone: '01001110002', role: 'front_desk', preferred_lang: 'ar', must_change_password: 0, password: DEMO_PASSWORD, organization_id: 1, organization_name: 'مجموعة النيل للضيافة' },
    ];

    db.properties = [{
      id: 1, uuid: 'p-1', organization_id: 1, slug: 'nile-hotel', kind: 'hotel', name_ar: 'فندق النيل', name_en: 'Nile Hotel',
      description_ar: 'فندق بوتيك على كورنيش المعادي', description_en: 'A boutique hotel on the Maadi corniche', phone: '02 2380 1000', whatsapp: '01001110000', email: 'stay@nozol.demo',
      address_ar: '١٢ كورنيش النيل، المعادي', address_en: '12 Nile Corniche, Maadi', city: 'القاهرة', governorate: 'القاهرة', latitude: 29.96, longitude: 31.25,
      timezone: 'Africa/Cairo', currency: 'EGP', check_in_time: '14:00:00', check_out_time: '12:00:00', tax_bps: 1400, service_charge_bps: 1200, tax_on_service_charge: 1,
      prices_include_tax: 0, city_fee_per_night_minor: 0, deposit_percent: 30, hold_hours: 24, cancellation_policy_ar: 'إلغاء مجاني قبل ٤٨ ساعة من الوصول.',
      cancellation_policy_en: 'Free cancellation up to 48 hours before arrival.', free_cancel_hours: 48, invoice_prefix: 'INV', booking_prefix: 'NIL', public_booking_enabled: 1, status: 'active',
      created_at: iso(now - 90 * DAY), updated_at: iso(now - DAY),
    }];

    db.unitTypes = [
      { id: 1, property_id: 1, code: 'STD', name_ar: 'غرفة مزدوجة قياسية', name_en: 'Standard Double', description_ar: 'سريران أو سرير مزدوج، إطلالة على الحديقة', description_en: null, kind: 'room', base_adults: 2, free_children: 1, max_adults: 2, max_children: 1, max_occupancy: 3, bedrooms: 1, beds: 2, size_sqm: 28, base_price_minor: 120000, extra_adult_minor: 25000, extra_child_minor: 10000, amenities: ['wifi', 'ac', 'tv'], sort_order: 1, is_active: 1 },
      { id: 2, property_id: 1, code: 'DLX', name_ar: 'غرفة ديلوكس', name_en: 'Deluxe Room', description_ar: 'غرفة واسعة بشرفة وإطلالة على النيل', description_en: null, kind: 'room', base_adults: 2, free_children: 1, max_adults: 3, max_children: 2, max_occupancy: 4, bedrooms: 1, beds: 2, size_sqm: 38, base_price_minor: 185000, extra_adult_minor: 30000, extra_child_minor: 12000, amenities: ['wifi', 'ac', 'tv', 'balcony'], sort_order: 2, is_active: 1 },
      { id: 3, property_id: 1, code: 'STE', name_ar: 'جناح عائلي', name_en: 'Family Suite', description_ar: 'غرفتا نوم وصالة ومطبخ صغير', description_en: null, kind: 'suite', base_adults: 4, free_children: 2, max_adults: 5, max_children: 3, max_occupancy: 6, bedrooms: 2, beds: 4, size_sqm: 72, base_price_minor: 320000, extra_adult_minor: 35000, extra_child_minor: 15000, amenities: ['wifi', 'ac', 'tv', 'kitchenette', 'balcony'], sort_order: 3, is_active: 1 },
    ];
    const unitPlan = [[1, [101, 102, 103, 104], 1], [2, [201, 202, 203, 204, 205], 2], [3, [301, 302, 303], 3]];
    db.units = [];
    unitPlan.forEach(([typeId, codes, floor]) => codes.forEach((code, i) => {
      db.units.push({ id: db.units.length + 1, property_id: 1, unit_type_id: typeId, code: String(code), floor, notes: null, status: 'active', housekeeping_status: 'clean', housekeeping_updated_at: iso(now - 3600000), sort_order: db.units.length + 1 });
    }));
    db.ratePlans = [
      { id: 1, property_id: 1, code: 'RO', name_ar: 'سعر الغرفة فقط', name_en: 'Room only', meal_plan: 'room_only', meal_adult_minor: 0, meal_child_minor: 0, discount_bps: 0, is_refundable: 1, is_default: 1, is_public: 1, is_active: 1, sort_order: 1 },
      { id: 2, property_id: 1, code: 'BB', name_ar: 'شامل الإفطار', name_en: 'Bed & breakfast', meal_plan: 'breakfast', meal_adult_minor: 15000, meal_child_minor: 8000, discount_bps: 0, is_refundable: 1, is_default: 0, is_public: 1, is_active: 1, sort_order: 2 },
      { id: 3, property_id: 1, code: 'NR', name_ar: 'غير قابل للاسترداد', name_en: 'Non-refundable', meal_plan: 'room_only', meal_adult_minor: 0, meal_child_minor: 0, discount_bps: 1000, is_refundable: 0, is_default: 0, is_public: 1, is_active: 1, sort_order: 3 },
    ];
    db.promos = [
      { id: 1, property_id: 1, code: 'WELCOME10', description: 'خصم ١٠٪ للنزلاء الجدد', discount_type: 'percent', value: 1000, valid_from: addDays(t, -60), valid_to: addDays(t, 120), min_nights: 2, max_uses: null, uses_count: 6, is_active: 1 },
      { id: 2, property_id: 1, code: 'EID2025', description: 'عرض العيد (منتهي)', discount_type: 'percent', value: 1500, valid_from: addDays(t, -400), valid_to: addDays(t, -300), min_nights: 1, max_uses: null, uses_count: 31, is_active: 1 },
    ];
    db.services = [
      { id: 1, property_id: 1, name_ar: 'إفطار إضافي', name_en: 'Extra breakfast', price_minor: 15000, taxable: 1, service_chargeable: 1, is_active: 1, sort_order: 1 },
      { id: 2, property_id: 1, name_ar: 'تنظيف ملابس', name_en: 'Laundry', price_minor: 8000, taxable: 1, service_chargeable: 1, is_active: 1, sort_order: 2 },
      { id: 3, property_id: 1, name_ar: 'نقل من المطار', name_en: 'Airport transfer', price_minor: 60000, taxable: 1, service_chargeable: 0, is_active: 1, sort_order: 3 },
      { id: 4, property_id: 1, name_ar: 'سرير إضافي', name_en: 'Extra bed', price_minor: 25000, taxable: 1, service_chargeable: 1, is_active: 1, sort_order: 4 },
      { id: 5, property_id: 1, name_ar: 'ميني بار', name_en: 'Minibar', price_minor: 12000, taxable: 1, service_chargeable: 1, is_active: 1, sort_order: 5 },
    ];

    const names = ['أحمد سمير', 'منى عبد الله', 'خالد يوسف', 'هبة مصطفى', 'عمر الشريف', 'نورهان سعيد', 'كريم فاروق', 'سلمى جمال', 'محمود رشدي', 'دعاء إبراهيم', 'طارق منصور', 'ياسمين عادل', 'حسام الدين', 'رنا خليل', 'مصطفى كامل', 'آية محسن', 'إيهاب لطفي', 'فاطمة الزهراء', 'Sarah Miller', 'John Carter', 'Lena Weber', 'Pierre Dubois', 'عبد الرحمن صلاح', 'جيهان نصر', 'وليد حمدي', 'شيماء رضا'];
    db.guests = names.map((n, i) => {
      const foreign = /^[A-Z]/.test(n);
      return {
        id: i + 1, property_id: 1, full_name: n, phone: '+2010' + String(1000000 + H.hash('g' + i) * 7).slice(0, 8), email: foreign ? n.toLowerCase().replace(' ', '.') + '@mail.test' : null,
        nationality: foreign ? ['GB', 'US', 'DE', 'FR'][i % 4] : 'EG', id_type: foreign ? 'passport' : 'national_id', id_number: i % 4 === 3 ? null : String(29000000000000 + i * 7919),
        birth_date: null, address: null, notes: null, is_vip: i === 4 || i === 18 ? 1 : 0, is_blacklisted: 0, total_stays: 1 + (i % 5), total_spent_minor: 0,
        created_at: iso(now - (60 - i) * DAY), updated_at: iso(now - i * DAY),
      };
    });

    db.reservations = [];
    db.segments = [];
    db.nights = [];
    db.items = [];
    db.payments = [];
    db.invoices = [];
    db.blocks = [];
    db.seq = { res: 0, seg: 0, item: 0, pay: 0, inv: 0, block: 0, guest: db.guests.length, maint: 0, unit: db.units.length, type: 3 };

    // حجوزات: لكل وحدة سلسلة إقامات متتالية بفجوات
    const sources = ['walk_in', 'phone', 'website', 'booking_com', 'whatsapp'];
    db.units.forEach((unit) => {
      let cursor = addDays(t, -16 + (H.hash('c' + unit.id) % 4));
      let n = 0;
      const unitType = db.unitTypes.find((x) => x.id === unit.unit_type_id);
      // حالات ثابتة عشان شاشة "النهارده" تبان حيّة: مغادرات النهارده، تأخّر مغادرة، ووصولات النهارده
      const fixed = { 1: [-2, 0], 2: [-3, 0], 3: [-4, -1] }[unit.id];
      if (fixed) {
        createStay(db, H, { guest: db.guests[unit.id * 3], unit, type: unitType, plan: db.ratePlans[unit.id % 3], checkIn: addDays(t, fixed[0]), checkOut: addDays(t, fixed[1]), adults: 2, children: 0, status: 'checked_in', source: 'walk_in', seedMode: true });
        cursor = addDays(t, fixed[1] + 1);
        n = 1;
      }
      const arrivesToday = [5, 6, 7].includes(unit.id);
      if (arrivesToday) cursor = t;
      while (cursor < addDays(t, 24) && n < 10) {
        n += 1;
        const gap = arrivesToday && n === 1 ? 0 : H.hash('gap' + unit.id + n) % 3;
        const nights = 1 + (H.hash('n' + unit.id + n) % 5);
        const checkIn = addDays(cursor, gap);
        const checkOut = addDays(checkIn, nights);
        cursor = checkOut;
        if (!(arrivesToday && n === 1) && H.hash('skip' + unit.id + n) % 100 < 34) continue; // فترة فاضية
        let status;
        if (checkOut <= t) status = 'checked_out';
        else if (checkIn <= t && !(arrivesToday && n === 1)) status = 'checked_in';
        else status = H.hash('st' + unit.id + n) % 100 < 18 && !(arrivesToday && n === 1) ? 'pending' : 'confirmed';
        const guest = db.guests[H.hash('guest' + unit.id + n) % db.guests.length];
        const type = db.unitTypes.find((x) => x.id === unit.unit_type_id);
        const adults = Math.min(type.max_adults, 1 + (H.hash('a' + unit.id + n) % 3));
        const children = H.hash('ch' + unit.id + n) % 4 === 0 ? 1 : 0;
        const plan = db.ratePlans[H.hash('rp' + unit.id + n) % 3];
        createStay(db, H, { guest, unit, type, plan, checkIn, checkOut, adults, children, status, source: sources[H.hash('src' + unit.id + n) % sources.length], seedMode: true });
      }
    });
    // إلغاءات وعدم حضور قديمة (من غير ما تحجز ليالي)
    [['cancelled', 3], ['no_show', 9], ['cancelled', 14]].forEach(([status, back], i) => {
      const unit = db.units[i * 3];
      const type = db.unitTypes.find((x) => x.id === unit.unit_type_id);
      const r = createStay(db, H, { guest: db.guests[10 + i], unit, type, plan: db.ratePlans[0], checkIn: addDays(t, -back), checkOut: addDays(t, -back + 2), adults: 2, children: 0, status, source: 'phone', seedMode: true, noNights: true });
      r.cancelled_at = iso(now - (back + 1) * DAY);
      r.cancel_reason = status === 'no_show' ? 'لم يحضر' : 'تغيّرت خطط السفر';
    });

    // حجوزات تتحجب
    db.blocks.push({ id: ++db.seq.block, property_id: 1, unit_id: 4, start_date: addDays(t, 2), end_date: addDays(t, 5), reason: 'maintenance', note: 'تغيير مكيّف', external_uid: null, ical_feed_id: null, created_at: iso(now) });
    db.blocks.push({ id: ++db.seq.block, property_id: 1, unit_id: 12, start_date: addDays(t, 6), end_date: addDays(t, 8), reason: 'owner_use', note: null, external_uid: null, ical_feed_id: null, created_at: iso(now) });

    // حالة النظافة: الغرف اللي فيها نزلاء مقيمين نضيفة؛ جزء من الباقي متّسخ
    db.units.forEach((u, i) => { if (i % 5 === 3) u.housekeeping_status = 'dirty'; if (i % 7 === 2) u.housekeeping_status = 'inspected'; });

    db.maintenance = [
      { id: ++db.seq.maint, property_id: 1, unit_id: 4, title: 'تغيير مكيّف الغرفة', description: 'يسرّب مياه', priority: 'high', status: 'in_progress', reported_by: 2, assigned_to: null, cost_minor: 0, resolved_at: null, created_at: iso(now - DAY), updated_at: iso(now - DAY) },
      { id: ++db.seq.maint, property_id: 1, unit_id: 7, title: 'مصباح الحمّام', description: null, priority: 'low', status: 'open', reported_by: 2, assigned_to: null, cost_minor: 0, resolved_at: null, created_at: iso(now - 2 * DAY), updated_at: iso(now - 2 * DAY) },
    ];
    db.shift = { id: 1, property_id: 1, user_id: 1, opened_at: iso(now - 5 * 3600000), closed_at: null, opening_cash_minor: 500000, user_name: 'ياسر حسن' };
  }

  /* ---------- التسعير ---------- */

  function nightlyRoom(type, plan, date) {
    let price = type.base_price_minor;
    const dow = weekday(date);
    if (dow === 4 || dow === 5) price = Math.round(price * 1.15); // قاعدة الخميس والجمعة
    if (plan && plan.discount_bps) price = Math.round(price * (1 - plan.discount_bps / 10000));
    return price;
  }

  function priceStay(type, plan, checkIn, checkOut, adults, children) {
    const extraAdults = Math.max(0, adults - type.base_adults);
    const chargeableChildren = Math.max(0, children - type.free_children);
    const extra = extraAdults * type.extra_adult_minor + chargeableChildren * type.extra_child_minor;
    const meal = plan ? adults * plan.meal_adult_minor + children * plan.meal_child_minor : 0;
    const nights = eachNight(checkIn, checkOut).map((date) => ({ date, room_minor: nightlyRoom(type, plan, date), extra_guest_minor: extra, meal_minor: meal }));
    const violations = [];
    if (adults > type.max_adults) violations.push({ code: 'OVER_CAPACITY', message: 'أقصى عدد بالغين ' + type.max_adults });
    if (children > type.max_children) violations.push({ code: 'OVER_CAPACITY', message: 'أقصى عدد أطفال ' + type.max_children });
    const n = diffDays(checkIn, checkOut);
    // قاعدة: الوصول يوم الخميس يحتاج ليلتين على الأقل
    const minStay = weekday(checkIn) === 4 ? 2 : 1;
    if (n < minStay) violations.push({ code: 'MIN_STAY', message: 'الحد الأدنى للإقامة ' + minStay + ' ليالي للوصول في هذا اليوم' });
    return { nights, rooms_minor: sum(nights.map((x) => x.room_minor)), extra_guest_minor: sum(nights.map((x) => x.extra_guest_minor)), meal_minor: sum(nights.map((x) => x.meal_minor)), violations, min_stay: minStay };
  }

  function computeTotals(property, { rooms, extra, meal, extras, discount, unitNights }) {
    const net = Math.max(0, rooms + extra + meal + extras - discount);
    const service = Math.round((net * property.service_charge_bps) / 10000);
    const taxBase = net + (property.tax_on_service_charge ? service : 0);
    const tax = Math.round((taxBase * property.tax_bps) / 10000);
    const city = (property.city_fee_per_night_minor || 0) * (unitNights || 0);
    return {
      subtotal_minor: net, service_charge_minor: service, tax_minor: tax, city_fee_minor: city, total_minor: net + service + tax + city,
      breakdown: { rooms_minor: rooms, extra_guest_minor: extra, meal_minor: meal, extras_minor: extras, discount_minor: discount },
    };
  }

  const depositDue = (total, pct) => Math.round((total * (pct || 0)) / 100);

  /* ---------- إنشاء إقامة (للبيانات الأولية وللحجز الجديد) ---------- */

  function codeFor(db, property) {
    return property.booking_prefix + '-' + String(++db.seq.res).padStart(4, '0');
  }

  function createStay(db, H, o) {
    const property = db.properties[0];
    const stay = priceStay(o.type, o.plan, o.checkIn, o.checkOut, o.adults, o.children);
    const nightsN = diffDays(o.checkIn, o.checkOut);
    const promoDiscount = o.promo ? Math.min(stay.rooms_minor + stay.extra_guest_minor, o.promo.discount_type === 'percent' ? Math.round(((stay.rooms_minor + stay.extra_guest_minor) * o.promo.value) / 10000) : o.promo.value) : 0;
    const totals = computeTotals(property, { rooms: stay.rooms_minor, extra: stay.extra_guest_minor, meal: stay.meal_minor, extras: 0, discount: promoDiscount, unitNights: nightsN });
    const id = db.reservations.length + 1;
    let publicCode = '';
    for (let i = 0; i < 8; i += 1) publicCode += CODE_ALPHABET[(H.hash('pc' + id + i) + i) % 32];
    const nowMs = H.now();
    const r = {
      id, property_id: 1, code: codeFor(db, property), public_code: publicCode, guest_id: o.guest.id, status: o.status, source: o.source || 'walk_in', external_ref: null,
      check_in: o.checkIn, check_out: o.checkOut, nights: nightsN, adults: o.adults, children: o.children, rate_plan_id: o.plan ? o.plan.id : null, promo_code_id: o.promo ? o.promo.id : null,
      currency: property.currency, rooms_minor: stay.rooms_minor, extra_guest_minor: stay.extra_guest_minor, meal_minor: stay.meal_minor, extras_minor: 0, discount_minor: promoDiscount,
      service_charge_minor: totals.service_charge_minor, tax_minor: totals.tax_minor, city_fee_minor: totals.city_fee_minor, total_minor: totals.total_minor, paid_minor: 0,
      deposit_due_minor: depositDue(totals.total_minor, property.deposit_percent), hold_expires_at: o.status === 'pending' ? iso(nowMs + 20 * 3600000) : null,
      expected_arrival: o.expectedArrival || (o.status === 'confirmed' || o.status === 'pending' ? '15:00:00' : null), guest_notes: o.guestNotes || null, internal_notes: o.internalNotes || null,
      checked_in_at: ['checked_in', 'checked_out'].includes(o.status) ? iso(Date.parse(o.checkIn + 'T12:30:00Z')) : null,
      checked_out_at: o.status === 'checked_out' ? iso(Date.parse(o.checkOut + 'T09:30:00Z')) : null, cancelled_at: null, cancel_reason: null, created_by: 2,
      created_at: iso(Date.parse(o.checkIn + 'T00:00:00Z') - (3 + (H.hash('cr' + id) % 12)) * DAY), updated_at: iso(nowMs),
    };
    db.reservations.push(r);
    const seg = { id: ++db.seq.seg, reservation_id: id, line_no: 0, unit_id: o.unit.id, unit_type_id: o.type.id, check_in: o.checkIn, check_out: o.checkOut, adults: o.adults, children: o.children, rate_plan_id: o.plan ? o.plan.id : null, rooms_minor: stay.rooms_minor, extra_guest_minor: stay.extra_guest_minor, meal_minor: stay.meal_minor };
    db.segments.push(seg);
    stay.nights.forEach((n) => db.nights.push({ reservation_unit_id: seg.id, ...n }));

    if (o.seedMode) {
      // إضافات ودفعات منطقية لحالة الحجز
      const inHouse = o.status === 'checked_in';
      const done = o.status === 'checked_out';
      if ((inHouse || done) && H.hash('svc' + id) % 3 !== 0) addItem(db, H, r, { type: 'service', service_id: 1 + (H.hash('s' + id) % 5), quantity: 1 + (H.hash('q' + id) % 2) });
      recalc(db, r);
      const payAt = (amount, method, daysBefore) => db.payments.push({ id: ++db.seq.pay, property_id: 1, reservation_id: id, type: 'payment', method, amount_minor: amount, reference: null, note: null, received_at: iso(nowMs - daysBefore * DAY), received_by: 2, received_by_name: 'ريم فؤاد', shift_id: 1, voided_at: null, voided_by: null, void_reason: null, created_at: iso(nowMs) });
      if (done || (inHouse && H.hash('pd' + id) % 3 === 0)) payAt(r.total_minor, ['cash', 'card', 'bank_transfer'][H.hash('m' + id) % 3], 1);
      else if (inHouse || o.status === 'confirmed') payAt(Math.min(r.total_minor, r.deposit_due_minor || 0), 'card', 3);
      recalc(db, r);
      if (done && H.hash('inv' + id) % 2 === 0) issueInvoice(db, r, { bill_to_name: o.guest.full_name });
    }
    return r;
  }

  function addItem(db, H, r, item) {
    const service = item.service_id ? db.services.find((s) => s.id === item.service_id) : null;
    const row = {
      id: ++db.seq.item, property_id: 1, reservation_id: r.id, type: item.type, service_id: service ? service.id : null,
      description: item.description || (service ? service.name_ar : 'بند'), quantity: item.quantity || 1,
      unit_price_minor: item.type === 'discount' ? -item.amount_minor : service ? service.price_minor : item.unit_price_minor || item.amount_minor || 0,
      amount_minor: 0, taxable: service ? service.taxable : item.taxable === false ? 0 : 1, service_chargeable: service ? service.service_chargeable : item.service_chargeable === false ? 0 : 1,
      posted_on: H.localDay(0), posted_by: 2, posted_by_name: 'ريم فؤاد', voided_at: null, voided_by: null, void_reason: null, created_at: iso(H.now()),
    };
    row.amount_minor = item.type === 'discount' ? -item.amount_minor : Math.round(row.unit_price_minor * row.quantity);
    if (item.type === 'fee') { row.quantity = 1; row.unit_price_minor = item.amount_minor; row.amount_minor = item.amount_minor; }
    db.items.push(row);
    return row;
  }

  function recalc(db, r) {
    const property = db.properties[0];
    const segs = db.segments.filter((s) => s.reservation_id === r.id);
    const rooms = sum(segs.map((s) => s.rooms_minor));
    const extra = sum(segs.map((s) => s.extra_guest_minor));
    const meal = sum(segs.map((s) => s.meal_minor));
    const live = db.items.filter((i) => i.reservation_id === r.id && !i.voided_at);
    const extras = sum(live.filter((i) => i.type !== 'discount').map((i) => i.amount_minor));
    const itemDiscount = -sum(live.filter((i) => i.type === 'discount').map((i) => i.amount_minor));
    const promoPart = r.promo_code_id ? Math.min(rooms + extra, Math.round(((rooms + extra) * (db.promos.find((p) => p.id === r.promo_code_id) || { value: 0 }).value) / 10000)) : 0;
    const nightsN = sum(segs.map((s) => diffDays(s.check_in, s.check_out)));
    const totals = computeTotals(property, { rooms, extra, meal, extras, discount: promoPart + itemDiscount, unitNights: nightsN });
    r.rooms_minor = rooms; r.extra_guest_minor = extra; r.meal_minor = meal; r.extras_minor = extras; r.discount_minor = promoPart + itemDiscount;
    r.service_charge_minor = totals.service_charge_minor; r.tax_minor = totals.tax_minor; r.city_fee_minor = totals.city_fee_minor; r.total_minor = totals.total_minor;
    r.paid_minor = sum(db.payments.filter((p) => p.reservation_id === r.id && !p.voided_at).map((p) => (p.type === 'payment' ? p.amount_minor : -p.amount_minor)));
    r.nights = diffDays(r.check_in, r.check_out);
    r.updated_at = iso(Date.now());
    return totals;
  }

  function issueInvoice(db, r, input) {
    recalc(db, r);
    const inv = {
      id: ++db.seq.inv, property_id: 1, reservation_id: r.id, number: 'INV-' + String(db.seq.inv).padStart(5, '0'), status: 'issued', bill_to_name: input.bill_to_name || null,
      bill_to_tax_id: input.bill_to_tax_id || null, bill_to_address: input.bill_to_address || null, subtotal_minor: r.rooms_minor + r.extra_guest_minor + r.meal_minor + r.extras_minor - r.discount_minor,
      discount_minor: r.discount_minor, service_charge_minor: r.service_charge_minor, tax_minor: r.tax_minor, city_fee_minor: r.city_fee_minor, total_minor: r.total_minor, paid_minor: r.paid_minor,
      lines_json: [], issued_at: iso(Date.now()), issued_by: 2, voided_at: null, void_reason: null,
    };
    db.invoices.push(inv);
    return inv;
  }

  /* ---------- القراءة ---------- */

  function handle(req, db, H) {
    const { method, path, query, body } = req;
    const b = body || {};
    const t = H.localDay(0);
    const property = db.properties[0];
    const user = db.session ? db.users.find((u) => u.id === db.session.userId) : null;
    const num = (v, d) => (v === undefined || v === '' || v === null ? d : Number(v));
    const permsOf = (u) => (ROLE_PERMISSIONS[u.role] || ALL_PERMISSIONS);
    const publicUser = (u) => ({
      id: u.id, uuid: u.uuid, full_name: u.full_name, email: u.email, phone: u.phone, role: u.role, preferred_lang: u.preferred_lang, must_change_password: Boolean(u.must_change_password),
      organization: { id: u.organization_id, name: u.organization_name }, permissions: permsOf(u),
      properties: db.properties.filter((p) => p.status === 'active').map((p) => ({ id: p.id, slug: p.slug, kind: p.kind, name_ar: p.name_ar, name_en: p.name_en, currency: p.currency, timezone: p.timezone, public_booking_enabled: p.public_booking_enabled })),
    });
    const session = (u) => ({ user: publicUser(u), tokens: { access_token: 'demo.' + u.id + '.' + H.code(16), token_type: 'Bearer', expires_in: 900 } });

    /* --- المصادقة --- */
    if (method === 'POST' && path === '/auth/login') {
      const email = String(b.email || '').trim().toLowerCase();
      const u = db.users.find((x) => x.email === email);
      if (!u || u.password !== String(b.password)) return fail(401, 'البريد أو كلمة المرور غير صحيحة', 'BAD_CREDENTIALS');
      db.session = { userId: u.id };
      return ok(session(u));
    }
    if (method === 'POST' && path === '/auth/refresh') {
      if (!user) return fail(401, 'مفيش جلسة — سجّل الدخول', 'NO_SESSION');
      return ok(session(user));
    }
    if (method === 'POST' && path === '/auth/logout') { db.session = null; return noContent(); }
    if (method === 'POST' && (path === '/auth/forgot-password' || path === '/auth/reset-password')) return noContent();
    if (!user) return fail(401, 'سجّل الدخول أولًا', 'NO_TOKEN');
    if (method === 'GET' && path === '/auth/me') return ok(publicUser(user));
    if (method === 'POST' && path === '/auth/change-password') {
      if (user.password !== String(b.current_password)) return fail(401, 'كلمة المرور الحالية غير صحيحة', 'BAD_CREDENTIALS');
      user.password = String(b.new_password);
      user.must_change_password = 0;
      return ok(session(user));
    }

    /* --- المنشآت (إعداد أولي) --- */
    if (method === 'GET' && path === '/properties') return ok(publicUser(user).properties);
    if (method === 'POST' && path === '/properties') {
      const slug = String(b.slug || b.name_en || b.name_ar || 'property').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'property-' + H.code(4);
      const p = { ...property, id: Math.max(...db.properties.map((x) => x.id)) + 1, uuid: 'p-new', slug: slug + '-' + (db.properties.length + 1), name_ar: b.name_ar || 'منشأة جديدة', name_en: b.name_en || null, kind: b.kind || 'hotel', status: 'active', created_at: iso(H.now()) };
      db.properties.push(p);
      return created(p);
    }

    let m = /^\/properties\/(\d+)(\/.*)?$/.exec(path);
    if (!m) return null;
    const pid = Number(m[1]);
    const prop = db.properties.find((p) => p.id === pid);
    if (!prop) return fail(404, 'المنشأة غير موجودة', 'PROPERTY_NOT_FOUND');
    const sub = m[2] || '';
    const isDemoProperty = pid === property.id;
    const can = (perm) => permsOf(user).includes(perm);
    const need = (perm) => (can(perm) ? null : fail(403, 'مفيش صلاحية للعملية دي', 'FORBIDDEN'));
    const typeOf = (id) => db.unitTypes.find((x) => x.id === id);
    const unitOf = (id) => db.units.find((x) => x.id === id);
    const guestOf = (id) => db.guests.find((x) => x.id === id);
    const planOf = (id) => db.ratePlans.find((x) => x.id === id);

    if (method === 'GET' && sub === '') return ok(prop);
    if (method === 'PATCH' && sub === '') { const g = need('property.write'); if (g) return g; Object.keys(b).forEach((k) => { if (k in prop) prop[k] = b[k]; }); return ok(prop); }

    /* منشأة جديدة من الـ onboarding: أنواع ووحدات */
    if (!isDemoProperty && method === 'POST' && sub === '/unit-types') {
      const tp = { id: ++db.seq.type + 100, property_id: pid, code: b.code || 'T' + db.seq.type, name_ar: b.name_ar, name_en: b.name_en || null, kind: b.kind || 'room', base_adults: b.base_adults || 2, free_children: b.free_children || 0, max_adults: b.max_adults || 2, max_children: b.max_children || 0, max_occupancy: b.max_occupancy || 2, bedrooms: 1, beds: 1, size_sqm: null, base_price_minor: b.base_price_minor || 100000, extra_adult_minor: b.extra_adult_minor || 0, extra_child_minor: b.extra_child_minor || 0, amenities: [], sort_order: 1, is_active: 1 };
      db.unitTypes.push(tp);
      return created(tp);
    }
    if (!isDemoProperty && method === 'POST' && sub === '/units/bulk') {
      const out = [];
      (b.codes || []).forEach((c) => { const u = { id: ++db.seq.unit + 100, property_id: pid, unit_type_id: b.unit_type_id, code: String(c), floor: b.floor || 1, notes: null, status: 'active', housekeeping_status: 'clean', housekeeping_updated_at: iso(H.now()), sort_order: db.seq.unit }; db.units.push(u); out.push(u); });
      return created(out);
    }
    // الباقي يخص المنشأة التجريبية فقط
    if (!isDemoProperty) {
      if (method === 'GET' && (sub === '/reports/today' || sub.startsWith('/reservations') || sub === '/calendar')) return ok(sub === '/calendar' ? { from: query.from, to: query.to, today: t, units: [], stays: [], blocks: [] } : sub === '/reports/today' ? emptyToday(t) : []);
    }

    /* --- مرجعيات --- */
    if (method === 'GET' && sub === '/unit-types') return ok(db.unitTypes.filter((x) => x.property_id === pid && (query.active !== 'true' || x.is_active)).sort((a, c) => a.sort_order - c.sort_order));
    if (method === 'GET' && sub === '/services') return ok(db.services.filter((s) => s.property_id === pid && s.is_active));
    if (method === 'GET' && sub === '/shifts/current') return ok(user.role === 'owner' || can('billing.shift') ? db.shift : null);
    if (method === 'GET' && sub === '/maintenance') {
      let list = db.maintenance.filter((x) => x.property_id === pid);
      if (query.open === 'true') list = list.filter((x) => ['open', 'in_progress', 'waiting_parts'].includes(x.status));
      return ok(list.map((x) => ({ ...x, unit_code: (unitOf(x.unit_id) || {}).code })));
    }
    if (method === 'GET' && sub === '/rate-plans') return ok(db.ratePlans);

    /* --- النزلاء --- */
    if (method === 'GET' && sub === '/guests') {
      const q = String(query.q || '').toLowerCase();
      const digits = q.replace(/\D/g, '');
      let list = db.guests.filter((g) => !g.deleted_at && (!q || g.full_name.toLowerCase().includes(q) || (g.email || '').toLowerCase().includes(q) || (digits.length >= 4 && (g.phone || '').replace(/\D/g, '').includes(digits))));
      if (query.vip) list = list.filter((g) => Boolean(g.is_vip) === (query.vip === 'true'));
      const size = Math.min(num(query.page_size, 25), 100);
      const page = Math.max(num(query.page, 1), 1);
      return ok(list.slice((page - 1) * size, page * size), { meta: pageMeta(page, size, list.length) });
    }
    if (method === 'POST' && sub === '/guests') {
      if (!b.full_name) return fail(422, 'اكتب اسم النزيل', 'VALIDATION', { full_name: 'مطلوب' });
      const g = { id: ++db.seq.guest, property_id: pid, full_name: b.full_name, phone: b.phone || null, email: b.email || null, nationality: b.nationality || null, id_type: b.id_type || null, id_number: b.id_number || null, birth_date: null, address: null, notes: null, is_vip: 0, is_blacklisted: 0, total_stays: 0, total_spent_minor: 0, created_at: iso(H.now()), updated_at: iso(H.now()) };
      db.guests.push(g);
      return created(g);
    }
    m = /^\/guests\/(\d+)$/.exec(sub);
    if (m && method === 'GET') {
      const g = guestOf(Number(m[1]));
      if (!g) return fail(404, 'النزيل غير موجود');
      return ok({ ...g, reservations: db.reservations.filter((r) => r.guest_id === g.id).sort((a, c) => (a.check_in < c.check_in ? 1 : -1)).slice(0, 20).map((r) => ({ id: r.id, code: r.code, status: r.status, check_in: r.check_in, check_out: r.check_out, nights: r.nights, total_minor: r.total_minor, paid_minor: r.paid_minor, source: r.source })) });
    }
    if (m && method === 'PATCH') {
      const g = guestOf(Number(m[1]));
      if (!g) return fail(404, 'النزيل غير موجود');
      Object.keys(b).forEach((k) => { if (k in g && k !== 'id') g[k] = b[k]; });
      return ok(g);
    }

    /* --- التوافر والتقويم --- */
    const occupiedUnits = (checkIn, checkOut, excludeResId) => {
      const busy = new Set();
      db.segments.forEach((s) => {
        const r = db.reservations.find((x) => x.id === s.reservation_id);
        if (!r || !HOLDING.includes(r.status) || r.id === excludeResId) return;
        if (s.check_in < checkOut && s.check_out > checkIn) busy.add(s.unit_id);
      });
      db.blocks.forEach((bl) => { if (bl.start_date < checkOut && bl.end_date > checkIn) busy.add(bl.unit_id); });
      return busy;
    };
    const freeUnits = (typeId, checkIn, checkOut, excludeResId) => {
      const busy = occupiedUnits(checkIn, checkOut, excludeResId);
      return db.units.filter((u) => u.property_id === pid && u.unit_type_id === typeId && u.status === 'active' && !busy.has(u.id)).sort((a, c) => a.sort_order - c.sort_order);
    };
    function stayErrors(checkIn, checkOut) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn || '') || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut || '')) return fail(422, 'التواريخ مش مكتوبة صح', 'VALIDATION');
      if (checkOut <= checkIn) return fail(422, 'تاريخ المغادرة لازم يكون بعد الوصول', 'VALIDATION', { check_out: 'بعد الوصول' });
      return null;
    }
    const typeSummary = (tp) => ({ id: tp.id, code: tp.code, kind: tp.kind, name_ar: tp.name_ar, name_en: tp.name_en, description_ar: tp.description_ar, description_en: tp.description_en, base_adults: tp.base_adults, max_adults: tp.max_adults, max_children: tp.max_children, max_occupancy: tp.max_occupancy, bedrooms: tp.bedrooms, beds: tp.beds, size_sqm: tp.size_sqm, amenities: tp.amenities, photos: [] });
    const planBrief = (pl) => (pl ? { id: pl.id, code: pl.code, name_ar: pl.name_ar, name_en: pl.name_en, meal_plan: pl.meal_plan, is_refundable: Boolean(pl.is_refundable) } : null);
    function promoCheck(code, checkIn, checkOut) {
      if (!code) return { info: null, promo: null };
      const p = db.promos.find((x) => x.code === String(code).toUpperCase() && x.property_id === pid);
      if (!p || !p.is_active) return { info: { code: String(code).toUpperCase(), valid: false, reason: 'PROMO_INVALID', message: 'كود الخصم غير صالح', discount_minor: 0 }, promo: null };
      if ((p.valid_from && t < p.valid_from) || (p.valid_to && t > p.valid_to)) return { info: { code: p.code, valid: false, reason: 'PROMO_EXPIRED', message: 'كود الخصم منتهي أو لم يبدأ بعد', discount_minor: 0 }, promo: null };
      if (p.min_nights && diffDays(checkIn, checkOut) < p.min_nights) return { info: { code: p.code, valid: false, reason: 'PROMO_MIN_NIGHTS', message: 'الكود يحتاج ' + p.min_nights + ' ليالي على الأقل', discount_minor: 0 }, promo: null };
      return { info: { code: p.code, valid: true }, promo: p };
    }
    const promoAmount = (promo, base) => (promo ? Math.min(base, promo.discount_type === 'percent' ? Math.round((base * promo.value) / 10000) : promo.value) : 0);

    if (method === 'GET' && sub === '/availability') {
      const err = stayErrors(query.check_in, query.check_out);
      if (err) return err;
      const adults = num(query.adults, 2);
      const children = num(query.children, 0);
      const pc = promoCheck(query.promo_code, query.check_in, query.check_out);
      const plans = db.ratePlans.filter((p) => p.is_active && (!query.rate_plan_id || p.id === Number(query.rate_plan_id)));
      const results = db.unitTypes.filter((x) => x.property_id === pid && x.is_active).sort((a, c) => a.sort_order - c.sort_order).map((tp) => {
        const available = freeUnits(tp.id, query.check_in, query.check_out).length;
        const capacityOk = adults <= tp.max_adults && children <= tp.max_children && adults + children <= tp.max_occupancy;
        if (!available || !capacityOk) return { unit_type: typeSummary(tp), available_units: available, capacity_ok: capacityOk, plans: [] };
        return {
          unit_type: typeSummary(tp), available_units: available, capacity_ok: true,
          plans: plans.map((pl) => {
            const st = priceStay(tp, pl, query.check_in, query.check_out, adults, children);
            const disc = promoAmount(pc.promo, st.rooms_minor + st.extra_guest_minor);
            const totals = computeTotals(prop, { rooms: st.rooms_minor, extra: st.extra_guest_minor, meal: st.meal_minor, extras: 0, discount: disc, unitNights: diffDays(query.check_in, query.check_out) });
            return {
              check_in: query.check_in, check_out: query.check_out, nights: diffDays(query.check_in, query.check_out), units: 1, adults, children,
              unit_type: { id: tp.id, code: tp.code, name_ar: tp.name_ar, name_en: tp.name_en }, rate_plan: planBrief(pl),
              nightly: st.nights.map((n) => ({ date: n.date, room_minor: n.room_minor, extra_guest_minor: n.extra_guest_minor, meal_minor: n.meal_minor })),
              bookable: st.violations.length === 0, violations: st.violations, min_stay: st.min_stay,
              promo: query.promo_code ? { ...(pc.info || {}), discount_minor: disc } : null, totals, deposit_due_minor: depositDue(totals.total_minor, prop.deposit_percent), currency: prop.currency,
            };
          }),
        };
      });
      return ok({ check_in: query.check_in, check_out: query.check_out, nights: diffDays(query.check_in, query.check_out), adults, children, results });
    }
    if (method === 'GET' && sub === '/availability/units') {
      const list = freeUnits(num(query.unit_type_id), query.check_in, query.check_out, num(query.exclude_reservation_id, 0));
      return ok(list.map((u) => ({ id: u.id, code: u.code, floor: u.floor, housekeeping_status: u.housekeeping_status })));
    }
    if (method === 'GET' && sub === '/calendar') {
      const from = query.from;
      const to = query.to;
      if (!from || !to) return fail(422, 'حدّد المدى', 'VALIDATION');
      const end = addDays(to, 1);
      return ok({
        from, to, today: t,
        units: db.units.filter((u) => u.property_id === pid && u.status !== 'archived').sort((a, c) => typeOf(a.unit_type_id).sort_order - typeOf(c.unit_type_id).sort_order || a.sort_order - c.sort_order).map((u) => {
          const tp = typeOf(u.unit_type_id);
          return { id: u.id, code: u.code, floor: u.floor, status: u.status, housekeeping_status: u.housekeeping_status, unit_type_id: u.unit_type_id, unit_type_name_ar: tp.name_ar, unit_type_code: tp.code, type_order: tp.sort_order };
        }),
        stays: db.segments.filter((s) => { const r = db.reservations.find((x) => x.id === s.reservation_id); return r && ['pending', 'confirmed', 'checked_in', 'checked_out'].includes(r.status) && s.check_in < end && s.check_out > from; }).map((s) => {
          const r = db.reservations.find((x) => x.id === s.reservation_id);
          const g = guestOf(r.guest_id);
          return { kind: 'stay', segment_id: s.id, unit_id: s.unit_id, start: s.check_in, end: s.check_out, reservation: { id: r.id, code: r.code, status: r.status, source: r.source, guest_name: g.full_name, is_vip: Boolean(g.is_vip), adults: s.adults, children: s.children, total_minor: r.total_minor, paid_minor: r.paid_minor, check_in: r.check_in, check_out: r.check_out } };
        }),
        blocks: db.blocks.filter((bl) => bl.start_date < end && bl.end_date > from).map((bl) => ({ kind: 'block', block_id: bl.id, unit_id: bl.unit_id, start: bl.start_date, end: bl.end_date, reason: bl.reason, note: bl.note, external: Boolean(bl.ical_feed_id) })),
      });
    }
    m = /^\/units\/(\d+)\/blocks$/.exec(sub);
    if (m && method === 'POST') {
      const g = need('units.write');
      if (g) return g;
      const unit = unitOf(Number(m[1]));
      if (!unit) return fail(404, 'الوحدة غير موجودة');
      if (!b.start_date || !b.end_date || b.end_date <= b.start_date) return fail(422, 'تواريخ الحجب مش صحيحة', 'VALIDATION');
      const busy = db.segments.filter((s) => s.unit_id === unit.id && s.check_in < b.end_date && s.check_out > b.start_date && HOLDING.includes((db.reservations.find((r) => r.id === s.reservation_id) || {}).status));
      if (busy.length) return fail(409, 'الوحدة مشغولة في الفترة دي', 'UNIT_NOT_AVAILABLE', { occupied: busy.map((s) => ({ guest_name: guestOf(db.reservations.find((r) => r.id === s.reservation_id).guest_id).full_name })) });
      const bl = { id: ++db.seq.block, property_id: pid, unit_id: unit.id, start_date: b.start_date, end_date: b.end_date, reason: b.reason || 'maintenance', note: b.note || null, external_uid: null, ical_feed_id: null, created_at: iso(H.now()) };
      db.blocks.push(bl);
      return created(bl);
    }
    m = /^\/blocks\/(\d+)$/.exec(sub);
    if (m && method === 'DELETE') {
      db.blocks = db.blocks.filter((x) => x.id !== Number(m[1]));
      return noContent();
    }

    /* --- تقرير اليوم --- */
    if (method === 'GET' && sub === '/reports/today') {
      const g = need('reservations.read');
      if (g) return g;
      const row = (r) => {
        const guest = guestOf(r.guest_id);
        const segs = db.segments.filter((s) => s.reservation_id === r.id);
        const unitCodes = [...new Set(segs.map((s) => unitOf(s.unit_id).code))].sort().join('، ');
        const notReady = segs.filter((s) => s.check_in <= t && s.check_out > t && !['clean', 'inspected'].includes(unitOf(s.unit_id).housekeeping_status)).length;
        return { id: r.id, code: r.code, status: r.status, check_in: r.check_in, check_out: r.check_out, nights: r.nights, adults: r.adults, children: r.children, total_minor: r.total_minor, paid_minor: r.paid_minor, balance_minor: r.total_minor - r.paid_minor, expected_arrival: r.expected_arrival, hold_expires_at: r.hold_expires_at, guest_name: guest.full_name, guest_phone: guest.phone, is_vip: Boolean(guest.is_vip), unit_codes: unitCodes, units_not_ready: notReady };
      };
      const all = db.reservations;
      const arrivals = all.filter((r) => ['pending', 'confirmed'].includes(r.status) && r.check_in === t).map(row);
      const departures = all.filter((r) => r.status === 'checked_in' && r.check_out === t).map(row);
      const overdue = all.filter((r) => r.status === 'checked_in' && r.check_out < t).map(row);
      const inHouse = all.filter((r) => r.status === 'checked_in' && r.check_out > t).map(row);
      const occupiedSegs = db.segments.filter((s) => { const r = all.find((x) => x.id === s.reservation_id); return r && ['confirmed', 'checked_in', 'checked_out'].includes(r.status) && s.check_in <= t && s.check_out > t; });
      const heldSegs = db.segments.filter((s) => { const r = all.find((x) => x.id === s.reservation_id); return r && r.status === 'pending' && s.check_in <= t && s.check_out > t; });
      const sellable = db.units.filter((u) => u.status === 'active').length;
      const blockedTonight = db.blocks.filter((bl) => bl.start_date <= t && bl.end_date > t).length;
      const available = Math.max(0, sellable - blockedTonight);
      const hk = {};
      db.units.forEach((u) => { hk[u.housekeeping_status] = (hk[u.housekeeping_status] || 0) + 1; });
      const pending = all.filter((r) => r.status === 'pending');
      const open = db.maintenance.filter((x) => ['open', 'in_progress', 'waiting_parts'].includes(x.status));
      const unpaid = all.filter((r) => r.status === 'checked_in' && r.total_minor > r.paid_minor);
      const byMethod = {};
      db.payments.filter((p) => !p.voided_at && p.received_at.slice(0, 10) === t).forEach((p) => { byMethod[p.method] = (byMethod[p.method] || 0) + (p.type === 'payment' ? p.amount_minor : -p.amount_minor); });
      return ok({
        date: t, arrivals, departures, overdue_departures: overdue, in_house: inHouse,
        stats: {
          arrivals: arrivals.length, departures: departures.length, in_house: inHouse.length + departures.length + overdue.length, occupied_tonight: occupiedSegs.length, held_tonight: heldSegs.length,
          available_tonight: available, occupancy_pct: available > 0 ? Math.round((occupiedSegs.length / available) * 1000) / 10 : 0, pending_bookings: pending.length,
          pending_expiring_soon: pending.filter((r) => r.hold_expires_at && new Date(r.hold_expires_at).getTime() < H.now() + 6 * 3600000).length, open_maintenance: open.length,
          urgent_maintenance: open.filter((x) => x.priority === 'urgent').length, unpaid_in_house_minor: sum(unpaid.map((r) => r.total_minor - r.paid_minor)), unpaid_in_house_count: unpaid.length,
        },
        housekeeping: { dirty: hk.dirty || 0, cleaning: hk.cleaning || 0, clean: hk.clean || 0, inspected: hk.inspected || 0 },
        payments_today: Object.keys(byMethod).map((k) => ({ method: k, net_minor: byMethod[k] })),
      });
    }

    /* --- الحجوزات --- */
    const detailOf = (r) => {
      const g = guestOf(r.guest_id);
      const segs = db.segments.filter((s) => s.reservation_id === r.id).sort((a, c) => a.line_no - c.line_no || (a.check_in < c.check_in ? -1 : 1));
      const promo = db.promos.find((p) => p.id === r.promo_code_id);
      return {
        ...r, balance_minor: r.total_minor - r.paid_minor, guest_name: g.full_name, guest_phone: g.phone, guest_email: g.email, guest_nationality: g.nationality, guest_id_type: g.id_type, guest_id_number: g.id_number,
        is_vip: Boolean(g.is_vip), is_blacklisted: Boolean(g.is_blacklisted), rate_plan_name_ar: (planOf(r.rate_plan_id) || {}).name_ar || null, promo_code: promo ? promo.code : null, created_by_name: 'ريم فؤاد',
        segments: segs.map((s) => {
          const u = unitOf(s.unit_id);
          const tp = typeOf(s.unit_type_id);
          return { ...s, unit_code: u.code, housekeeping_status: u.housekeeping_status, unit_status: u.status, unit_type_name_ar: tp.name_ar, unit_type_code: tp.code, nights: db.nights.filter((n) => n.reservation_unit_id === s.id).sort((a, c) => (a.night || a.date) < (c.night || c.date) ? -1 : 1).map((n) => ({ reservation_unit_id: n.reservation_unit_id, night: n.date, room_minor: n.room_minor, extra_guest_minor: n.extra_guest_minor, meal_minor: n.meal_minor })) };
        }),
        items: db.items.filter((i) => i.reservation_id === r.id), payments: db.payments.filter((p) => p.reservation_id === r.id), invoices: db.invoices.filter((i) => i.reservation_id === r.id),
      };
    };
    const listRow = (r) => {
      const g = guestOf(r.guest_id);
      const unitCodes = [...new Set(db.segments.filter((s) => s.reservation_id === r.id).map((s) => unitOf(s.unit_id).code))].sort().join('، ');
      return { id: r.id, code: r.code, public_code: r.public_code, status: r.status, source: r.source, check_in: r.check_in, check_out: r.check_out, nights: r.nights, adults: r.adults, children: r.children, total_minor: r.total_minor, paid_minor: r.paid_minor, balance_minor: r.total_minor - r.paid_minor, deposit_due_minor: r.deposit_due_minor, hold_expires_at: r.hold_expires_at, created_at: r.created_at, guest_id: g.id, guest_name: g.full_name, guest_phone: g.phone, is_vip: Boolean(g.is_vip), unit_codes: unitCodes };
    };
    if (method === 'GET' && sub === '/reservations') {
      const g = need('reservations.read');
      if (g) return g;
      const status = query.status ? String(query.status).split(',') : [];
      let list = db.reservations.filter((r) => r.property_id === pid);
      if (status.length) list = list.filter((r) => status.includes(r.status));
      if (query.source) list = list.filter((r) => r.source === query.source);
      if (num(query.guest_id)) list = list.filter((r) => r.guest_id === num(query.guest_id));
      if (query.check_in_from) list = list.filter((r) => r.check_in >= query.check_in_from);
      if (query.check_in_to) list = list.filter((r) => r.check_in <= query.check_in_to);
      if (query.check_out_from) list = list.filter((r) => r.check_out >= query.check_out_from);
      if (query.check_out_to) list = list.filter((r) => r.check_out <= query.check_out_to);
      if (query.arriving) list = list.filter((r) => r.check_in === query.arriving && ['pending', 'confirmed'].includes(r.status));
      if (query.departing) list = list.filter((r) => r.check_out === query.departing && ['checked_in', 'confirmed'].includes(r.status));
      if (query.stay_on) list = list.filter((r) => r.check_in <= query.stay_on && r.check_out > query.stay_on && ['pending', 'confirmed', 'checked_in', 'checked_out'].includes(r.status));
      if (query.in_house) list = list.filter((r) => r.status === 'checked_in');
      if (query.unpaid) list = list.filter((r) => r.total_minor > r.paid_minor && !['cancelled', 'no_show'].includes(r.status));
      if (num(query.unit_id)) list = list.filter((r) => db.segments.some((s) => s.reservation_id === r.id && s.unit_id === num(query.unit_id)));
      if (query.q) {
        const q = String(query.q).toLowerCase();
        const digits = q.replace(/\D/g, '');
        list = list.filter((r) => { const g = guestOf(r.guest_id); return r.code.toLowerCase().includes(q) || r.public_code.toLowerCase() === q || g.full_name.toLowerCase().includes(q) || (digits.length >= 4 && (g.phone || '').replace(/\D/g, '').includes(digits)); });
      }
      const dir = query.order === 'asc' ? 1 : -1;
      list.sort((a, c) => (a.check_in < c.check_in ? -dir : a.check_in > c.check_in ? dir : (a.id - c.id) * dir));
      const size = Math.min(Math.max(num(query.page_size, 25), 1), 100);
      const page = Math.max(num(query.page, 1), 1);
      return ok(list.slice((page - 1) * size, page * size).map(listRow), { meta: pageMeta(page, size, list.length) });
    }

    function roomsFromInput(input) {
      return (input.rooms || []).map((room, index) => ({
        index, unit_type_id: room.unit_type_id, unit_id: room.unit_id || null, adults: room.adults ?? input.adults ?? 2, children: room.children ?? input.children ?? 0,
        rate_plan_id: room.rate_plan_id ?? input.rate_plan_id ?? null,
      }));
    }

    if (method === 'POST' && sub === '/reservations/quote') {
      const g = need('reservations.read');
      if (g) return g;
      const err = stayErrors(b.check_in, b.check_out);
      if (err) return err;
      const rooms = roomsFromInput(b);
      if (!rooms.length) return fail(422, 'اختار غرفة واحدة على الأقل', 'VALIDATION');
      const violations = [];
      const priced = rooms.map((room) => {
        const tp = typeOf(room.unit_type_id);
        const pl = planOf(room.rate_plan_id) || db.ratePlans.find((p) => p.is_default);
        const st = priceStay(tp, pl, b.check_in, b.check_out, room.adults, room.children);
        if (st.violations.length) violations.push({ room: room.index, violations: st.violations });
        return { room, tp, pl, st };
      });
      const pc = promoCheck(b.promo_code, b.check_in, b.check_out);
      const base = sum(priced.map((x) => x.st.rooms_minor + x.st.extra_guest_minor));
      const disc = promoAmount(pc.promo, base);
      const n = diffDays(b.check_in, b.check_out);
      const totals = computeTotals(prop, { rooms: sum(priced.map((x) => x.st.rooms_minor)), extra: sum(priced.map((x) => x.st.extra_guest_minor)), meal: sum(priced.map((x) => x.st.meal_minor)), extras: 0, discount: disc, unitNights: n * rooms.length });
      return ok({
        check_in: b.check_in, check_out: b.check_out, nights: n, currency: prop.currency,
        rooms: priced.map((x) => ({ index: x.room.index, unit_type: { id: x.tp.id, code: x.tp.code, name_ar: x.tp.name_ar, name_en: x.tp.name_en }, rate_plan: planBrief(x.pl), adults: x.room.adults, children: x.room.children, total_minor: x.st.rooms_minor + x.st.extra_guest_minor + x.st.meal_minor, bookable: x.st.violations.length === 0 })),
        promo: pc.info && { ...pc.info, discount_minor: disc }, bookable: violations.length === 0, violations, totals, deposit_due_minor: depositDue(totals.total_minor, prop.deposit_percent),
      });
    }

    if (method === 'POST' && sub === '/reservations') {
      const g = need('reservations.write');
      if (g) return g;
      const err = stayErrors(b.check_in, b.check_out);
      if (err) return err;
      const override = b.override || {};
      if ((override.restrictions || override.blacklist || override.past) && user.role !== 'owner') return fail(403, 'تجاوز القيود للمدير والمالك فقط', 'OVERRIDE_FORBIDDEN');
      const rooms = roomsFromInput(b);
      if (!rooms.length) return fail(422, 'اختار غرفة واحدة على الأقل', 'VALIDATION');
      if (b.check_in < t && !override.past) return fail(422, 'تاريخ الوصول في الماضي', 'PAST_DATE');
      let guest;
      if (b.guest && b.guest.id) guest = guestOf(Number(b.guest.id));
      else if (b.guest && b.guest.full_name) {
        guest = { id: ++db.seq.guest, property_id: pid, full_name: b.guest.full_name, phone: b.guest.phone || null, email: b.guest.email || null, nationality: b.guest.nationality || null, id_type: b.guest.id_type || null, id_number: b.guest.id_number || null, birth_date: null, address: null, notes: null, is_vip: 0, is_blacklisted: 0, total_stays: 0, total_spent_minor: 0, created_at: iso(H.now()), updated_at: iso(H.now()) };
        db.guests.push(guest);
      }
      if (!guest) return fail(422, 'اختار النزيل أو ضيف نزيل جديد', 'VALIDATION', { guest: 'مطلوب' });
      if (guest.is_blacklisted && !override.blacklist) return fail(409, 'النزيل ده في القائمة السوداء', 'GUEST_BLACKLISTED');
      const plans = rooms.map((room) => {
        const tp = typeOf(room.unit_type_id);
        const pl = planOf(room.rate_plan_id) || db.ratePlans.find((p) => p.is_default);
        return { room, tp, pl, st: priceStay(tp, pl, b.check_in, b.check_out, room.adults, room.children) };
      });
      const violations = plans.map((p) => ({ room: p.room.index, violations: p.st.violations })).filter((v) => v.violations.length);
      if (violations.length && !override.restrictions) return fail(422, violations[0].violations[0].message, 'STAY_RESTRICTED', { rooms: violations });
      const pc = promoCheck(b.promo_code, b.check_in, b.check_out);
      if (b.promo_code && !pc.info.valid) return fail(422, pc.info.message, pc.info.reason, { promo_code: pc.info.message });
      // توزيع الوحدات
      const used = new Set();
      const assigned = [];
      for (const p of plans) {
        let unit = null;
        if (p.room.unit_id) {
          unit = freeUnits(p.room.unit_type_id, b.check_in, b.check_out).find((u) => u.id === Number(p.room.unit_id));
          if (!unit || used.has(unit.id)) return fail(409, 'الوحدة دي مشغولة في التواريخ دي', 'UNIT_NOT_AVAILABLE', { occupied: [] });
        } else {
          unit = freeUnits(p.room.unit_type_id, b.check_in, b.check_out).find((u) => !used.has(u.id));
          if (!unit) return fail(409, 'مفيش وحدة فاضية من النوع ده في التواريخ دي', 'NO_AVAILABILITY');
        }
        used.add(unit.id);
        assigned.push({ ...p, unit });
      }
      const status = b.status === 'pending' ? 'pending' : 'confirmed';
      let first = null;
      assigned.forEach((a, i) => {
        if (i === 0) {
          first = createStay(db, H, { guest, unit: a.unit, type: a.tp, plan: a.pl, checkIn: b.check_in, checkOut: b.check_out, adults: a.room.adults, children: a.room.children, status, source: b.source || 'walk_in', promo: pc.promo, expectedArrival: b.expected_arrival, guestNotes: b.guest_notes, internalNotes: b.internal_notes });
        } else {
          // غرف إضافية على نفس الحجز: سطر جديد
          const seg = { id: ++db.seq.seg, reservation_id: first.id, line_no: i, unit_id: a.unit.id, unit_type_id: a.tp.id, check_in: b.check_in, check_out: b.check_out, adults: a.room.adults, children: a.room.children, rate_plan_id: a.pl ? a.pl.id : null, rooms_minor: a.st.rooms_minor, extra_guest_minor: a.st.extra_guest_minor, meal_minor: a.st.meal_minor };
          db.segments.push(seg);
          a.st.nights.forEach((n) => db.nights.push({ reservation_unit_id: seg.id, ...n }));
        }
      });
      if (pc.promo) pc.promo.uses_count += 1;
      first.created_by = user.id;
      recalc(db, first);
      first.deposit_due_minor = depositDue(first.total_minor, prop.deposit_percent);
      if (b.deposit && b.deposit.amount_minor > 0) {
        db.payments.push({ id: ++db.seq.pay, property_id: pid, reservation_id: first.id, type: 'payment', method: b.deposit.method || 'cash', amount_minor: b.deposit.amount_minor, reference: b.deposit.reference || null, note: 'عربون', received_at: iso(H.now()), received_by: user.id, received_by_name: user.full_name, shift_id: 1, voided_at: null, voided_by: null, void_reason: null, created_at: iso(H.now()) });
        recalc(db, first);
      }
      return created(detailOf(first));
    }

    m = /^\/reservations\/(\d+)(?:\/(confirm|check-in|check-out|cancel|no-show|change-dates|move|items|payments|invoices)(?:\/(\d+))?(?:\/(void))?)?$/.exec(sub);
    if (m) {
      const r = db.reservations.find((x) => x.id === Number(m[1]) && x.property_id === pid);
      if (!r) return fail(404, 'الحجز غير موجود');
      const action = m[2];
      if (!action && method === 'GET') { const g = need('reservations.read'); return g || ok(detailOf(r)); }
      if (!action && method === 'PATCH') {
        const g = need('reservations.write');
        if (g) return g;
        ['guest_notes', 'internal_notes', 'expected_arrival', 'external_ref', 'source'].forEach((k) => { if (b[k] !== undefined) r[k] = b[k]; });
        return ok(detailOf(r));
      }
      const badStatus = (what) => fail(409, 'مينفعش ' + what + ' لحجز حالته «' + STATUS_LABELS[r.status] + '»', 'BAD_STATUS', { status: r.status });
      const release = (status, reason, fee) => {
        db.segments.filter((s) => s.reservation_id === r.id).forEach((s) => { s.__released = true; });
        r.status = status; r.cancelled_at = iso(H.now()); r.cancel_reason = reason; r.hold_expires_at = null;
        if (fee > 0) addItem(db, H, r, { type: 'fee', description: status === 'no_show' ? 'غرامة عدم حضور' : 'غرامة إلغاء', amount_minor: fee, taxable: false, service_chargeable: false });
        recalc(db, r);
        return Math.max(0, r.paid_minor - r.total_minor);
      };
      if (action === 'confirm' && method === 'POST') {
        const g = need('reservations.write');
        if (g) return g;
        if (r.status !== 'pending') return badStatus('تأكّد');
        r.status = 'confirmed'; r.hold_expires_at = null;
        return ok(detailOf(r));
      }
      if (action === 'check-in' && method === 'POST') {
        const g = need('reservations.checkin');
        if (g) return g;
        if (r.status === 'pending') return fail(409, 'الحجز لسه معلّق — أكّده الأول', 'RESERVATION_PENDING');
        if (r.status !== 'confirmed') return badStatus('تسجّل دخول');
        if (t >= r.check_out) return fail(409, 'فترة الحجز انتهت', 'STAY_ENDED');
        if (t < r.check_in && !b.early) return fail(409, 'الوصول المتوقّع ' + r.check_in + ' — لو الضيف وصل بدري فعّل «وصول مبكّر»', 'TOO_EARLY', { check_in: r.check_in });
        const segs = db.segments.filter((s) => s.reservation_id === r.id);
        const notReady = segs.map((s) => unitOf(s.unit_id)).filter((u) => !['clean', 'inspected'].includes(u.housekeeping_status));
        if (notReady.length && !b.force_dirty) return fail(409, 'الغرفة ' + notReady.map((u) => u.code).join('، ') + ' لسه متنضّفتش', 'UNIT_NOT_READY', { units: notReady.map((u) => u.code) });
        if (t < r.check_in) { r.check_in = t; segs.forEach((s) => { s.check_in = t; }); r.nights = diffDays(r.check_in, r.check_out); }
        r.status = 'checked_in'; r.checked_in_at = iso(H.now());
        const guest = guestOf(r.guest_id);
        return ok({ reservation: detailOf(r), warnings: guest.id_number ? [] : [{ code: 'GUEST_ID_MISSING', message: 'بيانات هوية النزيل غير مسجّلة' }] });
      }
      if (action === 'check-out' && method === 'POST') {
        const g = need('reservations.checkin');
        if (g) return g;
        if (r.status !== 'checked_in') return badStatus('تسجّل خروج');
        recalc(db, r);
        const balance = r.total_minor - r.paid_minor;
        const warnings = [];
        if (balance > 0) {
          if (!b.allow_unpaid) return fail(409, 'على النزيل رصيد مستحق ' + balance / 100, 'BALANCE_DUE', { balance_minor: balance });
          if (user.role !== 'owner') return fail(403, 'المغادرة برصيد غير مسدّد للمدير والمالك فقط', 'OVERRIDE_FORBIDDEN');
          warnings.push({ code: 'UNPAID_BALANCE', message: 'غادر برصيد غير مسدّد ' + balance / 100, balance_minor: balance });
        }
        if (t < r.check_out && b.early_departure && t > r.check_in) {
          r.check_out = t;
          db.segments.filter((s) => s.reservation_id === r.id).forEach((s) => {
            s.check_out = t;
            db.nights = db.nights.filter((n) => !(n.reservation_unit_id === s.id && n.date >= t));
            const keep = db.nights.filter((n) => n.reservation_unit_id === s.id);
            s.rooms_minor = sum(keep.map((n) => n.room_minor)); s.extra_guest_minor = sum(keep.map((n) => n.extra_guest_minor)); s.meal_minor = sum(keep.map((n) => n.meal_minor));
          });
          recalc(db, r);
        } else if (t < r.check_out) warnings.push({ code: 'EARLY_DEPARTURE_NIGHTS_HELD', message: 'الليالي المتبقية لسه محجوزة — فعّل «خروج مبكّر» لتحريرها للبيع' });
        r.status = 'checked_out'; r.checked_out_at = iso(H.now());
        db.segments.filter((s) => s.reservation_id === r.id).forEach((s) => { unitOf(s.unit_id).housekeeping_status = 'dirty'; });
        return ok({ reservation: detailOf(r), warnings });
      }
      if (action === 'cancel' && method === 'POST') {
        const g = need('reservations.cancel');
        if (g) return g;
        if (!['pending', 'confirmed'].includes(r.status)) return badStatus('تلغي');
        const refund = release('cancelled', b.reason || 'إلغاء', num(b.fee_minor, 0));
        return ok({ reservation: detailOf(r), refund_due_minor: refund });
      }
      if (action === 'no-show' && method === 'POST') {
        const g = need('reservations.cancel');
        if (g) return g;
        if (r.status !== 'confirmed') return badStatus('تسجّل عدم حضور');
        if (t <= r.check_in) return fail(409, 'عدم الحضور يُسجَّل بعد يوم الوصول', 'TOO_EARLY', { check_in: r.check_in });
        const refund = release('no_show', b.note || 'لم يحضر', num(b.fee_minor, 0));
        return ok({ reservation: detailOf(r), refund_due_minor: refund });
      }
      if (action === 'change-dates' && method === 'POST') {
        const g = need('reservations.write');
        if (g) return g;
        if (!HOLDING.includes(r.status)) return badStatus('تعدّل التواريخ');
        const err = stayErrors(b.check_in, b.check_out);
        if (err) return err;
        if (r.status === 'checked_in' && b.check_in !== r.check_in) return fail(409, 'النزيل مقيم — مينفعش تغيّر تاريخ الوصول', 'ARRIVAL_LOCKED');
        if (r.status !== 'checked_in' && b.check_in < t && !(b.override && b.override.past)) return fail(409, 'تاريخ الوصول الجديد في الماضي', 'PAST_DATE');
        const segs = db.segments.filter((s) => s.reservation_id === r.id);
        const busy = occupiedUnits(b.check_in, b.check_out, r.id);
        const clash = segs.find((s) => busy.has(s.unit_id));
        if (clash) return fail(409, 'الوحدة ' + unitOf(clash.unit_id).code + ' مشغولة في التواريخ الجديدة', 'UNIT_NOT_AVAILABLE', { occupied: [] });
        segs.forEach((s) => {
          const tp = typeOf(s.unit_type_id);
          const st = priceStay(tp, planOf(s.rate_plan_id), b.check_in, b.check_out, s.adults, s.children);
          s.check_in = b.check_in; s.check_out = b.check_out; s.rooms_minor = st.rooms_minor; s.extra_guest_minor = st.extra_guest_minor; s.meal_minor = st.meal_minor;
          db.nights = db.nights.filter((n) => n.reservation_unit_id !== s.id).concat(st.nights.map((n) => ({ reservation_unit_id: s.id, ...n })));
        });
        r.check_in = b.check_in; r.check_out = b.check_out;
        recalc(db, r);
        return ok(detailOf(r));
      }
      if (action === 'move' && method === 'POST') {
        const g = need('reservations.write');
        if (g) return g;
        if (!HOLDING.includes(r.status)) return badStatus('تنقل غرفة');
        const seg = db.segments.find((s) => s.id === Number(b.segment_id) && s.reservation_id === r.id);
        const to = unitOf(Number(b.to_unit_id));
        if (!seg || !to) return fail(404, 'الوحدة أو السطر غير موجود');
        if (occupiedUnits(seg.check_in, seg.check_out, r.id).has(to.id)) return fail(409, 'الوحدة دي مشغولة في التواريخ دي', 'UNIT_NOT_AVAILABLE', { occupied: [] });
        const from = seg.unit_id;
        const typeChanged = to.unit_type_id !== seg.unit_type_id;
        seg.unit_id = to.id;
        if (typeChanged) {
          const tp = typeOf(to.unit_type_id);
          seg.unit_type_id = tp.id;
          const st = priceStay(tp, planOf(seg.rate_plan_id), seg.check_in, seg.check_out, seg.adults, seg.children);
          seg.rooms_minor = st.rooms_minor; seg.extra_guest_minor = st.extra_guest_minor; seg.meal_minor = st.meal_minor;
          db.nights = db.nights.filter((n) => n.reservation_unit_id !== seg.id).concat(st.nights.map((n) => ({ reservation_unit_id: seg.id, ...n })));
          recalc(db, r);
        }
        if (r.status === 'checked_in') unitOf(from).housekeeping_status = 'dirty';
        return ok({ reservation: detailOf(r), moved: { from_unit_id: from, to_unit_id: to.id, type_changed: typeChanged } });
      }
      if (action === 'items' && method === 'POST' && !m[3]) {
        const g = need('billing.write');
        if (g) return g;
        if (r.status === 'cancelled' && b.kind !== 'fee') return fail(409, 'الحجز ملغي — مينفعش تضيف بنود', 'RESERVATION_CANCELLED');
        const type = b.kind === 'service' ? 'service' : b.kind === 'charge' ? 'charge' : b.kind === 'discount' ? 'discount' : 'fee';
        if (type === 'service' && !db.services.find((s) => s.id === Number(b.service_id))) return fail(400, 'الخدمة غير متاحة', 'BAD_SERVICE', { service_id: 'غير متاحة' });
        const item = addItem(db, H, r, { type, service_id: type === 'service' ? Number(b.service_id) : null, description: b.description, quantity: num(b.quantity, 1), unit_price_minor: b.unit_price_minor, amount_minor: b.amount_minor, taxable: b.taxable, service_chargeable: b.service_chargeable });
        if (b.description && type === 'service') item.description = b.description;
        const totals = recalc(db, r);
        return created({ item, totals });
      }
      if (action === 'items' && m[4] === 'void' && method === 'POST') {
        const g = need('billing.void');
        if (g) return g;
        const it = db.items.find((x) => x.id === Number(m[3]) && x.reservation_id === r.id);
        if (!it) return fail(404, 'البند غير موجود');
        it.voided_at = iso(H.now()); it.void_reason = b.reason || null;
        return ok({ item: it, totals: recalc(db, r) });
      }
      if (action === 'payments' && method === 'POST' && !m[3]) {
        const g = need('billing.write');
        if (g) return g;
        const amount = num(b.amount_minor, 0);
        if (!(amount > 0)) return fail(422, 'المبلغ لازم يكون أكبر من صفر', 'VALIDATION', { amount_minor: 'مطلوب' });
        if (b.type === 'refund' && amount > r.paid_minor) return fail(409, 'المرتجع أكبر من المدفوع', 'REFUND_EXCEEDS_PAID');
        const p = { id: ++db.seq.pay, property_id: pid, reservation_id: r.id, type: b.type === 'refund' ? 'refund' : 'payment', method: b.method || 'cash', amount_minor: amount, reference: b.reference || null, note: b.note || null, received_at: iso(H.now()), received_by: user.id, received_by_name: user.full_name, shift_id: b.method === 'cash' ? db.shift.id : null, voided_at: null, voided_by: null, void_reason: null, created_at: iso(H.now()) };
        db.payments.push(p);
        return created({ payment: p, totals: recalc(db, r) });
      }
      if (action === 'payments' && m[4] === 'void' && method === 'POST') {
        const g = need('billing.void');
        if (g) return g;
        const p = db.payments.find((x) => x.id === Number(m[3]) && x.reservation_id === r.id);
        if (!p) return fail(404, 'الدفعة غير موجودة');
        p.voided_at = iso(H.now()); p.void_reason = b.reason || null;
        return ok({ payment: p, totals: recalc(db, r) });
      }
      if (action === 'invoices' && method === 'GET') return ok(db.invoices.filter((i) => i.reservation_id === r.id));
      if (action === 'invoices' && method === 'POST') {
        const g = need('billing.write');
        if (g) return g;
        if (db.invoices.some((i) => i.reservation_id === r.id && i.status === 'issued')) return fail(409, 'فيه فاتورة صادرة بالفعل', 'INVOICE_EXISTS');
        return created(issueInvoice(db, r, b));
      }
    }
    m = /^\/invoices\/(\d+)(?:\/(void))?$/.exec(sub);
    if (m) {
      const inv = db.invoices.find((i) => i.id === Number(m[1]));
      if (!inv) return fail(404, 'الفاتورة غير موجودة');
      if (m[2] === 'void' && method === 'POST') { inv.status = 'void'; inv.voided_at = iso(H.now()); inv.void_reason = b.reason || null; }
      const r = db.reservations.find((x) => x.id === inv.reservation_id);
      return ok({ ...inv, reservation_code: r.code, guest_name: guestOf(r.guest_id).full_name, property: prop });
    }

    return null;

    function emptyToday(date) {
      return { date, arrivals: [], departures: [], overdue_departures: [], in_house: [], stats: { arrivals: 0, departures: 0, in_house: 0, occupied_tonight: 0, held_tonight: 0, available_tonight: 0, occupancy_pct: 0, pending_bookings: 0, pending_expiring_soon: 0, open_maintenance: 0, urgent_maintenance: 0, unpaid_in_house_minor: 0, unpaid_in_house_count: 0 }, housekeeping: { dirty: 0, cleaning: 0, clean: 0, inspected: 0 }, payments_today: [] };
    }
  }

  createDemo({
    key: 'nozol_demo_db',
    version: 1,
    prefix: '/api/v1',
    seed,
    handle,
    notFound: () => ({ success: false, message: 'المسار ده مش موجود في النسخة التجريبية', code: 'NOT_FOUND' }),
    serverError: () => ({ success: false, message: 'حصل خطأ في النسخة التجريبية', code: 'DEMO_ERROR' }),
    bar: {
      label: 'نسخة تجريبية',
      openFirst: true,
      intro: 'ده عرض لنظام نُزُل ببيانات فندق وهمي متخزنة على جهازك بس. ادخل بأي دور:',
      actions: [
        { label: 'ادخل كمالك الفندق (كل الصلاحيات)', primary: true, run: (a) => { a.db().session = { userId: 1 }; a.go('/'); } },
        { label: 'ادخل كموظف استقبال', run: (a) => { a.db().session = { userId: 2 }; a.go('/'); } },
      ],
      note: 'أو سجّل دخول بـ owner@nozol.demo أو frontdesk@nozol.demo وكلمة المرور Demo@1234. بعض الصفحات (الغرف، الأسعار، التقارير…) لسه قيد البناء في المشروع نفسه.',
    },
  });
})();
