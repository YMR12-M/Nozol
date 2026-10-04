-- ═══════════════════════════════════════════════════════════════
--  0002 — المخزون والتسعير: أنواع الوحدات، الوحدات، الحجب، الأسعار
--
--  «الوحدة» = غرفة أو شاليه أو شقة. «نوع الوحدة» = فئة تُباع (غرفة مزدوجة،
--  شاليه غرفتين...). كل وحدة تُحجز بعينها: هذا ما يجعل منع الحجز المزدوج
--  بسيطًا وحاسمًا (انظر unit_nights في 0003).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE unit_types (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id         BIGINT UNSIGNED NOT NULL,
  code                VARCHAR(30)     NOT NULL,
  name_ar             VARCHAR(120)    NOT NULL,
  name_en             VARCHAR(120)    NULL,
  description_ar      TEXT            NULL,
  description_en      TEXT            NULL,
  kind                ENUM('room','suite','chalet','villa','apartment') NOT NULL DEFAULT 'room',
  -- السعة والتسعير بالأفراد
  base_adults         TINYINT UNSIGNED NOT NULL DEFAULT 2,   -- البالغون المشمولون في السعر الأساسي
  free_children       TINYINT UNSIGNED NOT NULL DEFAULT 0,   -- أطفال مشمولون مجانًا
  max_adults          TINYINT UNSIGNED NOT NULL DEFAULT 2,
  max_children        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_occupancy       TINYINT UNSIGNED NOT NULL DEFAULT 2,
  bedrooms            TINYINT UNSIGNED NOT NULL DEFAULT 1,
  beds                VARCHAR(120)    NULL,                  -- «سريران مفردان» نصّ حرّ
  size_sqm            SMALLINT UNSIGNED NULL,
  base_price_minor    BIGINT UNSIGNED NOT NULL,              -- لليلة لعدد base_adults
  extra_adult_minor   BIGINT UNSIGNED NOT NULL DEFAULT 0,    -- للبالغ الزائد في الليلة
  extra_child_minor   BIGINT UNSIGNED NOT NULL DEFAULT 0,    -- للطفل الزائد في الليلة
  amenities           JSON            NOT NULL DEFAULT (JSON_ARRAY()),
  sort_order          INT             NOT NULL DEFAULT 0,
  is_active           TINYINT(1)      NOT NULL DEFAULT 1,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at          TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_unit_types_code (property_id, code),
  KEY ix_unit_types_property (property_id, is_active, sort_order),
  CONSTRAINT fk_unit_types_property FOREIGN KEY (property_id) REFERENCES properties (id),
  CONSTRAINT ck_unit_types_capacity CHECK (max_occupancy >= 1 AND base_adults >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE units (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id             BIGINT UNSIGNED NOT NULL,
  unit_type_id            BIGINT UNSIGNED NOT NULL,
  code                    VARCHAR(30)     NOT NULL,            -- رقم الغرفة أو اسم الشاليه
  floor                   VARCHAR(20)     NULL,
  notes                   VARCHAR(500)    NULL,
  status                  ENUM('active','out_of_order','archived') NOT NULL DEFAULT 'active',
  housekeeping_status     ENUM('dirty','cleaning','clean','inspected') NOT NULL DEFAULT 'clean',
  housekeeping_updated_at TIMESTAMP       NULL,
  sort_order              INT             NOT NULL DEFAULT 0,
  created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at              TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_units_code (property_id, code),
  KEY ix_units_type (unit_type_id, status),
  KEY ix_units_property (property_id, status, sort_order),
  CONSTRAINT fk_units_property FOREIGN KEY (property_id)  REFERENCES properties (id),
  CONSTRAINT fk_units_type     FOREIGN KEY (unit_type_id) REFERENCES unit_types (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- حجب وحدة لمدّة (صيانة، استخدام المالك، مزامنة iCal). end_date غير شاملة كالمغادرة.
CREATE TABLE unit_blocks (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id   BIGINT UNSIGNED NOT NULL,
  unit_id       BIGINT UNSIGNED NOT NULL,
  start_date    DATE            NOT NULL,
  end_date      DATE            NOT NULL,
  reason        ENUM('maintenance','owner_use','ical','other') NOT NULL DEFAULT 'other',
  note          VARCHAR(255)    NULL,
  external_uid  VARCHAR(190)    NULL,                           -- معرّف الحدث في iCal
  ical_feed_id  BIGINT UNSIGNED NULL,
  created_by    BIGINT UNSIGNED NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_blocks_unit (unit_id, start_date),
  KEY ix_blocks_property (property_id, start_date),
  KEY ix_blocks_feed (ical_feed_id),
  CONSTRAINT fk_blocks_property FOREIGN KEY (property_id) REFERENCES properties (id),
  CONSTRAINT fk_blocks_unit     FOREIGN KEY (unit_id)     REFERENCES units (id),
  CONSTRAINT ck_blocks_dates CHECK (end_date > start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- خطط الأسعار (مع الإفطار، نصف إقامة...). تضيف تكلفة الوجبات وتعدّل الإلغاء.
CREATE TABLE rate_plans (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id       BIGINT UNSIGNED NOT NULL,
  code              VARCHAR(30)     NOT NULL,
  name_ar           VARCHAR(120)    NOT NULL,
  name_en           VARCHAR(120)    NULL,
  description_ar    VARCHAR(500)    NULL,
  description_en    VARCHAR(500)    NULL,
  meal_plan         ENUM('RO','BB','HB','FB','AI') NOT NULL DEFAULT 'RO',  -- بلا وجبات · إفطار · نصف · كاملة · شامل
  meal_adult_minor  BIGINT UNSIGNED NOT NULL DEFAULT 0,          -- للبالغ في الليلة
  meal_child_minor  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  discount_bps      INT UNSIGNED    NOT NULL DEFAULT 0,          -- خصم على سعر الغرفة (مثل غير القابل للاسترداد)
  is_refundable     TINYINT(1)      NOT NULL DEFAULT 1,
  is_default        TINYINT(1)      NOT NULL DEFAULT 0,
  is_public         TINYINT(1)      NOT NULL DEFAULT 1,
  is_active         TINYINT(1)      NOT NULL DEFAULT 1,
  sort_order        INT             NOT NULL DEFAULT 0,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rate_plans_code (property_id, code),
  CONSTRAINT fk_rate_plans_property FOREIGN KEY (property_id) REFERENCES properties (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- قواعد التسعير الموسمية: لكل ليلة تفوز القاعدة الأعلى أولوية (واحدة فقط).
-- القيود (حدّ أدنى للإقامة، إغلاق الوصول/المغادرة، إيقاف البيع) تُجمَع من كل القواعد المطابقة.
CREATE TABLE price_rules (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id         BIGINT UNSIGNED NOT NULL,
  unit_type_id        BIGINT UNSIGNED NOT NULL,
  rate_plan_id        BIGINT UNSIGNED NULL,                      -- NULL = تسري على كل الخطط
  name                VARCHAR(120)    NOT NULL,
  start_date          DATE            NOT NULL,
  end_date            DATE            NOT NULL,                  -- شاملة
  dow_mask            TINYINT UNSIGNED NOT NULL DEFAULT 127,     -- بتّ لكل يوم (0=الأحد)
  kind                ENUM('set_price','percent_adjust','restriction_only') NOT NULL DEFAULT 'set_price',
  price_minor         BIGINT UNSIGNED NULL,                      -- لـ set_price
  percent_bps         INT             NULL,                      -- لـ percent_adjust (+/-)
  min_stay            TINYINT UNSIGNED NULL,
  max_stay            TINYINT UNSIGNED NULL,
  closed_to_arrival   TINYINT(1)      NOT NULL DEFAULT 0,
  closed_to_departure TINYINT(1)      NOT NULL DEFAULT 0,
  stop_sell           TINYINT(1)      NOT NULL DEFAULT 0,
  priority            INT             NOT NULL DEFAULT 0,
  is_active           TINYINT(1)      NOT NULL DEFAULT 1,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_price_rules_lookup (property_id, unit_type_id, is_active, start_date, end_date),
  CONSTRAINT fk_price_rules_property FOREIGN KEY (property_id)  REFERENCES properties (id),
  CONSTRAINT fk_price_rules_type     FOREIGN KEY (unit_type_id) REFERENCES unit_types (id),
  CONSTRAINT fk_price_rules_plan     FOREIGN KEY (rate_plan_id) REFERENCES rate_plans (id),
  CONSTRAINT ck_price_rules_dates CHECK (end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE promo_codes (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id    BIGINT UNSIGNED NOT NULL,
  code           VARCHAR(30)     NOT NULL,
  description    VARCHAR(190)    NULL,
  discount_type  ENUM('percent','fixed') NOT NULL,
  value          BIGINT UNSIGNED NOT NULL,                       -- bps للنسبة، أو قروش للمبلغ
  valid_from     DATE            NULL,                           -- نافذة الحجز
  valid_to       DATE            NULL,
  stay_from      DATE            NULL,                           -- نافذة الإقامة
  stay_to        DATE            NULL,
  min_nights     TINYINT UNSIGNED NOT NULL DEFAULT 1,
  max_uses       INT UNSIGNED    NULL,
  uses_count     INT UNSIGNED    NOT NULL DEFAULT 0,
  is_active      TINYINT(1)      NOT NULL DEFAULT 1,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_promo_codes_code (property_id, code),
  CONSTRAINT fk_promo_codes_property FOREIGN KEY (property_id) REFERENCES properties (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- كتالوج الخدمات الإضافية (إفطار إضافي، توصيل مطار، غسيل...) تُضاف على فاتورة الحجز.
CREATE TABLE services (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id         BIGINT UNSIGNED NOT NULL,
  name_ar             VARCHAR(120)    NOT NULL,
  name_en             VARCHAR(120)    NULL,
  price_minor         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  taxable             TINYINT(1)      NOT NULL DEFAULT 1,
  service_chargeable  TINYINT(1)      NOT NULL DEFAULT 1,
  is_active           TINYINT(1)      NOT NULL DEFAULT 1,
  sort_order          INT             NOT NULL DEFAULT 0,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_services_property (property_id, is_active, sort_order),
  CONSTRAINT fk_services_property FOREIGN KEY (property_id) REFERENCES properties (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
