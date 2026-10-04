import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useProperty } from '../context/PropertyContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatClock, formatDate, formatMoney, formatPhone, formatWeekday, nightsLabel, percent } from '../lib/format.js';
import { HK_COLORS, HK_LABELS, METHOD_LABELS } from '../lib/constants.js';
import { Icon } from '../lib/icons.jsx';
import {
  Badge, Button, Card, EmptyState, ErrorState, Loading, Notice, PageHead, Stat, StatusBadge,
} from '../components/ui/index.js';

/** صفّ حجز: الرابط يغطّي المحتوى، والإجراء السريع (زر) خارجه كي لا يتداخل تفاعلان */
function GuestRow({ reservation, currency, action }) {
  return (
    <div className="list-row">
      <Link to={`/reservations/${reservation.id}`} className="list-link">
        <div className="main">
          <div className="row" style={{ gap: 8 }}>
            <b className="truncate">{reservation.guest_name}</b>
            {reservation.is_vip && <Badge tone="accent">VIP</Badge>}
            <span className="code-pill">{reservation.code}</span>
          </div>
          <div className="muted small row wrap" style={{ gap: 12 }}>
            <span>وحدة {reservation.unit_codes ?? '—'}</span>
            <span className="num">{reservation.adults} + {reservation.children}</span>
            <span>{nightsLabel(reservation.nights)}</span>
            {reservation.expected_arrival && <span className="num">وصول {formatClock(reservation.expected_arrival)}</span>}
            {reservation.guest_phone && <span className="num">{formatPhone(reservation.guest_phone)}</span>}
          </div>
        </div>
        <div style={{ textAlign: 'end' }}>
          {reservation.balance_minor > 0
            ? <div className="small bold" style={{ color: 'var(--danger-text)' }}>متبقي {formatMoney(reservation.balance_minor, currency, { compact: true })}</div>
            : <div className="small" style={{ color: 'var(--success-text)' }}>مسدّد</div>}
          <StatusBadge status={reservation.status} />
        </div>
      </Link>
      {action}
    </div>
  );
}

