CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS channel;
CREATE SCHEMA IF NOT EXISTS product;
CREATE SCHEMA IF NOT EXISTS ordering;
CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS supplier;
CREATE SCHEMA IF NOT EXISTS ledger;
CREATE SCHEMA IF NOT EXISTS risk;
CREATE SCHEMA IF NOT EXISTS notification;
CREATE SCHEMA IF NOT EXISTS worker;

CREATE TABLE IF NOT EXISTS iam.admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  department_id TEXT,
  mobile TEXT,
  email TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iam.roles (
  id TEXT PRIMARY KEY,
  role_code TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iam.permissions (
  id TEXT PRIMARY KEY,
  permission_code TEXT NOT NULL UNIQUE,
  permission_name TEXT NOT NULL,
  permission_group TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iam.user_role_relations (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS iam.role_permission_relations (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS iam.user_data_scopes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  scope_type TEXT NOT NULL,
  scope_values_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iam.login_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iam.operation_audit_logs (
  id TEXT PRIMARY KEY,
  operator_user_id TEXT,
  operator_username TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channel.channels (
  id TEXT PRIMARY KEY,
  channel_code TEXT NOT NULL UNIQUE,
  channel_name TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  parent_channel_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  settlement_subject_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channel.channel_api_credentials (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  access_key TEXT NOT NULL UNIQUE,
  secret_key_encrypted TEXT NOT NULL,
  sign_algorithm TEXT NOT NULL DEFAULT 'HMAC_SHA256',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channel.channel_product_authorizations (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  product_id TEXT,
  sku_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channel.channel_price_policies (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  sale_price NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channel.channel_limit_rules (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL UNIQUE,
  single_limit NUMERIC(18, 2) NOT NULL DEFAULT 10000,
  daily_limit NUMERIC(18, 2) NOT NULL DEFAULT 100000,
  monthly_limit NUMERIC(18, 2) NOT NULL DEFAULT 1000000,
  qps_limit INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channel.channel_access_controls (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  control_type TEXT NOT NULL,
  target_value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channel.channel_callback_configs (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL UNIQUE,
  callback_url TEXT NOT NULL,
  sign_type TEXT NOT NULL DEFAULT 'HMAC_SHA256',
  secret_encrypted TEXT NOT NULL,
  retry_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  timeout_seconds INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product.product_categories (
  id TEXT PRIMARY KEY,
  category_name TEXT NOT NULL,
  parent_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  sort_no INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product.products (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_type TEXT NOT NULL,
  delivery_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  base_attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product.product_skus (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  sku_name TEXT NOT NULL,
  face_value NUMERIC(18, 2) NOT NULL,
  operator TEXT,
  region TEXT,
  sale_status TEXT NOT NULL DEFAULT 'ON_SHELF',
  base_cost_price NUMERIC(18, 2) NOT NULL DEFAULT 0,
  base_sale_price NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ext_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product.sku_supplier_mappings (
  id TEXT PRIMARY KEY,
  sku_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  supplier_sku_code TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  weight INTEGER NOT NULL DEFAULT 100,
  route_type TEXT NOT NULL DEFAULT 'PRIMARY',
  cost_price NUMERIC(18, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product.product_change_logs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  operator_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk.risk_rules (
  id TEXT PRIMARY KEY,
  rule_code TEXT NOT NULL UNIQUE,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk.risk_black_white_list (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL,
  target_value TEXT NOT NULL,
  list_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entry_type, target_value, list_type)
);

CREATE TABLE IF NOT EXISTS risk.risk_signals (
  id TEXT PRIMARY KEY,
  order_no TEXT,
  channel_id TEXT,
  signal_type TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk.risk_decisions (
  id TEXT PRIMARY KEY,
  order_no TEXT,
  channel_id TEXT,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  hit_rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk.risk_review_cases (
  id TEXT PRIMARY KEY,
  order_no TEXT,
  channel_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  reason TEXT NOT NULL,
  reviewer_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ordering.orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  channel_order_no TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  parent_channel_id TEXT,
  product_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  sale_price NUMERIC(18, 2) NOT NULL,
  cost_price NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  payment_mode TEXT NOT NULL,
  payment_no TEXT,
  main_status TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  supplier_status TEXT NOT NULL,
  notify_status TEXT NOT NULL,
  risk_status TEXT NOT NULL,
  channel_snapshot_json JSONB NOT NULL,
  product_snapshot_json JSONB NOT NULL,
  callback_snapshot_json JSONB NOT NULL,
  supplier_route_snapshot_json JSONB NOT NULL,
  risk_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ext_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  exception_tag TEXT,
  remark TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE (channel_id, channel_order_no)
);

CREATE TABLE IF NOT EXISTS ordering.order_events (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_service TEXT NOT NULL,
  source_no TEXT,
  before_status_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_status_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,
  operator TEXT NOT NULL,
  request_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ordering.order_remarks (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL,
  remark TEXT NOT NULL,
  operator_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment.payment_channels (
  id TEXT PRIMARY KEY,
  channel_code TEXT NOT NULL UNIQUE,
  channel_name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment.payment_orders (
  id TEXT PRIMARY KEY,
  payment_no TEXT NOT NULL UNIQUE,
  order_no TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  payment_channel_code TEXT NOT NULL,
  pay_amount NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL,
  payment_mode TEXT NOT NULL,
  third_trade_no TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payment.payment_callback_logs (
  id TEXT PRIMARY KEY,
  payment_no TEXT,
  provider TEXT NOT NULL,
  headers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  body_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment.payment_refunds (
  id TEXT PRIMARY KEY,
  refund_no TEXT NOT NULL UNIQUE,
  payment_no TEXT NOT NULL,
  order_no TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  status TEXT NOT NULL,
  provider_refund_no TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier.suppliers (
  id TEXT PRIMARY KEY,
  supplier_code TEXT NOT NULL UNIQUE,
  supplier_name TEXT NOT NULL,
  protocol_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier.supplier_configs (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL UNIQUE,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  credential_encrypted TEXT NOT NULL,
  callback_secret_encrypted TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 3000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier.supplier_orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  supplier_order_no TEXT NOT NULL UNIQUE,
  request_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  standard_status TEXT NOT NULL,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier.supplier_callback_logs (
  id TEXT PRIMARY KEY,
  supplier_id TEXT,
  supplier_code TEXT NOT NULL,
  supplier_order_no TEXT,
  headers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  body_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  parsed_status TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier.supplier_health_stats (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  stat_date DATE NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  timeout_count INTEGER NOT NULL DEFAULT 0,
  avg_duration_ms INTEGER NOT NULL DEFAULT 0,
  avg_callback_delay_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supplier_id, stat_date)
);

CREATE TABLE IF NOT EXISTS ledger.accounts (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  available_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  frozen_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_type, owner_id, currency)
);

CREATE TABLE IF NOT EXISTS ledger.account_ledgers (
  id TEXT PRIMARY KEY,
  ledger_no TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  order_no TEXT,
  action_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  balance_before NUMERIC(18, 2) NOT NULL,
  balance_after NUMERIC(18, 2) NOT NULL,
  reference_type TEXT NOT NULL,
  reference_no TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger.profit_rules (
  id TEXT PRIMARY KEY,
  rule_name TEXT NOT NULL,
  channel_id TEXT,
  product_id TEXT,
  sku_id TEXT,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger.settlement_statements (
  id TEXT PRIMARY KEY,
  settlement_no TEXT NOT NULL UNIQUE,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  total_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger.reconciliation_records (
  id TEXT PRIMARY KEY,
  reconcile_no TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  reference_no TEXT NOT NULL,
  diff_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification.notification_tasks (
  id TEXT PRIMARY KEY,
  task_no TEXT NOT NULL UNIQUE,
  order_no TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  notify_type TEXT NOT NULL,
  destination TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature TEXT,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification.notification_templates (
  id TEXT PRIMARY KEY,
  template_code TEXT NOT NULL UNIQUE,
  notify_type TEXT NOT NULL,
  subject TEXT,
  body_template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification.notification_delivery_logs (
  id TEXT PRIMARY KEY,
  task_no TEXT NOT NULL,
  request_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_status TEXT,
  response_body TEXT,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification.notification_dead_letters (
  id TEXT PRIMARY KEY,
  task_no TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS worker.worker_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  business_key TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_type, business_key)
);

CREATE TABLE IF NOT EXISTS worker.worker_job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS worker.worker_dead_letters (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  business_key TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ordering_orders_channel_created
  ON ordering.orders (channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ordering_order_events_order_no
  ON ordering.order_events (order_no, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_orders_order_no
  ON payment.payment_orders (order_no);

CREATE INDEX IF NOT EXISTS idx_supplier_orders_order_no
  ON supplier.supplier_orders (order_no);

CREATE INDEX IF NOT EXISTS idx_ledger_ledgers_order_no
  ON ledger.account_ledgers (order_no);

CREATE INDEX IF NOT EXISTS idx_notification_tasks_order_no
  ON notification.notification_tasks (order_no);

CREATE INDEX IF NOT EXISTS idx_worker_jobs_status_next_run
  ON worker.worker_jobs (status, next_run_at);
