-- ═══════════════════════════════════════════════════════════════
--  0001 — النواة: المنظّمات والمستخدمون والمنشآت والجلسات والتدقيق
--
--  المبالغ كلها BIGINT بأصغر وحدة (قروش). النِّسَب basis points (1400 = 14%).
--  التواريخ التقويمية DATE بلا منطقة زمنية، واللحظات TIMESTAMP (UTC).
-- ═══════════════════════════════════════════════════════════════

-- المنظّمة = العميل. تفصل بيانات كل عميل عن الآخر، فيخدم نشرٌ واحد عدّة عملاء.
CREATE TABLE organizations (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid        CHAR(36)        NOT NULL,
  name        VARCHAR(150)    NOT NULL,
  status      ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_organizations_uuid (uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                  CHAR(36)        NOT NULL,
  organization_id       BIGINT UNSIGNED NOT NULL,
  full_name             VARCHAR(120)    NOT NULL,
  email                 VARCHAR(190)    NOT NULL,
  phone                 VARCHAR(30)     NULL,
  password_hash         VARCHAR(100)    NOT NULL,
  role                  ENUM('owner','manager','front_desk','housekeeping','accountant','viewer') NOT NULL,
  status                ENUM('active','suspended') NOT NULL DEFAULT 'active',
  preferred_lang        ENUM('ar','en') NOT NULL DEFAULT 'ar',
  must_change_password  TINYINT(1)      NOT NULL DEFAULT 0,
  failed_logins         INT UNSIGNED    NOT NULL DEFAULT 0,
  locked_until          TIMESTAMP       NULL,
  last_login_at         TIMESTAMP       NULL,
  password_changed_at   TIMESTAMP       NULL,
  created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at            TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_uuid (uuid),
  UNIQUE KEY uq_users_email (email),
  KEY ix_users_org (organization_id, role),
  CONSTRAINT fk_users_org FOREIGN KEY (organization_id) REFERENCES organizations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- المنشأة: فندق / شاليه / بيت ضيافة. كل بيانات التشغيل تتبعها عبر property_id.
CREATE TABLE properties (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                      CHAR(36)        NOT NULL,
  organization_id           BIGINT UNSIGNED NOT NULL,
  slug                      VARCHAR(80)     NOT NULL,
  kind                      ENUM('hotel','guesthouse','chalet','apartments','resort','hostel') NOT NULL DEFAULT 'hotel',
  name_ar                   VARCHAR(150)    NOT NULL,
  name_en                   VARCHAR(150)    NULL,
  description_ar            TEXT            NULL,
  description_en            TEXT            NULL,
  phone                     VARCHAR(30)     NULL,
  whatsapp                  VARCHAR(30)     NULL,
  email                     VARCHAR(190)    NULL,
  address_ar                VARCHAR(255)    NULL,
  address_en                VARCHAR(255)    NULL,
  city                      VARCHAR(80)     NULL,
  governorate               VARCHAR(80)     NULL,
  latitude                  DECIMAL(9,6)    NULL,
  longitude                 DECIMAL(9,6)    NULL,
  timezone                  VARCHAR(60)     NOT NULL DEFAULT 'Africa/Cairo',
  currency                  CHAR(3)         NOT NULL DEFAULT 'EGP',
  check_in_time             TIME            NOT NULL DEFAULT '14:00:00',
  check_out_time            TIME            NOT NULL DEFAULT '12:00:00',
  -- الضرائب والرسوم: تُضبط من المالك (لا قيم مفترضة — الصفر يعني لا شيء)
  tax_bps                   INT UNSIGNED    NOT NULL DEFAULT 0,
  service_charge_bps        INT UNSIGNED    NOT NULL DEFAULT 0,
  tax_on_service_charge     TINYINT(1)      NOT NULL DEFAULT 0,
  prices_include_tax        TINYINT(1)      NOT NULL DEFAULT 0,
  city_fee_per_night_minor  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  -- الحجز الإلكتروني
  deposit_percent           INT UNSIGNED    NOT NULL DEFAULT 0,
  hold_hours                INT UNSIGNED    NOT NULL DEFAULT 24,
  free_cancel_hours         INT UNSIGNED    NOT NULL DEFAULT 48,
  cancellation_policy_ar    TEXT            NULL,
  cancellation_policy_en    TEXT            NULL,
  public_booking_enabled    TINYINT(1)      NOT NULL DEFAULT 0,
  invoice_prefix            VARCHAR(10)     NOT NULL DEFAULT 'INV',
  booking_prefix            VARCHAR(10)     NOT NULL DEFAULT 'NZ',
  status                    ENUM('active','archived') NOT NULL DEFAULT 'active',
  created_at                TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_properties_uuid (uuid),
  UNIQUE KEY uq_properties_slug (slug),
  KEY ix_properties_org (organization_id, status),
  CONSTRAINT fk_properties_org FOREIGN KEY (organization_id) REFERENCES organizations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- أيّ المنشآت يصل إليها غير المالك (المالك يصل لكل منشآت منظّمته)
CREATE TABLE user_properties (
  user_id      BIGINT UNSIGNED NOT NULL,
  property_id  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, property_id),
  KEY ix_user_properties_property (property_id),
  CONSTRAINT fk_up_user     FOREIGN KEY (user_id)     REFERENCES users (id)      ON DELETE CASCADE,
  CONSTRAINT fk_up_property FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- توكنات التجديد: نخزّن البصمة فقط. family_id يربط سلسلة التدوير،
-- فإعادة استخدام توكن مستبدَل (علامة سرقة) تُلغي السلسلة كلها.
CREATE TABLE refresh_tokens (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  family_id    CHAR(36)        NOT NULL,
  token_hash   CHAR(64)        NOT NULL,
  client_type  ENUM('web','mobile','desktop') NOT NULL DEFAULT 'web',
  user_agent   VARCHAR(255)    NULL,
  ip_address   VARCHAR(45)     NULL,
  expires_at   TIMESTAMP       NOT NULL,
  used_at      TIMESTAMP       NULL,
  revoked_at   TIMESTAMP       NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_hash (token_hash),
  KEY ix_refresh_user (user_id, revoked_at),
  KEY ix_refresh_family (family_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE password_resets (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  CHAR(64)        NOT NULL,
  expires_at  TIMESTAMP       NOT NULL,
  used_at     TIMESTAMP       NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_resets_hash (token_hash),
  KEY ix_password_resets_user (user_id),
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- سجل التدقيق: مَن غيّر ماذا ومتى (قبل/بعد). لا يُحذف ولا يُعدَّل من التطبيق.
CREATE TABLE audit_logs (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NULL,
  property_id      BIGINT UNSIGNED NULL,
  user_id          BIGINT UNSIGNED NULL,
  action           VARCHAR(60)     NOT NULL,
  entity           VARCHAR(40)     NOT NULL,
  entity_id        BIGINT UNSIGNED NULL,
  before_json      JSON            NULL,
  after_json       JSON            NULL,
  ip               VARCHAR(45)     NULL,
  user_agent       VARCHAR(255)    NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_audit_entity (entity, entity_id),
  KEY ix_audit_property (property_id, created_at),
  KEY ix_audit_org (organization_id, created_at),
  KEY ix_audit_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- عدّادات متسلسلة لكل منشأة (أكواد الحجز، أرقام الفواتير) تُزاد ذرّيًا.
CREATE TABLE counters (
  property_id  BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(30)     NOT NULL,
  value        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, name),
  CONSTRAINT fk_counters_property FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
