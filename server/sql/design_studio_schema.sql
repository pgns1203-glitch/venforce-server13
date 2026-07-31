CREATE TABLE IF NOT EXISTS design_client_profiles (
  cliente_id INTEGER PRIMARY KEY REFERENCES clientes(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL DEFAULT '',
  identity_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS design_templates (
  id BIGSERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'generated', 'duplicated')),
  document_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  preview_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at TIMESTAMP,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_templates_cliente
  ON design_templates (cliente_id, archived_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS design_artworks (
  id BIGSERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  template_id BIGINT REFERENCES design_templates(id) ON DELETE SET NULL,
  account_ref TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  document_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  preview_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at TIMESTAMP,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_artworks_cliente
  ON design_artworks (cliente_id, archived_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS design_template_versions (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES design_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  document_json JSONB NOT NULL,
  preview_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, version_number)
);

CREATE TABLE IF NOT EXISTS design_artwork_versions (
  id BIGSERIAL PRIMARY KEY,
  artwork_id BIGINT NOT NULL REFERENCES design_artworks(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  document_json JSONB NOT NULL,
  preview_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (artwork_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_design_template_versions_item
  ON design_template_versions (template_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_design_artwork_versions_item
  ON design_artwork_versions (artwork_id, version_number DESC);
