import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { Logo } from '../lib/icons.jsx';
import { Button, Field, Input, Notice } from '../components/ui/index.js';

export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-screen">
      <section className="auth-hero">
        <div className="row"><Logo size={44} /><b style={{ fontSize: 'var(--fs-xl)' }}>نُزُل</b></div>
        <div>
          <h1>ضيافة منظّمة، حجوزات بلا أخطاء.</h1>
          <p>إدارة الغرف والشاليهات والحجوزات والفواتير والتنظيف من مكان واحد — على الكمبيوتر والموبايل.</p>
        </div>
        <small style={{ color: 'var(--teal-200)' }}>© نُزُل</small>
      </section>
      <section className="auth-card-wrap">
        <div className="auth-card stack lg">
          <div className="row" style={{ display: 'none' }} />
          <div>
            <h2 style={{ fontSize: 'var(--fs-2xl)' }}>{title}</h2>
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
