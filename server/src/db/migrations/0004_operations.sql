-- ═══════════════════════════════════════════════════════════════
--  0004 — العمليات اليومية: التنظيف، الصيانة، المرفقات، iCal، الإشعارات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE housekeeping_tasks (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id     BIGINT UNSIGNED NOT NULL,
  unit_id         BIGINT UNSIGNED NOT NULL,
  reservation_id  BIGINT UNSIGNED NULL,
  type            ENUM('checkout_clean','stayover_clean','inspection','deep_clean','turndown','other') NOT NULL DEFAULT 'checkout_clean',
  status          ENUM('pending','in_progress','done','verified','skipped') NOT NULL DEFAULT 'pending',
  priority        ENUM('normal','high','urgent') NOT NULL DEFAULT 'normal',
  due_date        DATE            NOT NULL,
  assigned_to     BIGINT UNSIGNED NULL,
  note            VARCHAR(500)    NULL,
  started_at      TIMESTAMP       NULL,
  completed_at    TIMESTAMP       NULL,
  verified_by     BIGINT UNSIGNED NULL,
  verified_at     TIMESTAMP       NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_hk_board (property_id, due_date, status),
  KEY ix_hk_assignee (assigned_to, status),
  KEY ix_hk_unit (unit_id, status),
  CONSTRAINT fk_hk_property FOREIGN KEY (property_id) REFERENCES properties (id),
  CONSTRAINT fk_hk_unit     FOREIGN KEY (unit_id)     REFERENCES units (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE maintenance_requests (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id   BIGINT UNSIGNED NOT NULL,
  unit_id       BIGINT UNSIGNED NULL,
  title         VARCHAR(190)    NOT NULL,
  description   TEXT            NULL,
  priority      ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  status        ENUM('open','in_progress','waiting_parts','resolved','cancelled') NOT NULL DEFAULT 'open',
  reported_by   BIGINT UNSIGNED NULL,
  assigned_to   BIGINT UNSIGNED NULL,
  cost_minor    BIGINT UNSIGNED NULL,
  resolved_at   TIMESTAMP       NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_maint_property (property_id, status, priority),
  KEY ix_maint_unit (unit_id),
  CONSTRAINT fk_maint_property FOREIGN KEY (property_id) REFERENCES properties (id),
  CONSTRAINT fk_maint_unit     FOREIGN KEY (unit_id)     REFERENCES units (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- مرفقات عامة: صور الوحدات (علنية) وصور الهويّات والإيصالات وأعطال الصيانة (خاصة)
CREATE TABLE attachments (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id    BIGINT UNSIGNED NOT NULL,
  entity         ENUM('unit_type','guest','reservation','maintenance','housekeeping','expense') NOT NULL,
  entity_id      BIGINT UNSIGNED NOT NULL,
  visibility     ENUM('public','private') NOT NULL DEFAULT 'private',
  file_path      VARCHAR(255)    NOT NULL,
  mime           VARCHAR(60)     NOT NULL,
  size_bytes     INT UNSIGNED    NOT NULL,
  original_name  VARCHAR(190)    NULL,
  sort_order     INT             NOT NULL DEFAULT 0,
  uploaded_by    BIGINT UNSIGNED NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_attachments_entity (property_id, entity, entity_id),
  CONSTRAINT fk_attachments_property FOREIGN KEY (property_id) REFERENCES properties (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- مزامنة iCal: استيراد تقويم وحدة من Airbnb/Booking.com (يتحوّل إلى حجب)،
-- وتصدير تقويمنا برابط سرّي تقرأه تلك المنصّات فتمنع الحجز المزدوج.
CREATE TABLE ical_feeds (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id      BIGINT UNSIGNED NOT NULL,
  unit_id          BIGINT UNSIGNED NOT NULL,
  name             VARCHAR(120)    NOT NULL,
  url              VARCHAR(600)    NOT NULL,
  is_active        TINYINT(1)      NOT NULL DEFAULT 1,
  last_synced_at   TIMESTAMP       NULL,
  last_status      VARCHAR(190)    NULL,
  last_event_count INT UNSIGNED    NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ical_feeds_property (property_id, is_active),
  KEY ix_ical_feeds_unit (unit_id),
  CONSTRAINT fk_ical_property FOREIGN KEY (property_id) REFERENCES properties (id),
  CONSTRAINT fk_ical_unit     FOREIGN KEY (unit_id)     REFERENCES units (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ical_export_tokens (
  unit_id     BIGINT UNSIGNED NOT NULL,
  token       CHAR(48)        NOT NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (unit_id),
  UNIQUE KEY uq_ical_export_token (token),
  CONSTRAINT fk_ical_export_unit FOREIGN KEY (unit_id) REFERENCES units (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- صندوق الإشعارات: كل رسالة تُكتب هنا أولًا ثم يرسلها عامل خلفي مع إعادة محاولة.
-- فلا يضيع بريد لأن مزوّد الخدمة وقع لحظة الحجز.
CREATE TABLE notification_outbox (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id   BIGINT UNSIGNED NULL,
  channel       ENUM('email','push') NOT NULL,
  to_address    VARCHAR(500)    NOT NULL,
  template      VARCHAR(60)     NOT NULL,
  payload       JSON            NOT NULL,
  status        ENUM('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error    VARCHAR(500)    NULL,
  scheduled_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at       TIMESTAMP       NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_outbox_due (status, scheduled_at),
  KEY ix_outbox_property (property_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE push_subscriptions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  endpoint    VARCHAR(600)    NOT NULL,
  endpoint_hash CHAR(64)      NOT NULL,
  p256dh      VARCHAR(255)    NOT NULL,
  auth        VARCHAR(255)    NOT NULL,
  user_agent  VARCHAR(255)    NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_endpoint (endpoint_hash),
  KEY ix_push_user (user_id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
