CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'hr', 'employee')),
  department_id TEXT,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  is_active SMALLINT NOT NULL DEFAULT 1,
  must_change_password SMALLINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS companies (
  id BIGSERIAL PRIMARY KEY,
  singleton_key TEXT UNIQUE,
  name TEXT NOT NULL,
  office_hours TEXT DEFAULT '09:00-17:00',
  grace_minutes INTEGER DEFAULT 15,
  weekend TEXT DEFAULT 'SAT-SUN',
  office_location TEXT DEFAULT '',
  office_radius_meters DOUBLE PRECISION DEFAULT 150,
  office_latitude DOUBLE PRECISION,
  office_longitude DOUBLE PRECISION,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS departments (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_folded TEXT,
  company_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  UNIQUE (company_id, name_folded)
);

CREATE TABLE IF NOT EXISTS employee_profiles (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  employee_code TEXT UNIQUE,
  employee_code_folded TEXT UNIQUE,
  designation TEXT,
  join_date TEXT,
  base_salary DOUBLE PRECISION DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS attendance (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  date TEXT NOT NULL,
  status TEXT DEFAULT 'present',
  late_minutes INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  approved_by TEXT,
  reviewer_comment TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  gross_salary DOUBLE PRECISION DEFAULT 0,
  tax DOUBLE PRECISION DEFAULT 0,
  net_salary DOUBLE PRECISION DEFAULT 0,
  status TEXT DEFAULT 'draft',
  finalized_by TEXT,
  finalized_at TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  UNIQUE (user_id, month)
);

CREATE TABLE IF NOT EXISTS ai_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  prompt TEXT,
  response TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS leave_types (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  name_folded TEXT NOT NULL UNIQUE,
  annual_quota INTEGER,
  paid SMALLINT DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS holidays (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  requested_check_in TEXT,
  requested_check_out TEXT,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  reviewer_comment TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE INDEX IF NOT EXISTS idx_users_role_active ON users (role, is_active);
CREATE INDEX IF NOT EXISTS idx_departments_company ON departments (company_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests (status, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_payroll_month_status ON payroll_runs (month, status);
CREATE INDEX IF NOT EXISTS idx_ai_logs_user_created ON ai_logs (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_corrections_status_date ON attendance_corrections (status, date);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
