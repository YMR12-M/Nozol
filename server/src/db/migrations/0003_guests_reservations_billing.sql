-- ═══════════════════════════════════════════════════════════════
--  0003 — النزلاء والحجوزات والفواتير والمدفوعات
--
--  أهم قرار هنا: جدول unit_nights. صفّ لكل (وحدة، ليلة) بمفتاح أساسي
--  مركّب، فيستحيل على قاعدة البيانات نفسها أن تقبل حجزين لنفس الوحدة
--  في نفس الليلة — حتى لو وصل طلبان في نفس اللحظة من جهازين.
--  لا نعتمد على فحصٍ في التطبيق «ثم» إدراج، لأن بينهما ثغرة سباق.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE guests (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id         BIGINT UNSIGNED NOT NULL,
  full_name           VARCHAR(150)    NOT NULL,
  phone               VARCHAR(30)     NULL,
  email               VARCHAR(190)    NULL,
  nationality         VARCHAR(60)     NULL,
  id_type             ENUM('national_id','passport','other') NULL,
  id_number           VARCHAR(40)     NULL,
  birth_date          DATE            NULL,
  address             VARCHAR(255)    NULL,
  notes               VARCHAR(1000)   NULL,
  is_vip              TINYINT(1)      NOT NULL DEFAULT 0,
  is_blacklisted      TINYINT(1)      NOT NULL DEFAULT 0,
  total_stays         INT UNSIGNED    NOT NULL DEFAULT 0,
  total_spent_minor   BIGINT          NOT NULL DEFAULT 0,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at          TIMESTAMP       NULL,
  PRIMARY KEY (id),
  KEY ix_guests_phone (property_id, phone),
  KEY ix_guests_name (property_id, full_name),
  KEY ix_guests_id (property_id, id_number),
  CONSTRAINT fk_guests_property FOREIGN KEY (property_id) REFERENCES properties (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reservations (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id           BIGINT UNSIGNED NOT NULL,
  code                  VARCHAR(30)     NOT NULL,            -- تسلسلي للموظفين: NZ-000123
  public_code           CHAR(8)         NOT NULL,            -- عشوائي للنزيل (لا يُخمَّن)
  guest_id              BIGINT UNSIGNED NOT NULL,
  status                ENUM('pending','confirmed','checked_in','checked_out','cancelled','no_show') NOT NULL DEFAULT 'confirmed',
  source                ENUM('direct','phone','walk_in','website','booking_com','airbnb','other') NOT NULL DEFAULT 'direct',
  external_ref          VARCHAR(80)     NULL,
  check_in              DATE            NOT NULL,
  check_out             DATE            NOT NULL,
  nights                SMALLINT UNSIGNED NOT NULL,
  adults                TINYINT UNSIGNED NOT NULL DEFAULT 1,
  children              TINYINT UNSIGNED NOT NULL DEFAULT 0,
  rate_plan_id          BIGINT UNSIGNED NULL,
  promo_code_id         BIGINT UNSIGNED NULL,
  currency              CHAR(3)         NOT NULL DEFAULT 'EGP',
  -- لقطة الأرقام (تُعاد حسابها مع كل تعديل على الفاتورة)
  rooms_minor           BIGINT          NOT NULL DEFAULT 0,
  extra_guest_minor     BIGINT          NOT NULL DEFAULT 0,
  meal_minor            BIGINT          NOT NULL DEFAULT 0,
  extras_minor          BIGINT          NOT NULL DEFAULT 0,
  discount_minor        BIGINT          NOT NULL DEFAULT 0,  -- موجب، يُطرح من الإجمالي
  service_charge_minor  BIGINT          NOT NULL DEFAULT 0,
  tax_minor             BIGINT          NOT NULL DEFAULT 0,
  city_fee_minor        BIGINT          NOT NULL DEFAULT 0,
  total_minor           BIGINT          NOT NULL DEFAULT 0,
  paid_minor            BIGINT          NOT NULL DEFAULT 0,  -- صافي المدفوعات (دفعات − مرتجعات)
  deposit_due_minor     BIGINT          NOT NULL DEFAULT 0,
  hold_expires_at       TIMESTAMP       NULL,                -- للحجز المعلّق: ينتهي ويُحرَّر
  expected_arrival      TIME            NULL,
  guest_notes           VARCHAR(1000)   NULL,                -- ما كتبه النزيل
  internal_notes        TEXT            NULL,                -- للموظفين فقط
  checked_in_at         TIMESTAMP       NULL,
  checked_out_at        TIMESTAMP       NULL,
  cancelled_at          TIMESTAMP       NULL,
  cancel_reason         VARCHAR(255)    NULL,
  created_by            BIGINT UNSIGNED NULL,
  created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reservations_code (property_id, code),
  UNIQUE KEY uq_reservations_public (property_id, public_code),
  KEY ix_res_checkin (property_id, check_in),
  KEY ix_res_checkout (property_id, check_out),
  KEY ix_res_status (property_id, status, check_in),
  KEY ix_res_guest (guest_id),
  KEY ix_res_hold (status, hold_expires_at),
  CONSTRAINT fk_res_property FOREIGN KEY (property_id)   REFERENCES properties (id),
  CONSTRAINT fk_res_guest    FOREIGN KEY (guest_id)      REFERENCES guests (id),
  CONSTRAINT fk_res_plan     FOREIGN KEY (rate_plan_id)  REFERENCES rate_plans (id),
  CONSTRAINT fk_res_promo    FOREIGN KEY (promo_code_id) REFERENCES promo_codes (id),
  CONSTRAINT ck_res_dates CHECK (check_out > check_in)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- وحدة (أو أكثر) داخل الحجز. نقل غرفة = إنهاء الجزء الحالي وبدء جزء جديد.
CREATE TABLE reservation_units (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reservation_id     BIGINT UNSIGNED NOT NULL,
  unit_id            BIGINT UNSIGNED NOT NULL,
  unit_type_id       BIGINT UNSIGNED NOT NULL,
  check_in           DATE            NOT NULL,
  check_out          DATE            NOT NULL,
  adults             TINYINT UNSIGNED NOT NULL DEFAULT 1,
  children           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  rate_plan_id       BIGINT UNSIGNED NULL,
  rooms_minor        BIGINT          NOT NULL DEFAULT 0,
  extra_guest_minor  BIGINT          NOT NULL DEFAULT 0,
  meal_minor         BIGINT          NOT NULL DEFAULT 0,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ru_reservation (reservation_id),
  KEY ix_ru_unit (unit_id, check_in),
  CONSTRAINT fk_ru_reservation FOREIGN KEY (reservation_id) REFERENCES reservations (id) ON DELETE CASCADE,
  CONSTRAINT fk_ru_unit        FOREIGN KEY (unit_id)        REFERENCES units (id),
  CONSTRAINT fk_ru_type        FOREIGN KEY (unit_type_id)   REFERENCES unit_types (id),
  CONSTRAINT fk_ru_plan        FOREIGN KEY (rate_plan_id)   REFERENCES rate_plans (id),
  CONSTRAINT ck_ru_dates CHECK (check_out > check_in)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- تفصيل سعر كل ليلة (للتدقيق والتقارير: إيراد كل ليلة). يبقى بعد الإلغاء.
CREATE TABLE reservation_nights (
  reservation_unit_id  BIGINT UNSIGNED NOT NULL,
  night                DATE            NOT NULL,
  room_minor           BIGINT          NOT NULL DEFAULT 0,
  extra_guest_minor    BIGINT          NOT NULL DEFAULT 0,
  meal_minor           BIGINT          NOT NULL DEFAULT 0,
  rule_id              BIGINT UNSIGNED NULL,
  PRIMARY KEY (reservation_unit_id, night),
  KEY ix_rn_night (night),
  CONSTRAINT fk_rn_ru FOREIGN KEY (reservation_unit_id) REFERENCES reservation_units (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- القفل الذرّي: لا يوجد صفّان لنفس (وحدة، ليلة). إمّا reservation_unit_id أو block_id.
-- (لا CHECK هنا: MySQL يمنعه على أعمدة لها ON DELETE CASCADE — يُفرَض من الكود.)
CREATE TABLE unit_nights (
  unit_id              BIGINT UNSIGNED NOT NULL,
  night                DATE            NOT NULL,
  reservation_unit_id  BIGINT UNSIGNED NULL,
  block_id             BIGINT UNSIGNED NULL,
  PRIMARY KEY (unit_id, night),
  KEY ix_unit_nights_night (night, unit_id),
  KEY ix_unit_nights_ru (reservation_unit_id),
  KEY ix_unit_nights_block (block_id),
  CONSTRAINT fk_un_unit  FOREIGN KEY (unit_id)             REFERENCES units (id),
  CONSTRAINT fk_un_ru    FOREIGN KEY (reservation_unit_id) REFERENCES reservation_units (id) ON DELETE CASCADE,
  CONSTRAINT fk_un_block FOREIGN KEY (block_id)            REFERENCES unit_blocks (id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- بنود الفاتورة الإضافية (الغرفة نفسها تُحسب من reservation_nights).
-- المبلغ بالإشارة: الخصم سالب. الإلغاء لا يحذف بل يضع voided_at.
CREATE TABLE folio_items (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id         BIGINT UNSIGNED NOT NULL,
  reservation_id      BIGINT UNSIGNED NOT NULL,
  type                ENUM('service','charge','discount','fee','adjustment') NOT NULL DEFAULT 'charge',
  service_id          BIGINT UNSIGNED NULL,
  description         VARCHAR(190)    NOT NULL,
  quantity            DECIMAL(10,2)   NOT NULL DEFAULT 1,
  unit_price_minor    BIGINT          NOT NULL DEFAULT 0,
  amount_minor        BIGINT          NOT NULL,
  taxable             TINYINT(1)      NOT NULL DEFAULT 1,
  service_chargeable  TINYINT(1)      NOT NULL DEFAULT 1,
  posted_on           DATE            NOT NULL,
  posted_by           BIGINT UNSIGNED NULL,
  voided_at           TIMESTAMP       NULL,
  voided_by           BIGINT UNSIGNED NULL,
  void_reason         VARCHAR(255)    NULL,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_folio_reservation (reservation_id, voided_at),
  CONSTRAINT fk_folio_property    FOREIGN KEY (property_id)    REFERENCES properties (id),
  CONSTRAINT fk_folio_reservation FOREIGN KEY (reservation_id) REFERENCES reservations (id),
  CONSTRAINT fk_folio_service     FOREIGN KEY (service_id)     REFERENCES services (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cash_shifts (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id          BIGINT UNSIGNED NOT NULL,
  user_id              BIGINT UNSIGNED NOT NULL,
  opened_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opening_float_minor  BIGINT          NOT NULL DEFAULT 0,
  closed_at            TIMESTAMP       NULL,
  counted_cash_minor   BIGINT          NULL,
  expected_cash_minor  BIGINT          NULL,
  difference_minor     BIGINT          NULL,
  note                 VARCHAR(500)    NULL,
  PRIMARY KEY (id),
  KEY ix_shifts_property (property_id, opened_at),
  KEY ix_shifts_open (property_id, user_id, closed_at),
  CONSTRAINT fk_shifts_property FOREIGN KEY (property_id) REFERENCES properties (id),
  CONSTRAINT fk_shifts_user     FOREIGN KEY (user_id)     REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payments (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id     BIGINT UNSIGNED NOT NULL,
  reservation_id  BIGINT UNSIGNED NOT NULL,
  type            ENUM('payment','refund') NOT NULL DEFAULT 'payment',
  method          ENUM('cash','card','bank_transfer','instapay','wallet','other') NOT NULL,
  amount_minor    BIGINT UNSIGNED NOT NULL,
  reference       VARCHAR(120)    NULL,
  note            VARCHAR(255)    NULL,
  received_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_by     BIGINT UNSIGNED NULL,
  shift_id        BIGINT UNSIGNED NULL,
  voided_at       TIMESTAMP       NULL,
  voided_by       BIGINT UNSIGNED NULL,
  void_reason     VARCHAR(255)    NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_payments_reservation (reservation_id, voided_at),
  KEY ix_payments_property (property_id, received_at),
  KEY ix_payments_shift (shift_id),
  CONSTRAINT fk_payments_property    FOREIGN KEY (property_id)    REFERENCES properties (id),
  CONSTRAINT fk_payments_reservation FOREIGN KEY (reservation_id) REFERENCES reservations (id),
  CONSTRAINT fk_payments_shift       FOREIGN KEY (shift_id)       REFERENCES cash_shifts (id),
  CONSTRAINT ck_payments_amount CHECK (amount_minor > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- الفاتورة: لقطة ثابتة وقت الإصدار (لا تتغيّر لو تغيّر الحجز بعدها).
CREATE TABLE invoices (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id           BIGINT UNSIGNED NOT NULL,
  reservation_id        BIGINT UNSIGNED NOT NULL,
  number                VARCHAR(40)     NOT NULL,
  status                ENUM('issued','void') NOT NULL DEFAULT 'issued',
  bill_to_name          VARCHAR(190)    NOT NULL,
  bill_to_tax_id        VARCHAR(40)     NULL,
  bill_to_address       VARCHAR(255)    NULL,
  subtotal_minor        BIGINT          NOT NULL,
  discount_minor        BIGINT          NOT NULL DEFAULT 0,
  service_charge_minor  BIGINT          NOT NULL DEFAULT 0,
  tax_minor             BIGINT          NOT NULL DEFAULT 0,
  city_fee_minor        BIGINT          NOT NULL DEFAULT 0,
  total_minor           BIGINT          NOT NULL,
  paid_minor            BIGINT          NOT NULL DEFAULT 0,
  lines_json            JSON            NOT NULL,
  issued_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_by             BIGINT UNSIGNED NULL,
  voided_at             TIMESTAMP       NULL,
  void_reason           VARCHAR(255)    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoices_number (property_id, number),
  KEY ix_invoices_reservation (reservation_id),
  CONSTRAINT fk_invoices_property    FOREIGN KEY (property_id)    REFERENCES properties (id),
  CONSTRAINT fk_invoices_reservation FOREIGN KEY (reservation_id) REFERENCES reservations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE expenses (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id   BIGINT UNSIGNED NOT NULL,
  category      VARCHAR(40)     NOT NULL,
  description   VARCHAR(255)    NOT NULL,
  amount_minor  BIGINT UNSIGNED NOT NULL,
  spent_on      DATE            NOT NULL,
  method        ENUM('cash','bank','card','other') NOT NULL DEFAULT 'cash',
  shift_id      BIGINT UNSIGNED NULL,
  created_by    BIGINT UNSIGNED NULL,
  voided_at     TIMESTAMP       NULL,
  void_reason   VARCHAR(255)    NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_expenses_property (property_id, spent_on),
  CONSTRAINT fk_expenses_property FOREIGN KEY (property_id) REFERENCES properties (id),
  CONSTRAINT fk_expenses_shift    FOREIGN KEY (shift_id)    REFERENCES cash_shifts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
