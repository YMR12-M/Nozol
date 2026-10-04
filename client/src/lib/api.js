/**
 * ═══════════════════════════════════════════════════════════════
 *  عميل الـ API
 *
 *  • توكن الدخول في الذاكرة فقط (لا localStorage): لا تسرقه ثغرة XSS.
 *  • الويب: توكن التجديد في كوكي httpOnly يديره المتصفّح.
 *    تطبيق الديسكتوب (Electron): في مخزن آمن بالجهاز عبر جسر `window.nozolDesktop`.
 *  • تجديد التوكن مرّة واحدة عند انتهائه ثم إعادة الطلب، مع طلب تجديد واحد
 *    مشترك مهما تزامنت الطلبات.
 *  • تحويل كل خطأ إلى ApiRequestError موحّد برسالة عربية جاهزة وأخطاء حقول.
 * ═══════════════════════════════════════════════════════════════
 */
const BASE = import.meta.env.VITE_API_URL || '/api/v1';

export class ApiRequestError extends Error {
  constructor(message, { status = 0, code = null, errors = null, offline = false } = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.offline = offline;
  }
}

export const clientType = () =>
  (typeof window !== 'undefined' && window.nozolDesktop ? 'desktop' : 'web');

/* ── الجلسة ─────────────────────────────────────────────────── */
let accessToken = null;
let refreshTimer = null;
let refreshing = null;
const expiredListeners = new Set();

export const getAccessToken = () => accessToken;
export const onSessionExpired = (listener) => {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
};

function scheduleRefresh(expiresIn) {
  clearTimeout(refreshTimer);
  // نجدّد قبل الانتهاء بدقيقة (أو عند 80% من العمر لو كان قصيرًا)
  const delay = Math.max(15, Math.min(expiresIn - 60, expiresIn * 0.8)) * 1000;
  refreshTimer = setTimeout(() => { refreshSession().catch(() => {}); }, delay);
}

async function applySession({ tokens }) {
  accessToken = tokens.access_token;
  if (clientType() === 'desktop' && tokens.refresh_token) {
    await window.nozolDesktop.setRefreshToken(tokens.refresh_token);
  }
  scheduleRefresh(tokens.expires_in);
}

export async function endSession({ notify = false } = {}) {
  accessToken = null;
  clearTimeout(refreshTimer);
  if (clientType() === 'desktop') await window.nozolDesktop.clearRefreshToken().catch(() => {});
  if (notify) expiredListeners.forEach((listener) => listener());
}

/** يجدّد الجلسة من توكن التجديد (كوكي/جسر). يعيد { user, tokens } أو null. */
export function refreshSession() {
  refreshing ??= (async () => {
    try {
      const body = {};
      if (clientType() === 'desktop') {
        const token = await window.nozolDesktop.getRefreshToken();
        if (!token) return null;
        body.refresh_token = token;
      }
      const post = () => fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Client-Type': clientType() },
        body: JSON.stringify(body),
      });

      let response = await post();
      let payload = await response.json().catch(() => null);
      // تبويب آخر جدّد في نفس اللحظة: ننتظر قليلًا ونعيد بالتوكن الجديد (الكوكي تحدّث)
      if (response.status === 401 && payload?.code === 'REFRESH_IN_PROGRESS') {
        await new Promise((resolve) => { setTimeout(resolve, 600); });
        response = await post();
        payload = await response.json().catch(() => null);
      }
      if (!response.ok) { await endSession(); return null; }
      await applySession(payload.data);
      return payload.data;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** بعد تسجيل دخول/تغيير كلمة مرور ناجح */
export const startSession = (data) => applySession(data);

/* ── الطلبات ────────────────────────────────────────────────── */
function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.append(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function rawRequest(path, { method = 'GET', body, params, auth = true, retry = true, form = false, blob = false } = {}) {
  const headers = { Accept: blob ? '*/*' : 'application/json', 'X-Client-Type': clientType() };
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(`${BASE}${path}${buildQuery(params)}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : (form ? body : JSON.stringify(body)),
    });
  } catch {
    throw new ApiRequestError('تعذّر الاتصال بالخادم — تأكد من الإنترنت', { offline: true });
  }

  if (response.status === 204) return { data: null };
  if (blob && response.ok) return { blob: await response.blob(), headers: response.headers };

  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  // `data: null` رد سليم (مثل «لا وردية مفتوحة»): لا نستبدله بجسم الرد كله
  if (response.ok) return { data: payload && 'data' in payload ? payload.data : payload, meta: payload?.meta };

  if (response.status === 401 && retry && auth && ['TOKEN_EXPIRED', 'NO_TOKEN'].includes(payload?.code)) {
    const session = await refreshSession();
    if (session) return rawRequest(path, { method, body, params, auth, retry: false, form, blob });
    await endSession({ notify: true });
  }

  throw new ApiRequestError(payload?.message || 'حصل خطأ غير متوقّع', {
    status: response.status, code: payload?.code, errors: payload?.errors,
  });
}

const unwrap = async (promise) => (await promise).data;

export const api = {
  get: (path, params) => unwrap(rawRequest(path, { params })),
  /** قائمة مقسّمة صفحات: { rows, meta } */
  async page(path, params) {
    const { data, meta } = await rawRequest(path, { params });
    return { rows: data, meta };
  },
  post: (path, body = {}, options = {}) => unwrap(rawRequest(path, { method: 'POST', body, ...options })),
  patch: (path, body = {}) => unwrap(rawRequest(path, { method: 'PATCH', body })),
  put: (path, body = {}) => unwrap(rawRequest(path, { method: 'PUT', body })),
  del: (path) => unwrap(rawRequest(path, { method: 'DELETE' })),
  upload: (path, formData) => unwrap(rawRequest(path, { method: 'POST', body: formData, form: true })),
  /** تنزيل ملف (CSV أو مرفق خاص) بالتوكن ← Blob */
  async download(path, params) {
    const { blob, headers } = await rawRequest(path, { params, blob: true });
    const disposition = headers.get('content-disposition') || '';
    const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'file';
    return { blob, name };
  },
};

/** واجهة مقيَّدة بمنشأة: p.get('/reservations') ← GET /properties/:id/reservations */
export function propertyApi(propertyId) {
  const base = `/properties/${propertyId}`;
  return {
    id: propertyId,
    get: (path, params) => api.get(`${base}${path}`, params),
    page: (path, params) => api.page(`${base}${path}`, params),
    post: (path, body) => api.post(`${base}${path}`, body),
    patch: (path, body) => api.patch(`${base}${path}`, body),
    del: (path) => api.del(`${base}${path}`),
    upload: (path, form) => api.upload(`${base}${path}`, form),
    download: (path, params) => api.download(`${base}${path}`, params),
  };
}

/** يحفظ Blob كملف على جهاز المستخدم */
export function saveBlob({ blob, name }) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** عنوان مباشر لملف علني (صور الوحدات) */
export const publicUrl = (url) => url;