export default function Today() {
  useDocumentTitle('اليوم');
  const { api, property } = useProperty();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['today', api.id],
    queryFn: () => api.get('/reports/today'),
    refetchInterval: 60_000,
  });

  const checkIn = useMutation({
    mutationFn: (id) => api.post(`/reservations/${id}/check-in`, {}),
    onSuccess: (result) => {
      toast.success(`تمّ تسجيل دخول ${result.reservation.guest_name}`);
      result.warnings?.forEach((warning) => toast.info(warning.message));
      queryClient.invalidateQueries({ queryKey: ['today'] });
    },
    onError: (error, id) => {
      toast.error(error.message);
      if (['UNIT_NOT_READY', 'TOO_EARLY'].includes(error.code)) navigate(`/reservations/${id}`);
    },
  });

  if (query.isLoading) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const data = query.data;
  const { stats } = data;
  const currency = property?.currency ?? 'EGP';

  return (
    <div className="page">
      <PageHead
        title={`اليوم — ${formatWeekday(data.date)}`}
        description={formatDate(data.date)}
        actions={can('reservations.write') && <Button variant="primary" icon="plus" onClick={() => navigate('/reservations/new')}>حجز جديد</Button>}
      />

      {(data.overdue_departures.length > 0 || stats.pending_expiring_soon > 0 || stats.urgent_maintenance > 0) && (
        <div className="stack sm">
          {data.overdue_departures.length > 0 && (
            <Notice tone="danger" icon="alert" action={<Link to="/reservations?in_house=true">عرض</Link>}>
              {data.overdue_departures.length} نزيل تجاوز موعد المغادرة ولم يُسجَّل خروجه.
            </Notice>
          )}
          {stats.pending_expiring_soon > 0 && (
            <Notice tone="warning" icon="clock" action={<Link to="/reservations?status=pending">عرض</Link>}>
              {stats.pending_expiring_soon} حجز معلّق مهلته تنتهي خلال 6 ساعات.
            </Notice>
          )}
          {stats.urgent_maintenance > 0 && (
            <Notice tone="danger" icon="wrench" action={<Link to="/maintenance">عرض</Link>}>
              {stats.urgent_maintenance} طلب صيانة عاجل مفتوح.
            </Notice>
          )}
        </div>
      )}

      <div className="stat-row">
        <Stat label="يصلون اليوم" value={stats.arrivals} icon="login" />
        <Stat label="يغادرون اليوم" value={stats.departures} icon="logout" />
        <Stat label="مقيمون الآن" value={stats.in_house} icon="bed" />
        <Stat label="الإشغال الليلة" value={percent(stats.occupancy_pct)} sub={`${stats.occupied_tonight} من ${stats.available_tonight} وحدة${stats.held_tonight ? ` (+${stats.held_tonight} محجوزة مؤقتًا)` : ''}`} icon="chart" />
        <Stat label="حجوزات معلّقة" value={stats.pending_bookings} icon="clock" tone={stats.pending_bookings > 0 ? 'warning' : undefined} />
        <Stat label="مستحقات المقيمين" value={formatMoney(stats.unpaid_in_house_minor, currency, { compact: true })} sub={`${stats.unpaid_in_house_count} حجز`} icon="dollar" tone={stats.unpaid_in_house_minor > 0 ? 'danger' : undefined} />
      </div>

      <div className="today-cols">
        <Card title={`الوصول اليوم (${data.arrivals.length})`} flush>
          {data.arrivals.length === 0 ? <EmptyState icon="login" title="مفيش وصول النهاردة" /> : data.arrivals.map((reservation) => (
            <GuestRow
              key={reservation.id}
              reservation={reservation}
              currency={currency}
              action={reservation.status === 'confirmed' && can('reservations.checkin') && (
                <Button
                  variant={reservation.units_not_ready > 0 ? 'secondary' : 'primary'}
                  size="sm"
                  loading={checkIn.isPending && checkIn.variables === reservation.id}
                  title={reservation.units_not_ready > 0 ? 'الغرفة لسه متنضّفتش' : 'تسجيل دخول'}
                  onClick={() => checkIn.mutate(reservation.id)}
                >
                  {reservation.units_not_ready > 0 ? 'غير جاهزة' : 'دخول'}
                </Button>
              )}
            />
          ))}
        </Card>

        <Card title={`المغادرة اليوم (${data.departures.length})`} flush>
          {data.departures.length === 0 ? <EmptyState icon="logout" title="مفيش مغادرة النهاردة" /> : data.departures.map((reservation) => (
            <GuestRow key={reservation.id} reservation={reservation} currency={currency} />
          ))}
        </Card>

        <Card title={`المقيمون (${data.in_house.length})`} flush>
          {data.in_house.length === 0 ? <EmptyState icon="bed" title="مفيش مقيمين مستمرين" /> : data.in_house.map((reservation) => (
            <GuestRow key={reservation.id} reservation={reservation} currency={currency} />
          ))}
        </Card>

        <div className="stack">
          <Card title="جاهزية الغرف" actions={<Link to="/housekeeping" className="small">اللوحة ←</Link>}>
            <div className="hk-summary">
              {['dirty', 'cleaning', 'clean', 'inspected'].map((status) => (
                <div key={status}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: HK_COLORS[status] }} />
                  <b className="num">{data.housekeeping[status]}</b>
                  <span className="muted small">{HK_LABELS[status]}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="مقبوضات اليوم">
            {data.payments_today.length === 0 ? <p className="muted">مفيش مقبوضات لسه.</p> : (
              <div className="totals">
                {data.payments_today.map((row) => (
                  <div className="line" key={row.method}><span>{METHOD_LABELS[row.method]}</span><b className="num">{formatMoney(row.net_minor, currency)}</b></div>
                ))}
                <div className="line total"><span>الإجمالي</span><span className="num">{formatMoney(data.payments_today.reduce((sum, row) => sum + row.net_minor, 0), currency)}</span></div>
              </div>
            )}
          </Card>
          <div className="row" style={{ gap: 6 }}><Icon name="info" size={14} /><span className="muted xsmall">تتحدّث اللوحة تلقائيًّا كل دقيقة.</span></div>
        </div>
      </div>
    </div>
  );
}
