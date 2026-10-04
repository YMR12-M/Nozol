import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { PropertyProvider } from './context/PropertyContext.jsx';
import Shell from './components/layout/Shell.jsx';
import { InkFilters, Loading } from './components/ui/index.js';

// الصفحات تُحمَّل عند الطلب: شاشة الدخول لا تنتظر كود التقارير والرسوم البيانية
const page = (loader) => lazy(loader);
const Login = page(() => import('./pages/Login.jsx'));
const ForgotPassword = page(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = page(() => import('./pages/ResetPassword.jsx'));
const MustChangePassword = page(() => import('./pages/MustChangePassword.jsx'));
const Onboarding = page(() => import('./pages/Onboarding.jsx'));
const Today = page(() => import('./pages/Today.jsx'));
const CalendarPage = page(() => import('./pages/CalendarPage.jsx'));
const Reservations = page(() => import('./pages/Reservations.jsx'));
const NewReservation = page(() => import('./pages/NewReservation.jsx'));
const ReservationDetail = page(() => import('./pages/ReservationDetail.jsx'));
const Guests = page(() => import('./pages/Guests.jsx'));
const GuestDetail = page(() => import('./pages/GuestDetail.jsx'));
const Rooms = page(() => import('./pages/Rooms.jsx'));
const Rates = page(() => import('./pages/Rates.jsx'));
const Housekeeping = page(() => import('./pages/Housekeeping.jsx'));
const Maintenance = page(() => import('./pages/Maintenance.jsx'));
const Billing = page(() => import('./pages/Billing.jsx'));
const Reports = page(() => import('./pages/Reports.jsx'));
const Channels = page(() => import('./pages/Channels.jsx'));
const Team = page(() => import('./pages/Team.jsx'));
const Settings = page(() => import('./pages/Settings.jsx'));
const Account = page(() => import('./pages/Account.jsx'));
const Audit = page(() => import('./pages/Audit.jsx'));
const PrintInvoice = page(() => import('./pages/PrintInvoice.jsx'));
const PrintRegistration = page(() => import('./pages/PrintRegistration.jsx'));
const PublicBooking = page(() => import('./pages/PublicBooking.jsx'));
const NotFound = page(() => import('./pages/NotFound.jsx'));

/** حارس: لازم مستخدم مسجَّل، وإلا شاشة الدخول (مع حفظ الوجهة للعودة إليها) */
function RequireAuth({ children }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading label="جارٍ فتح الجلسة…" />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.must_change_password) return <Navigate to="/change-password" replace />;
  return children;
}

function GuestOnly({ children }) {
  const { status } = useAuth();
  if (status === 'loading') return <Loading />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return children;
}

function Private() {
  return (
    <RequireAuth>
      <PropertyProvider>
        <Shell />
      </PropertyProvider>
    </RequireAuth>
  );
}

function AppRoutes() {
  const { status, user } = useAuth();
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* صفحة الحجز العام: بلا تسجيل دخول، تُضمَّن في مواقع الفنادق */}
        <Route path="/book/:slug" element={<PublicBooking />} />

        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route
          path="/change-password"
          element={status === 'authenticated' && user.must_change_password ? <MustChangePassword /> : <Navigate to="/" replace />}
        />

        {/* الطباعة: بلا هيكل التطبيق لتخرج الورقة نظيفة */}
        <Route element={<RequireAuth><PropertyProvider><PrintFrame /></PropertyProvider></RequireAuth>}>
          <Route path="/print/invoice/:id" element={<PrintInvoice />} />
          <Route path="/print/registration/:id" element={<PrintRegistration />} />
        </Route>

        <Route element={<Private />}>
          <Route index element={<Today />} />
          <Route path="onboarding" element={<Onboarding />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="reservations" element={<Reservations />} />
          <Route path="reservations/new" element={<NewReservation />} />
          <Route path="reservations/:id" element={<ReservationDetail />} />
          <Route path="guests" element={<Guests />} />
          <Route path="guests/:id" element={<GuestDetail />} />
          <Route path="rooms" element={<Rooms />} />
          <Route path="rates" element={<Rates />} />
          <Route path="housekeeping" element={<Housekeeping />} />
          <Route path="maintenance" element={<Maintenance />} />
          <Route path="billing" element={<Billing />} />
          <Route path="reports" element={<Reports />} />
          <Route path="channels" element={<Channels />} />
          <Route path="team" element={<Team />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/account" element={<Account />} />
          <Route path="audit" element={<Audit />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

/** إطار الطباعة: صفحة نظيفة بلا الشريط الجانبي */
function PrintFrame() {
  return <div className="print-frame"><Outlet /></div>;
}

export default function App() {
  return (
    <AuthProvider>
      <InkFilters />
      <AppRoutes />
    </AuthProvider>
  );
}
