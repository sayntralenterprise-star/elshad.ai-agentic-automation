-- 0001_extensions_and_roles.sql
-- PRD Appendix M.6 + DOC-Q-019 + DOC-Q-022

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_owner') THEN
    CREATE ROLE platform_owner NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_app') THEN
    CREATE ROLE platform_app LOGIN PASSWORD 'platform_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE platform_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_system') THEN
    CREATE ROLE platform_system LOGIN PASSWORD 'platform_system_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
END
$$;

-- Helper that enables + forces Row-Level Security on every tenant table (M.6, DOC-Q-022)
CREATE OR REPLACE FUNCTION enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (org_id = current_setting(''app.org_id'', true)::uuid) WITH CHECK (org_id = current_setting(''app.org_id'', true)::uuid)',
    tbl
  );
END;
$$;
