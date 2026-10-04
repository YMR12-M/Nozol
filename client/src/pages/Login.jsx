import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { Logo, Wordmark } from '../lib/icons.jsx';
import { Button, Field, Input, LobbyScene, Notice } from '../components/ui/index.js';

/**
 * مدخل الفندق: يسار الشاشة (يمينها بالعربية) بوّابة مضاءة فيها مكتب الاستقبال، والاستمارة على ورقة.
 * اللوحة الجانبية زينة فقط (aria-hidden) فالعنوان الحقيقي h1 داخل الاستمارة.
 */
export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-screen">
      <section className="auth-lobby" aria-hidden="true">
        <LobbyScene />
        <div className="lobby-sign">
          <Wordmark shadow />
          <span>اتفضّل.. الضيافة تبدأ من دفتر منظّم</span>
        </div>
        <small className="lobby-foot">© نُزُل</small>
      </section>
      <section className="auth-card-wrap">
        <div className="auth-card stack lg">
          <div className="auth-brand">
            <Logo size={44} />
            <div><Wordmark /><small>إدارة الضيافة</small></div>
          </div>
          <div>
            <h1>{title}</h1>
            {subtitle && <p className="muted" style={{ marginTop: 4 }}>{subtitle}</p>}
          </div>
          {children}
          {footer}
        </div>
      </section>
    </div>
  );
}

export default function Login() {
  useDocumentTitle('تسجيل الدخول');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const form = useForm({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const user = await login(form.values.email.trim(), form.values.password);
      navigate(user.must_change_password ? '/change-password' : (location.state?.from ?? '/'), { replace: true });
    } catch (error) {
      setMessage(form.fail(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="أهلًا بيك"
      subtitle="سجّل الدخول لإدارة منشأتك"
      footer={<p className="center small"><Link to="/forgot-password">نسيت كلمة المرور؟</Link></p>}
    >
      <form className="stack" onSubmit={submit} noValidate>
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <Field label="البريد الإلكتروني" error={form.errors.email}>
          {(props) => <Input {...props} type="email" autoComplete="username" autoFocus dir="ltr" className="ltr-input" value={form.values.email} onChange={form.on('email')} required />}
        </Field>
        <Field label="كلمة المرور" error={form.errors.password}>
          {(props) => <Input {...props} type="password" autoComplete="current-password" dir="ltr" className="ltr-input" value={form.values.password} onChange={form.on('password')} required />}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>دخول</Button>
      </form>
    </AuthLayout>
  );
}
