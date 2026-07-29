-- Observabilidade técnica do Control Center.
-- Idempotente: roda a cada boot via ensureObservabilityTables().
-- NÃO substitui activity_logs (auditoria de negócio da tela Atividade).

CREATE TABLE IF NOT EXISTS observability_requests (
  id            BIGSERIAL PRIMARY KEY,
  request_id    TEXT NOT NULL,
  method        TEXT NOT NULL,
  route         TEXT,
  path          TEXT NOT NULL,
  status_code   INTEGER,
  duration_ms   INTEGER,
  source        TEXT NOT NULL DEFAULT 'server',
  user_id       INTEGER,
  user_email    TEXT,
  user_nome     TEXT,
  content_type  TEXT,
  response_size INTEGER,
  user_agent    TEXT,
  error_name    TEXT,
  error_message TEXT,
  error_stack   TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_obs_requests_created_at
  ON observability_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_requests_request_id
  ON observability_requests (request_id);
CREATE INDEX IF NOT EXISTS idx_obs_requests_status
  ON observability_requests (status_code);
CREATE INDEX IF NOT EXISTS idx_obs_requests_duration
  ON observability_requests (duration_ms DESC);
CREATE INDEX IF NOT EXISTS idx_obs_requests_route
  ON observability_requests (route);
CREATE INDEX IF NOT EXISTS idx_obs_requests_status_created
  ON observability_requests (status_code, created_at DESC);

CREATE TABLE IF NOT EXISTS observability_client_events (
  id           BIGSERIAL PRIMARY KEY,
  event_id     TEXT NOT NULL UNIQUE,
  request_id   TEXT,
  session_id   TEXT,
  tab_id       TEXT,
  page_load_id TEXT,
  page         TEXT,
  event_type   TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'info',
  message      TEXT,
  stack        TEXT,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Colunas promovidas do JSONB: a visão Requests filtra e ordena por elas, e
-- índice em expressão sobre JSONB sairia mais caro que coluna dedicada.
ALTER TABLE observability_client_events ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE observability_client_events ADD COLUMN IF NOT EXISTS endpoint TEXT;
ALTER TABLE observability_client_events ADD COLUMN IF NOT EXISTS status_code INTEGER;
ALTER TABLE observability_client_events ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE observability_client_events ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE observability_client_events ADD COLUMN IF NOT EXISTS user_email TEXT;

CREATE INDEX IF NOT EXISTS idx_obs_client_events_created_at
  ON observability_client_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_client_events_request_id
  ON observability_client_events (request_id);
CREATE INDEX IF NOT EXISTS idx_obs_client_events_session
  ON observability_client_events (session_id);
CREATE INDEX IF NOT EXISTS idx_obs_client_events_type
  ON observability_client_events (event_type);
CREATE INDEX IF NOT EXISTS idx_obs_client_events_severity
  ON observability_client_events (severity, created_at DESC);
