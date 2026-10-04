import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.jsx';
import { useProperty } from '../../context/PropertyContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import { Icon, Logo, Wordmark } from '../../lib/icons.jsx';
import { ROLE_LABELS } from '../../lib/constants.js';
import { Avatar, Drawer, Menu, MenuItem, Notice } from '../ui/index.js';

/** عناصر التنقّل: كل عنصر يظهر لمن يملك صلاحية واحدة على الأقل من permissions */
const NAV = [
  { section: 'العمليات اليومية' },
  { to: '/', label: 'اليوم', icon: 'home', end: true, perm: ['reservations.read'] },
  { to: '/calendar', label: 'التقويم', icon: 'calendar', perm: ['reservations.read'] },
  { to: '/reservations', label: 'الحجوزات', icon: 'receipt', perm: ['reservations.read'] },
  { to: '/housekeeping', label: 'النظافة والتجهيز', icon: 'sparkles', perm: ['housekeeping.read'], badge: 'dirty' },
  { to: '/maintenance', label: 'الصيانة', icon: 'wrench', perm: ['maintenance.read'], badge: 'maintenance' },
  { section: 'الإدارة' },
  { to: '/guests', label: 'النزلاء', icon: 'users', perm: ['guests.read'] },
  { to: '/billing', label: 'الحسابات', icon: 'dollar', perm: ['billing.read', 'expenses.read'] },
  { to: '/reports', label: 'التقارير', icon: 'chart', perm: ['reports.read'] },
  { section: 'الإعداد' },
  { to: '/rooms', label: 'الغرف والوحدات', icon: 'bed', perm: ['units.read'] },
  { to: '/rates', label: 'الأسعار والعروض', icon: 'tag', perm: ['rates.read'] },
  { to: '/channels', label: 'قنوات الحجز (iCal)', icon: 'link', perm: ['ical.manage'] },
  { to: '/team', label: 'الفريق', icon: 'user', perm: ['users.read'] },
  { to: '/settings', label: 'إعدادات المنشأة', icon: 'settings', perm: ['property.write'] },
  { to: '/audit', label: 'سجل التدقيق', icon: 'shield', perm: ['audit.read'] },
];

function Navigation({ onNavigate }) {
  const { can } = useAuth();
  const { api } = useProperty();
  const allowed = (item) => item.perm.some((permission) => can(permission));

  // عدّادات خفيفة بجوار «النظافة» و«الصيانة» (تتجدّد كل دقيقة)
  const counters = useQuery({
    queryKey: ['nav-counters', api?.id],
    queryFn: async () => {
      const [today, maintenance] = await Promise.all([
        can('reservations.read') ? api.get('/reports/today') : null,
        can('maintenance.read') ? api.get('/maintenance', { open: true }) : [],
      ]);
      return { dirty: today?.housekeeping.dirty ?? 0, maintenance: maintenance?.length ?? 0 };
    },
    enabled: Boolean(api),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <nav className="nav" aria-label="القائمة الرئيسية">
      {NAV.map((item, index) => {
        if (item.section) {
          // لا نعرض عنوان قسم بلا عناصر تحته
          const next = NAV.slice(index + 1).find((entry) => entry.section || allowed(entry));
          return next && !next.section ? <div key={item.section} className="nav-label">{item.section}</div> : null;
        }
        if (!allowed(item)) return null;
        const count = item.badge ? counters.data?.[item.badge] : 0;
        return (
          <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate}>
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
            {count > 0 && <span className="badge-count num">{count}</span>}
          </NavLink>
        );
      })}
    </nav>
  );

}

function SidebarContent({ onNavigate }) {
  const { user, logout } = useAuth();
  return (
    <>
      <div className="brand">
        <Logo size={40} />
        <div><Wordmark /><small>إدارة الضيافة</small></div>
      </div>
      <Navigation onNavigate={onNavigate} />
      <div className="sidebar-foot">
        <div className="user">
          <Avatar name={user.full_name} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="truncate bold user-name">{user.full_name}</div>
            <div className="xsmall user-role">{ROLE_LABELS[user.role]}</div>
          </div>
          <button type="button" className="btn ghost icon sm user-logout" onClick={logout} aria-label="تسجيل الخروج" title="تسجيل الخروج">
            <Icon name="logout" size={18} />
          </button>
        </div>
      </div>
    </>
  );
}

function PropertySwitcher() {
  const { properties, property, select } = useProperty();
  if (properties.length === 0) return null;
  // اسم المنشأة لوحة نحاسية على الشريط العلوي (تفتح قائمة التبديل لو عند المالك أكثر من منشأة)
  if (properties.length === 1) {
    return <span className="plaque"><Icon name="building" size={18} /><span className="truncate" style={{ maxWidth: 240 }}>{property?.name_ar}</span></span>;
  }
  return (
    <Menu align="start" trigger={(
      <button type="button" className="plaque" style={{ cursor: 'pointer' }}>
        <Icon name="building" size={18} /><span className="truncate" style={{ maxWidth: 200 }}>{property?.name_ar}</span><Icon name="chevron-down" size={14} />
      </button>
    )}
    >
      <div className="head">المنشآت</div>
      {properties.map((item) => (
        <MenuItem key={item.id} icon={item.id === property?.id ? 'check' : undefined} onClick={() => select(item.id)}>{item.name_ar}</MenuItem>
      ))}
    </Menu>
  );
}

function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[preference];
  const icon = { auto: 'globe', light: 'sun', dark: 'moon' }[preference];
  const label = { auto: 'تلقائي', light: 'فاتح', dark: 'داكن' }[preference];
  return (
    <button type="button" className="btn ghost icon" onClick={() => setPreference(next)} title={`المظهر: ${label}`} aria-label={`المظهر: ${label} (اضغط للتبديل)`}>
      <Icon name={icon} size={20} />
    </button>
  );
}

function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  if (online) return null;
  return <Notice tone="warning" icon="wifi">مفيش اتصال بالإنترنت — اللي تعمله دلوقتي مش هيتحفظ لحد ما الاتصال يرجع.</Notice>;
}

export default function Shell() {
  const [drawer, setDrawer] = useState(false);
  const { user } = useAuth();
  const { properties, propertyId } = useProperty();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setDrawer(false), [location.pathname]);

  // لا منشأة بعد: المالك يبدأ المعالج، وغيره ينتظر إسناد
  useEffect(() => {
    if (properties.length === 0 && user.role === 'owner' && location.pathname !== '/onboarding') navigate('/onboarding', { replace: true });
  }, [properties.length, user.role, location.pathname, navigate]);

  return (
    <div className="app">
      <aside className="sidebar"><SidebarContent /></aside>
      <Drawer open={drawer} onClose={() => setDrawer(false)}>
        <div className="sidebar" style={{ position: 'static', height: '100%', display: 'flex' }}>
          <SidebarContent onNavigate={() => setDrawer(false)} />
        </div>
      </Drawer>

      <header className="topbar">
        <button type="button" className="btn ghost icon menu-btn" onClick={() => setDrawer(true)} aria-label="القائمة"><Icon name="menu" size={22} /></button>
        <PropertySwitcher />
        <div className="grow" />
        <ThemeToggle />
      </header>

      <main className="main" id="main">
        <OfflineBanner />
        {propertyId || location.pathname === '/onboarding' || location.pathname === '/settings/account' ? (
          <Outlet />
        ) : (
          <div className="page"><Notice tone="warning" icon="lock">لسه مفيش منشأة مُسنَدة لحسابك — كلّم المالك ليضيفك على منشأة.</Notice></div>
        )}
      </main>
    </div>
  );
}
