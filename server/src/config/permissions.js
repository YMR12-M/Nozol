/**
 * ═══════════════════════════════════════════════════════════════
 *  الأدوار والصلاحيات
 *
 *  الصلاحية نصّ بصيغة `مورد.إجراء`. الدور مجموعة صلاحيات ثابتة في الكود
 *  (لا جدول للأدوار): أبسط في المراجعة، ولا يمكن لخلل في البيانات أن
 *  يمنح أحدًا ما لم نقصده. وإن احتجنا أدوارًا مخصّصة لاحقًا يكفي نقل
 *  هذه الخريطة إلى جدول.
 * ═══════════════════════════════════════════════════════════════
 */

export const ROLES = ['owner', 'manager', 'front_desk', 'housekeeping', 'accountant', 'viewer'];

export const ROLE_LABELS = {
  owner: 'مالك',
  manager: 'مدير',
  front_desk: 'استقبال',
  housekeeping: 'نظافة وتجهيز',
  accountant: 'محاسب',
  viewer: 'مشاهدة فقط',
};

export const PERMISSIONS = [
  'property.read', 'property.write',
  'users.read', 'users.write',
  'units.read', 'units.write',
  'rates.read', 'rates.write',
  'guests.read', 'guests.write',
  'reservations.read', 'reservations.write', 'reservations.checkin', 'reservations.cancel',
  'billing.read', 'billing.write', 'billing.void', 'billing.shift',
  'expenses.read', 'expenses.write',
  'housekeeping.read', 'housekeeping.write', 'housekeeping.manage',
  'maintenance.read', 'maintenance.write',
  'reports.read',
  'audit.read',
  'ical.manage',
];

const ALL = new Set(PERMISSIONS);

export const ROLE_PERMISSIONS = {
  owner: ALL,
  manager: ALL,

  front_desk: new Set([
    'property.read', 'units.read', 'rates.read',
    'guests.read', 'guests.write',
    'reservations.read', 'reservations.write', 'reservations.checkin', 'reservations.cancel',
    'billing.read', 'billing.write', 'billing.shift',
    'housekeeping.read', 'housekeeping.write',
    'maintenance.read', 'maintenance.write',
  ]),

  housekeeping: new Set([
    'property.read', 'units.read',
    'housekeeping.read', 'housekeeping.write',
    'maintenance.read', 'maintenance.write',
  ]),

  accountant: new Set([
    'property.read', 'units.read',
    'guests.read',
    'reservations.read',
    'billing.read', 'billing.write', 'billing.void', 'billing.shift',
    'expenses.read', 'expenses.write',
    'reports.read',
  ]),

  viewer: new Set([
    'property.read', 'units.read', 'rates.read', 'guests.read', 'reservations.read',
    'billing.read', 'expenses.read', 'housekeeping.read', 'maintenance.read', 'reports.read',
  ]),
};

export const can = (role, permission) => ROLE_PERMISSIONS[role]?.has(permission) ?? false;

/** الصلاحيات التي تُرسَل للواجهة لتُخفي ما لا يحقّ للمستخدم رؤيته */
export const permissionsOf = (role) => [...(ROLE_PERMISSIONS[role] ?? [])];
