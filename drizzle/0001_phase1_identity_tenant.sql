-- ═════════════════════════════════════════════════════════════════════
-- structr.ai — PHASE 1 MIGRATION
-- Identity, Authorization, Tenancy, Referential Integrity
-- ═════════════════════════════════════════════════════════════════════
--
-- Idempotent by design: safe to run repeatedly and safe to run against a
-- database that is already partially migrated. Every constraint is created
-- inside a guard block, so a single unexpected data condition emits a NOTICE
-- instead of aborting the whole deploy.
--
-- Order of operations:
--   1. tenants                (new root table + default tenant)
--   2. project_members        (new authorization table)
--   3. new columns            (tenant_id, profiles identity, project owner)
--   4. backfill               (attach existing rows to the default tenant)
--   5. foreign keys           (business relations)
--   6. indexes                (relationship + status lookups)
--   7. unique constraints     (identity + catalog integrity)
--
-- Requires: pgcrypto (or pg 13+ built-in gen_random_uuid).
-- ═════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ─────────────────────────────────────────────────────────────────────
-- 1. TENANTS (new root entity for multi-tenant isolation)
-- ─────────────────────────────────────────────────────────────────────

-- Column list mirrors `tenants` in drizzle/schema.ts exactly.
CREATE TABLE IF NOT EXISTS tenants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  slug             text NOT NULL,
  legal_name       text,
  region           text NOT NULL DEFAULT 'charleston_sc',
  timezone         text NOT NULL DEFAULT 'America/New_York',
  default_channel  text DEFAULT 'direct',
  settings         jsonb DEFAULT '{}'::jsonb,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Default tenant so existing rows can be backfilled deterministically.
-- Slug must match DEFAULT_TENANT_SLUG in shared/const.ts.
INSERT INTO tenants (name, slug, legal_name, region)
SELECT 'GC Home Improvement LLC', 'gchi', 'GC Home Improvement LLC', 'charleston_sc'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE slug = 'gchi');

-- ─────────────────────────────────────────────────────────────────────
-- 2. PROJECT MEMBERS (explicit per-project authorization)
-- ─────────────────────────────────────────────────────────────────────

-- Column list mirrors `project_members` in drizzle/schema.ts exactly.
-- project_role ∈ owner | manager | estimator | field | viewer
-- permissions is an optional explicit grant list: ["read","write","approve","delete"]
CREATE TABLE IF NOT EXISTS project_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid,
  project_id    uuid NOT NULL,
  user_id       uuid NOT NULL,
  project_role  text NOT NULL DEFAULT 'viewer',
  permissions   jsonb DEFAULT '[]'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────────
-- 2b. DRAWING / SCOPE-SOURCE TABLES
-- ──────────────────────────────────────────────────────────────────
--
-- These four tables exist in drizzle/schema.ts (Drawing Intelligence sprints)
-- but were never emitted into a SQL migration, so a fresh database could not
-- serve the drawing/RFI routers at all. Creating them here is what makes the
-- Phase 1 foreign keys on drawing_id / scope_source_id enforceable.

CREATE TABLE IF NOT EXISTS project_drawings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid,
  project_id          uuid NOT NULL,
  file_name           text NOT NULL,
  file_type           text NOT NULL,
  storage_path        text NOT NULL,
  file_size_bytes     integer,
  revision_label      text NOT NULL DEFAULT 'A',
  sheet_label         text,
  sheet_type          text,
  notes               text,
  is_active_revision  boolean NOT NULL DEFAULT true,
  uploaded_by         uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drawing_revision_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid,
  project_id      uuid NOT NULL,
  revision_label  text NOT NULL,
  drawing_ids     jsonb NOT NULL,
  snapshot_data   jsonb,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scope_sources (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid,
  project_id                uuid NOT NULL,
  source_type               text NOT NULL DEFAULT 'manual',
  drawing_revision_id       uuid,
  intake_form_id            uuid,
  payload_json              jsonb NOT NULL,
  confidence_summary_json   jsonb,
  assembly_candidates       jsonb,
  assumptions               jsonb,
  review_status             text NOT NULL DEFAULT 'pending',
  is_active                 boolean NOT NULL DEFAULT true,
  scope_draft_id            uuid,
  created_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rfi_candidates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid,
  project_id        uuid NOT NULL,
  scope_source_id   uuid,
  drawing_id        uuid,
  category          text NOT NULL,
  question          text NOT NULL,
  context           text,
  suggested_answer  text,
  resolution        text,
  resolved_by       uuid,
  resolved_at       timestamptz,
  status            text NOT NULL DEFAULT 'open',
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);


-- ─────────────────────────────────────────────────────────────────────
-- 3. NEW COLUMNS
-- ─────────────────────────────────────────────────────────────────────

-- profiles
ALTER TABLE IF EXISTS profiles ADD COLUMN IF NOT EXISTS external_open_id text;
ALTER TABLE IF EXISTS profiles ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE IF EXISTS profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE IF EXISTS profiles ADD COLUMN IF NOT EXISTS login_method text;
ALTER TABLE IF EXISTS profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE IF EXISTS profiles ADD COLUMN IF NOT EXISTS last_signed_in timestamptz;

-- projects
ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS client_id uuid;

-- clients
ALTER TABLE IF EXISTS clients ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- leads
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- deals
ALTER TABLE IF EXISTS deals ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- estimates
ALTER TABLE IF EXISTS estimates ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- estimate_drafts
ALTER TABLE IF EXISTS estimate_drafts ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- estimate_items
ALTER TABLE IF EXISTS estimate_items ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- intake_forms
ALTER TABLE IF EXISTS intake_forms ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- scope_drafts
ALTER TABLE IF EXISTS scope_drafts ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- scope_sources
ALTER TABLE IF EXISTS scope_sources ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- rfi_candidates
ALTER TABLE IF EXISTS rfi_candidates ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- project_drawings
ALTER TABLE IF EXISTS project_drawings ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- drawing_revision_snapshots
ALTER TABLE IF EXISTS drawing_revision_snapshots ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- project_files
ALTER TABLE IF EXISTS project_files ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- project_actuals
ALTER TABLE IF EXISTS project_actuals ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- cost_codes
ALTER TABLE IF EXISTS cost_codes ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- assemblies
ALTER TABLE IF EXISTS assemblies ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- bundles
ALTER TABLE IF EXISTS bundles ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- geographic_overrides
ALTER TABLE IF EXISTS geographic_overrides ADD COLUMN IF NOT EXISTS tenant_id uuid;


-- ─────────────────────────────────────────────────────────────────────
-- 4. BACKFILL — attach pre-existing rows to the default tenant
-- ─────────────────────────────────────────────────────────────────────
--
-- Single-tenant deployments (the current GCHI production state) keep working
-- unchanged: every existing row lands in the 'gchi' tenant.

DO $$
DECLARE
  default_tenant uuid;
  t text;
BEGIN
  SELECT id INTO default_tenant FROM tenants WHERE slug = 'gchi' LIMIT 1;
  IF default_tenant IS NULL THEN
    RAISE NOTICE 'no default tenant; skipping backfill';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['profiles', 'projects', 'clients', 'leads', 'deals', 'estimates', 'estimate_drafts', 'estimate_items', 'intake_forms', 'scope_drafts', 'scope_sources', 'rfi_candidates', 'project_drawings', 'drawing_revision_snapshots', 'project_files', 'project_actuals', 'cost_codes', 'assemblies', 'bundles', 'geographic_overrides']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'tenant_id' AND table_schema = current_schema()
    ) THEN
      EXECUTE format('UPDATE %I SET tenant_id = $1 WHERE tenant_id IS NULL', t)
      USING default_tenant;
    END IF;
  END LOOP;
END $$;

-- Project ownership backfill: prefer assigned_to, then created_by-like columns.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'assigned_to' AND table_schema = current_schema()
  ) THEN
    UPDATE projects SET owner_user_id = assigned_to
    WHERE owner_user_id IS NULL AND assigned_to IS NOT NULL;
  END IF;
END $$;

-- Identity backfill: legacy profiles keyed by id keep working by copying the
-- previous identifier into external_open_id when it is still unset.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'external_open_id' AND table_schema = current_schema()
  ) THEN
    UPDATE profiles
    SET external_open_id = id::text
    WHERE external_open_id IS NULL;
  END IF;
END $$;

-- Every existing profile becomes an owner-level member of the projects it owns,
-- so the new guard does not lock operators out of their own data.
DO $$
DECLARE
  default_tenant uuid;
BEGIN
  SELECT id INTO default_tenant FROM tenants WHERE slug = 'gchi' LIMIT 1;

  INSERT INTO project_members (tenant_id, project_id, user_id, project_role, is_active)
  SELECT COALESCE(p.tenant_id, default_tenant), p.id, p.owner_user_id, 'owner', true
  FROM projects p
  WHERE p.owner_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.project_id = p.id AND m.user_id = p.owner_user_id
    );
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. FOREIGN KEYS
-- ─────────────────────────────────────────────────────────────────────

-- assemblies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'assemblies' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip assemblies_tenant_id_fk: table assemblies missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assemblies' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip assemblies_tenant_id_fk: column assemblies.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assemblies_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip assemblies_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'assemblies', 'tenant_id', 'tenant_id', 'tenants', 'id', 'assemblies', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE assemblies ADD CONSTRAINT assemblies_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip assemblies_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- assembly_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'assembly_items' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip assembly_items_assembly_id_fk: table assembly_items missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assembly_items' AND column_name = 'assembly_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip assembly_items_assembly_id_fk: column assembly_items.assembly_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assembly_items_assembly_id_fk'
  ) THEN
    RAISE NOTICE 'skip assembly_items_assembly_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'assembly_items', 'assembly_id', 'assembly_id', 'assemblies', 'id', 'assembly_items', 'assembly_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE assembly_items ADD CONSTRAINT assembly_items_assembly_id_fk FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip assembly_items_assembly_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'assembly_items' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip assembly_items_cost_code_id_fk: table assembly_items missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assembly_items' AND column_name = 'cost_code_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip assembly_items_cost_code_id_fk: column assembly_items.cost_code_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assembly_items_cost_code_id_fk'
  ) THEN
    RAISE NOTICE 'skip assembly_items_cost_code_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'assembly_items', 'cost_code_id', 'cost_code_id', 'cost_codes', 'id', 'assembly_items', 'cost_code_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE assembly_items ADD CONSTRAINT assembly_items_cost_code_id_fk FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip assembly_items_cost_code_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- assembly_performance_metrics
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'assembly_performance_metrics' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip assembly_performance_metrics_assembly_id_fk: table assembly_performance_metrics missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assembly_performance_metrics' AND column_name = 'assembly_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip assembly_performance_metrics_assembly_id_fk: column assembly_performance_metrics.assembly_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assembly_performance_metrics_assembly_id_fk'
  ) THEN
    RAISE NOTICE 'skip assembly_performance_metrics_assembly_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'assembly_performance_metrics', 'assembly_id', 'assembly_id', 'assemblies', 'id', 'assembly_performance_metrics', 'assembly_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE assembly_performance_metrics ADD CONSTRAINT assembly_performance_metrics_assembly_id_fk FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip assembly_performance_metrics_assembly_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- boq_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'boq_items' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip boq_items_lead_id_fk: table boq_items missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boq_items' AND column_name = 'lead_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip boq_items_lead_id_fk: column boq_items.lead_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boq_items_lead_id_fk'
  ) THEN
    RAISE NOTICE 'skip boq_items_lead_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'boq_items', 'lead_id', 'lead_id', 'leads', 'id', 'boq_items', 'lead_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE boq_items ADD CONSTRAINT boq_items_lead_id_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip boq_items_lead_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- bundle_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'bundle_items' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip bundle_items_bundle_id_fk: table bundle_items missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bundle_items' AND column_name = 'bundle_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip bundle_items_bundle_id_fk: column bundle_items.bundle_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bundle_items_bundle_id_fk'
  ) THEN
    RAISE NOTICE 'skip bundle_items_bundle_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'bundle_items', 'bundle_id', 'bundle_id', 'bundles', 'id', 'bundle_items', 'bundle_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE bundle_items ADD CONSTRAINT bundle_items_bundle_id_fk FOREIGN KEY (bundle_id) REFERENCES bundles(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip bundle_items_bundle_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'bundle_items' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip bundle_items_assembly_id_fk: table bundle_items missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bundle_items' AND column_name = 'assembly_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip bundle_items_assembly_id_fk: column bundle_items.assembly_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bundle_items_assembly_id_fk'
  ) THEN
    RAISE NOTICE 'skip bundle_items_assembly_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'bundle_items', 'assembly_id', 'assembly_id', 'assemblies', 'id', 'bundle_items', 'assembly_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE bundle_items ADD CONSTRAINT bundle_items_assembly_id_fk FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip bundle_items_assembly_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- bundles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'bundles' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip bundles_tenant_id_fk: table bundles missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bundles' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip bundles_tenant_id_fk: column bundles.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bundles_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip bundles_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'bundles', 'tenant_id', 'tenant_id', 'tenants', 'id', 'bundles', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE bundles ADD CONSTRAINT bundles_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip bundles_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- calibration_suggestions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'calibration_suggestions' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip calibration_suggestions_cost_code_id_fk: table calibration_suggestions missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calibration_suggestions' AND column_name = 'cost_code_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip calibration_suggestions_cost_code_id_fk: column calibration_suggestions.cost_code_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calibration_suggestions_cost_code_id_fk'
  ) THEN
    RAISE NOTICE 'skip calibration_suggestions_cost_code_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'calibration_suggestions', 'cost_code_id', 'cost_code_id', 'cost_codes', 'id', 'calibration_suggestions', 'cost_code_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE calibration_suggestions ADD CONSTRAINT calibration_suggestions_cost_code_id_fk FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip calibration_suggestions_cost_code_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- clients
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'clients' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip clients_tenant_id_fk: table clients missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip clients_tenant_id_fk: column clients.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip clients_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'clients', 'tenant_id', 'tenant_id', 'tenants', 'id', 'clients', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE clients ADD CONSTRAINT clients_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip clients_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- cost_code_pricing_history
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cost_code_pricing_history' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip cost_code_pricing_history_cost_code_id_fk: table cost_code_pricing_history missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cost_code_pricing_history' AND column_name = 'cost_code_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip cost_code_pricing_history_cost_code_id_fk: column cost_code_pricing_history.cost_code_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cost_code_pricing_history_cost_code_id_fk'
  ) THEN
    RAISE NOTICE 'skip cost_code_pricing_history_cost_code_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'cost_code_pricing_history', 'cost_code_id', 'cost_code_id', 'cost_codes', 'id', 'cost_code_pricing_history', 'cost_code_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE cost_code_pricing_history ADD CONSTRAINT cost_code_pricing_history_cost_code_id_fk FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip cost_code_pricing_history_cost_code_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- cost_codes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cost_codes' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip cost_codes_tenant_id_fk: table cost_codes missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cost_codes' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip cost_codes_tenant_id_fk: column cost_codes.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cost_codes_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip cost_codes_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'cost_codes', 'tenant_id', 'tenant_id', 'tenants', 'id', 'cost_codes', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE cost_codes ADD CONSTRAINT cost_codes_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip cost_codes_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- deal_activities
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'deal_activities' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip deal_activities_deal_id_fk: table deal_activities missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deal_activities' AND column_name = 'deal_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip deal_activities_deal_id_fk: column deal_activities.deal_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deal_activities_deal_id_fk'
  ) THEN
    RAISE NOTICE 'skip deal_activities_deal_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'deal_activities', 'deal_id', 'deal_id', 'deals', 'id', 'deal_activities', 'deal_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE deal_activities ADD CONSTRAINT deal_activities_deal_id_fk FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip deal_activities_deal_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- deal_stage_history
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'deal_stage_history' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip deal_stage_history_deal_id_fk: table deal_stage_history missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deal_stage_history' AND column_name = 'deal_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip deal_stage_history_deal_id_fk: column deal_stage_history.deal_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deal_stage_history_deal_id_fk'
  ) THEN
    RAISE NOTICE 'skip deal_stage_history_deal_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'deal_stage_history', 'deal_id', 'deal_id', 'deals', 'id', 'deal_stage_history', 'deal_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE deal_stage_history ADD CONSTRAINT deal_stage_history_deal_id_fk FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip deal_stage_history_deal_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- deals
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'deals' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip deals_tenant_id_fk: table deals missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deals' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip deals_tenant_id_fk: column deals.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deals_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip deals_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'deals', 'tenant_id', 'tenant_id', 'tenants', 'id', 'deals', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE deals ADD CONSTRAINT deals_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip deals_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'deals' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip deals_lead_id_fk: table deals missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deals' AND column_name = 'lead_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip deals_lead_id_fk: column deals.lead_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deals_lead_id_fk'
  ) THEN
    RAISE NOTICE 'skip deals_lead_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'deals', 'lead_id', 'lead_id', 'leads', 'id', 'deals', 'lead_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE deals ADD CONSTRAINT deals_lead_id_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip deals_lead_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- drawing_revision_snapshots
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'drawing_revision_snapshots' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip drawing_revision_snapshots_tenant_id_fk: table drawing_revision_snapshots missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'drawing_revision_snapshots' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip drawing_revision_snapshots_tenant_id_fk: column drawing_revision_snapshots.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drawing_revision_snapshots_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip drawing_revision_snapshots_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'drawing_revision_snapshots', 'tenant_id', 'tenant_id', 'tenants', 'id', 'drawing_revision_snapshots', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE drawing_revision_snapshots ADD CONSTRAINT drawing_revision_snapshots_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip drawing_revision_snapshots_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'drawing_revision_snapshots' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip drawing_revision_snapshots_project_id_fk: table drawing_revision_snapshots missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'drawing_revision_snapshots' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip drawing_revision_snapshots_project_id_fk: column drawing_revision_snapshots.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drawing_revision_snapshots_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip drawing_revision_snapshots_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'drawing_revision_snapshots', 'project_id', 'project_id', 'projects', 'id', 'drawing_revision_snapshots', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE drawing_revision_snapshots ADD CONSTRAINT drawing_revision_snapshots_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip drawing_revision_snapshots_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- estimate_drafts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_drafts' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_drafts_tenant_id_fk: table estimate_drafts missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_drafts' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_drafts_tenant_id_fk: column estimate_drafts.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimate_drafts_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip estimate_drafts_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'estimate_drafts', 'tenant_id', 'tenant_id', 'tenants', 'id', 'estimate_drafts', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE estimate_drafts ADD CONSTRAINT estimate_drafts_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip estimate_drafts_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_drafts' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_drafts_estimate_id_fk: table estimate_drafts missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_drafts' AND column_name = 'estimate_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_drafts_estimate_id_fk: column estimate_drafts.estimate_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimate_drafts_estimate_id_fk'
  ) THEN
    RAISE NOTICE 'skip estimate_drafts_estimate_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'estimate_drafts', 'estimate_id', 'estimate_id', 'estimates', 'id', 'estimate_drafts', 'estimate_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE estimate_drafts ADD CONSTRAINT estimate_drafts_estimate_id_fk FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip estimate_drafts_estimate_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_drafts' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_drafts_project_id_fk: table estimate_drafts missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_drafts' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_drafts_project_id_fk: column estimate_drafts.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimate_drafts_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip estimate_drafts_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'estimate_drafts', 'project_id', 'project_id', 'projects', 'id', 'estimate_drafts', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE estimate_drafts ADD CONSTRAINT estimate_drafts_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip estimate_drafts_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- estimate_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_items' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_items_tenant_id_fk: table estimate_items missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_items' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_items_tenant_id_fk: column estimate_items.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimate_items_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip estimate_items_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'estimate_items', 'tenant_id', 'tenant_id', 'tenants', 'id', 'estimate_items', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE estimate_items ADD CONSTRAINT estimate_items_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip estimate_items_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_items' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_items_project_id_fk: table estimate_items missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_items' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_items_project_id_fk: column estimate_items.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimate_items_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip estimate_items_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'estimate_items', 'project_id', 'project_id', 'projects', 'id', 'estimate_items', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE estimate_items ADD CONSTRAINT estimate_items_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip estimate_items_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_items' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_items_cost_code_id_fk: table estimate_items missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_items' AND column_name = 'cost_code_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_items_cost_code_id_fk: column estimate_items.cost_code_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimate_items_cost_code_id_fk'
  ) THEN
    RAISE NOTICE 'skip estimate_items_cost_code_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'estimate_items', 'cost_code_id', 'cost_code_id', 'cost_codes', 'id', 'estimate_items', 'cost_code_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE estimate_items ADD CONSTRAINT estimate_items_cost_code_id_fk FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip estimate_items_cost_code_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_items' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_items_assembly_id_fk: table estimate_items missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_items' AND column_name = 'assembly_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_items_assembly_id_fk: column estimate_items.assembly_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimate_items_assembly_id_fk'
  ) THEN
    RAISE NOTICE 'skip estimate_items_assembly_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'estimate_items', 'assembly_id', 'assembly_id', 'assemblies', 'id', 'estimate_items', 'assembly_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE estimate_items ADD CONSTRAINT estimate_items_assembly_id_fk FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip estimate_items_assembly_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- estimate_variance_events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_variance_events' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_variance_events_project_id_fk: table estimate_variance_events missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_variance_events' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_variance_events_project_id_fk: column estimate_variance_events.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimate_variance_events_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip estimate_variance_events_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'estimate_variance_events', 'project_id', 'project_id', 'projects', 'id', 'estimate_variance_events', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE estimate_variance_events ADD CONSTRAINT estimate_variance_events_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip estimate_variance_events_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_variance_events' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_variance_events_estimate_item_id_fk: table estimate_variance_events missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_variance_events' AND column_name = 'estimate_item_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_variance_events_estimate_item_id_fk: column estimate_variance_events.estimate_item_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimate_variance_events_estimate_item_id_fk'
  ) THEN
    RAISE NOTICE 'skip estimate_variance_events_estimate_item_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'estimate_variance_events', 'estimate_item_id', 'estimate_item_id', 'estimate_items', 'id', 'estimate_variance_events', 'estimate_item_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE estimate_variance_events ADD CONSTRAINT estimate_variance_events_estimate_item_id_fk FOREIGN KEY (estimate_item_id) REFERENCES estimate_items(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip estimate_variance_events_estimate_item_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_variance_events' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_variance_events_cost_code_id_fk: table estimate_variance_events missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_variance_events' AND column_name = 'cost_code_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimate_variance_events_cost_code_id_fk: column estimate_variance_events.cost_code_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimate_variance_events_cost_code_id_fk'
  ) THEN
    RAISE NOTICE 'skip estimate_variance_events_cost_code_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'estimate_variance_events', 'cost_code_id', 'cost_code_id', 'cost_codes', 'id', 'estimate_variance_events', 'cost_code_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE estimate_variance_events ADD CONSTRAINT estimate_variance_events_cost_code_id_fk FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip estimate_variance_events_cost_code_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- estimates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimates' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimates_tenant_id_fk: table estimates missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimates' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimates_tenant_id_fk: column estimates.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimates_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip estimates_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'estimates', 'tenant_id', 'tenant_id', 'tenants', 'id', 'estimates', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE estimates ADD CONSTRAINT estimates_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip estimates_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimates' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimates_project_id_fk: table estimates missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimates' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip estimates_project_id_fk: column estimates.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimates_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip estimates_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'estimates', 'project_id', 'project_id', 'projects', 'id', 'estimates', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE estimates ADD CONSTRAINT estimates_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip estimates_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- field_feedback_reports
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'field_feedback_reports' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip field_feedback_reports_project_id_fk: table field_feedback_reports missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'field_feedback_reports' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip field_feedback_reports_project_id_fk: column field_feedback_reports.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'field_feedback_reports_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip field_feedback_reports_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'field_feedback_reports', 'project_id', 'project_id', 'projects', 'id', 'field_feedback_reports', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE field_feedback_reports ADD CONSTRAINT field_feedback_reports_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip field_feedback_reports_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- geographic_overrides
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'geographic_overrides' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_tenant_id_fk: table geographic_overrides missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'geographic_overrides' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_tenant_id_fk: column geographic_overrides.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'geographic_overrides_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'geographic_overrides', 'tenant_id', 'tenant_id', 'tenants', 'id', 'geographic_overrides', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE geographic_overrides ADD CONSTRAINT geographic_overrides_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip geographic_overrides_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'geographic_overrides' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_zone_id_fk: table geographic_overrides missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'geographic_overrides' AND column_name = 'zone_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_zone_id_fk: column geographic_overrides.zone_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'geographic_overrides_zone_id_fk'
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_zone_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'geographic_overrides', 'zone_id', 'zone_id', 'geo_zones', 'id', 'geographic_overrides', 'zone_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE geographic_overrides ADD CONSTRAINT geographic_overrides_zone_id_fk FOREIGN KEY (zone_id) REFERENCES geo_zones(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip geographic_overrides_zone_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'geographic_overrides' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_assembly_id_fk: table geographic_overrides missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'geographic_overrides' AND column_name = 'assembly_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_assembly_id_fk: column geographic_overrides.assembly_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'geographic_overrides_assembly_id_fk'
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_assembly_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'geographic_overrides', 'assembly_id', 'assembly_id', 'assemblies', 'id', 'geographic_overrides', 'assembly_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE geographic_overrides ADD CONSTRAINT geographic_overrides_assembly_id_fk FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip geographic_overrides_assembly_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'geographic_overrides' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_cost_code_id_fk: table geographic_overrides missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'geographic_overrides' AND column_name = 'cost_code_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_cost_code_id_fk: column geographic_overrides.cost_code_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'geographic_overrides_cost_code_id_fk'
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_cost_code_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'geographic_overrides', 'cost_code_id', 'cost_code_id', 'cost_codes', 'id', 'geographic_overrides', 'cost_code_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE geographic_overrides ADD CONSTRAINT geographic_overrides_cost_code_id_fk FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip geographic_overrides_cost_code_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'geographic_overrides' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_original_assembly_id_fk: table geographic_overrides missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'geographic_overrides' AND column_name = 'original_assembly_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_original_assembly_id_fk: column geographic_overrides.original_assembly_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'geographic_overrides_original_assembly_id_fk'
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_original_assembly_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'geographic_overrides', 'original_assembly_id', 'original_assembly_id', 'assemblies', 'id', 'geographic_overrides', 'original_assembly_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE geographic_overrides ADD CONSTRAINT geographic_overrides_original_assembly_id_fk FOREIGN KEY (original_assembly_id) REFERENCES assemblies(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip geographic_overrides_original_assembly_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'geographic_overrides' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_replacement_assembly_id_fk: table geographic_overrides missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'geographic_overrides' AND column_name = 'replacement_assembly_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_replacement_assembly_id_fk: column geographic_overrides.replacement_assembly_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'geographic_overrides_replacement_assembly_id_fk'
  ) THEN
    RAISE NOTICE 'skip geographic_overrides_replacement_assembly_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'geographic_overrides', 'replacement_assembly_id', 'replacement_assembly_id', 'assemblies', 'id', 'geographic_overrides', 'replacement_assembly_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE geographic_overrides ADD CONSTRAINT geographic_overrides_replacement_assembly_id_fk FOREIGN KEY (replacement_assembly_id) REFERENCES assemblies(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip geographic_overrides_replacement_assembly_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- intake_forms
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'intake_forms' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip intake_forms_tenant_id_fk: table intake_forms missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'intake_forms' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip intake_forms_tenant_id_fk: column intake_forms.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'intake_forms_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip intake_forms_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'intake_forms', 'tenant_id', 'tenant_id', 'tenants', 'id', 'intake_forms', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE intake_forms ADD CONSTRAINT intake_forms_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip intake_forms_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'intake_forms' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip intake_forms_lead_id_fk: table intake_forms missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'intake_forms' AND column_name = 'lead_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip intake_forms_lead_id_fk: column intake_forms.lead_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'intake_forms_lead_id_fk'
  ) THEN
    RAISE NOTICE 'skip intake_forms_lead_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'intake_forms', 'lead_id', 'lead_id', 'leads', 'id', 'intake_forms', 'lead_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE intake_forms ADD CONSTRAINT intake_forms_lead_id_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip intake_forms_lead_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'intake_forms' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip intake_forms_project_id_fk: table intake_forms missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'intake_forms' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip intake_forms_project_id_fk: column intake_forms.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'intake_forms_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip intake_forms_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'intake_forms', 'project_id', 'project_id', 'projects', 'id', 'intake_forms', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE intake_forms ADD CONSTRAINT intake_forms_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip intake_forms_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- lead_activities
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'lead_activities' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip lead_activities_lead_id_fk: table lead_activities missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lead_activities' AND column_name = 'lead_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip lead_activities_lead_id_fk: column lead_activities.lead_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_activities_lead_id_fk'
  ) THEN
    RAISE NOTICE 'skip lead_activities_lead_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'lead_activities', 'lead_id', 'lead_id', 'leads', 'id', 'lead_activities', 'lead_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE lead_activities ADD CONSTRAINT lead_activities_lead_id_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip lead_activities_lead_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- lead_proposals
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'lead_proposals' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip lead_proposals_lead_id_fk: table lead_proposals missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lead_proposals' AND column_name = 'lead_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip lead_proposals_lead_id_fk: column lead_proposals.lead_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_proposals_lead_id_fk'
  ) THEN
    RAISE NOTICE 'skip lead_proposals_lead_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'lead_proposals', 'lead_id', 'lead_id', 'leads', 'id', 'lead_proposals', 'lead_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE lead_proposals ADD CONSTRAINT lead_proposals_lead_id_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip lead_proposals_lead_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- leads
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'leads' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip leads_tenant_id_fk: table leads missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip leads_tenant_id_fk: column leads.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip leads_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'leads', 'tenant_id', 'tenant_id', 'tenants', 'id', 'leads', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE leads ADD CONSTRAINT leads_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip leads_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- pipeline_partial_drafts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'pipeline_partial_drafts' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip pipeline_partial_drafts_scope_draft_id_fk: table pipeline_partial_drafts missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipeline_partial_drafts' AND column_name = 'scope_draft_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip pipeline_partial_drafts_scope_draft_id_fk: column pipeline_partial_drafts.scope_draft_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_partial_drafts_scope_draft_id_fk'
  ) THEN
    RAISE NOTICE 'skip pipeline_partial_drafts_scope_draft_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'pipeline_partial_drafts', 'scope_draft_id', 'scope_draft_id', 'scope_drafts', 'id', 'pipeline_partial_drafts', 'scope_draft_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE pipeline_partial_drafts ADD CONSTRAINT pipeline_partial_drafts_scope_draft_id_fk FOREIGN KEY (scope_draft_id) REFERENCES scope_drafts(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip pipeline_partial_drafts_scope_draft_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'profiles' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip profiles_tenant_id_fk: table profiles missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip profiles_tenant_id_fk: column profiles.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip profiles_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'profiles', 'tenant_id', 'tenant_id', 'tenants', 'id', 'profiles', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE profiles ADD CONSTRAINT profiles_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip profiles_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- project_actuals
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_actuals' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_actuals_tenant_id_fk: table project_actuals missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_actuals' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_actuals_tenant_id_fk: column project_actuals.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_actuals_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip project_actuals_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'project_actuals', 'tenant_id', 'tenant_id', 'tenants', 'id', 'project_actuals', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE project_actuals ADD CONSTRAINT project_actuals_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip project_actuals_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_actuals' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_actuals_project_id_fk: table project_actuals missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_actuals' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_actuals_project_id_fk: column project_actuals.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_actuals_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip project_actuals_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'project_actuals', 'project_id', 'project_id', 'projects', 'id', 'project_actuals', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE project_actuals ADD CONSTRAINT project_actuals_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip project_actuals_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_actuals' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_actuals_estimate_item_id_fk: table project_actuals missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_actuals' AND column_name = 'estimate_item_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_actuals_estimate_item_id_fk: column project_actuals.estimate_item_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_actuals_estimate_item_id_fk'
  ) THEN
    RAISE NOTICE 'skip project_actuals_estimate_item_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'project_actuals', 'estimate_item_id', 'estimate_item_id', 'estimate_items', 'id', 'project_actuals', 'estimate_item_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE project_actuals ADD CONSTRAINT project_actuals_estimate_item_id_fk FOREIGN KEY (estimate_item_id) REFERENCES estimate_items(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip project_actuals_estimate_item_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_actuals' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_actuals_cost_code_id_fk: table project_actuals missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_actuals' AND column_name = 'cost_code_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_actuals_cost_code_id_fk: column project_actuals.cost_code_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_actuals_cost_code_id_fk'
  ) THEN
    RAISE NOTICE 'skip project_actuals_cost_code_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'project_actuals', 'cost_code_id', 'cost_code_id', 'cost_codes', 'id', 'project_actuals', 'cost_code_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE project_actuals ADD CONSTRAINT project_actuals_cost_code_id_fk FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip project_actuals_cost_code_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- project_drawings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_drawings' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_drawings_tenant_id_fk: table project_drawings missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_drawings' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_drawings_tenant_id_fk: column project_drawings.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_drawings_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip project_drawings_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'project_drawings', 'tenant_id', 'tenant_id', 'tenants', 'id', 'project_drawings', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE project_drawings ADD CONSTRAINT project_drawings_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip project_drawings_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_drawings' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_drawings_project_id_fk: table project_drawings missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_drawings' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_drawings_project_id_fk: column project_drawings.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_drawings_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip project_drawings_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'project_drawings', 'project_id', 'project_id', 'projects', 'id', 'project_drawings', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE project_drawings ADD CONSTRAINT project_drawings_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip project_drawings_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- project_files
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_files' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_files_tenant_id_fk: table project_files missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_files' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_files_tenant_id_fk: column project_files.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_files_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip project_files_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'project_files', 'tenant_id', 'tenant_id', 'tenants', 'id', 'project_files', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE project_files ADD CONSTRAINT project_files_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip project_files_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_files' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_files_project_id_fk: table project_files missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_files' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_files_project_id_fk: column project_files.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_files_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip project_files_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'project_files', 'project_id', 'project_id', 'projects', 'id', 'project_files', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE project_files ADD CONSTRAINT project_files_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip project_files_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- project_members
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_members' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_members_tenant_id_fk: table project_members missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_members' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_members_tenant_id_fk: column project_members.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_members_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip project_members_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'project_members', 'tenant_id', 'tenant_id', 'tenants', 'id', 'project_members', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE project_members ADD CONSTRAINT project_members_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip project_members_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_members' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_members_project_id_fk: table project_members missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_members' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_members_project_id_fk: column project_members.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_members_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip project_members_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'project_members', 'project_id', 'project_id', 'projects', 'id', 'project_members', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE project_members ADD CONSTRAINT project_members_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip project_members_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_members' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_members_user_id_fk: table project_members missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_members' AND column_name = 'user_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip project_members_user_id_fk: column project_members.user_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_members_user_id_fk'
  ) THEN
    RAISE NOTICE 'skip project_members_user_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'project_members', 'user_id', 'user_id', 'profiles', 'id', 'project_members', 'user_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE project_members ADD CONSTRAINT project_members_user_id_fk FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip project_members_user_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- projects
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'projects' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip projects_tenant_id_fk: table projects missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip projects_tenant_id_fk: column projects.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip projects_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'projects', 'tenant_id', 'tenant_id', 'tenants', 'id', 'projects', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE projects ADD CONSTRAINT projects_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip projects_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- review_actions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'review_actions' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip review_actions_estimate_id_fk: table review_actions missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'review_actions' AND column_name = 'estimate_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip review_actions_estimate_id_fk: column review_actions.estimate_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'review_actions_estimate_id_fk'
  ) THEN
    RAISE NOTICE 'skip review_actions_estimate_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'review_actions', 'estimate_id', 'estimate_id', 'estimates', 'id', 'review_actions', 'estimate_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE review_actions ADD CONSTRAINT review_actions_estimate_id_fk FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip review_actions_estimate_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- rfi_candidates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'rfi_candidates' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip rfi_candidates_tenant_id_fk: table rfi_candidates missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rfi_candidates' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip rfi_candidates_tenant_id_fk: column rfi_candidates.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rfi_candidates_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip rfi_candidates_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'rfi_candidates', 'tenant_id', 'tenant_id', 'tenants', 'id', 'rfi_candidates', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE rfi_candidates ADD CONSTRAINT rfi_candidates_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip rfi_candidates_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'rfi_candidates' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip rfi_candidates_project_id_fk: table rfi_candidates missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rfi_candidates' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip rfi_candidates_project_id_fk: column rfi_candidates.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rfi_candidates_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip rfi_candidates_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'rfi_candidates', 'project_id', 'project_id', 'projects', 'id', 'rfi_candidates', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE rfi_candidates ADD CONSTRAINT rfi_candidates_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip rfi_candidates_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'rfi_candidates' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip rfi_candidates_scope_source_id_fk: table rfi_candidates missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rfi_candidates' AND column_name = 'scope_source_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip rfi_candidates_scope_source_id_fk: column rfi_candidates.scope_source_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rfi_candidates_scope_source_id_fk'
  ) THEN
    RAISE NOTICE 'skip rfi_candidates_scope_source_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'rfi_candidates', 'scope_source_id', 'scope_source_id', 'scope_sources', 'id', 'rfi_candidates', 'scope_source_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE rfi_candidates ADD CONSTRAINT rfi_candidates_scope_source_id_fk FOREIGN KEY (scope_source_id) REFERENCES scope_sources(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip rfi_candidates_scope_source_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'rfi_candidates' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip rfi_candidates_drawing_id_fk: table rfi_candidates missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rfi_candidates' AND column_name = 'drawing_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip rfi_candidates_drawing_id_fk: column rfi_candidates.drawing_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rfi_candidates_drawing_id_fk'
  ) THEN
    RAISE NOTICE 'skip rfi_candidates_drawing_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'rfi_candidates', 'drawing_id', 'drawing_id', 'project_drawings', 'id', 'rfi_candidates', 'drawing_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE rfi_candidates ADD CONSTRAINT rfi_candidates_drawing_id_fk FOREIGN KEY (drawing_id) REFERENCES project_drawings(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip rfi_candidates_drawing_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- role_permissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'role_permissions' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip role_permissions_role_id_fk: table role_permissions missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'role_permissions' AND column_name = 'role_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip role_permissions_role_id_fk: column role_permissions.role_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_role_id_fk'
  ) THEN
    RAISE NOTICE 'skip role_permissions_role_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'role_permissions', 'role_id', 'role_id', 'roles', 'id', 'role_permissions', 'role_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_id_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip role_permissions_role_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'role_permissions' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip role_permissions_permission_id_fk: table role_permissions missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'role_permissions' AND column_name = 'permission_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip role_permissions_permission_id_fk: column role_permissions.permission_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_permission_id_fk'
  ) THEN
    RAISE NOTICE 'skip role_permissions_permission_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'role_permissions', 'permission_id', 'permission_id', 'permissions', 'id', 'role_permissions', 'permission_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_permission_id_fk FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip role_permissions_permission_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- roof_segments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'roof_segments' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip roof_segments_lead_id_fk: table roof_segments missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'roof_segments' AND column_name = 'lead_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip roof_segments_lead_id_fk: column roof_segments.lead_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'roof_segments_lead_id_fk'
  ) THEN
    RAISE NOTICE 'skip roof_segments_lead_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'roof_segments', 'lead_id', 'lead_id', 'leads', 'id', 'roof_segments', 'lead_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE roof_segments ADD CONSTRAINT roof_segments_lead_id_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip roof_segments_lead_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- scope_draft_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_draft_items' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_draft_items_scope_draft_id_fk: table scope_draft_items missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_draft_items' AND column_name = 'scope_draft_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_draft_items_scope_draft_id_fk: column scope_draft_items.scope_draft_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_draft_items_scope_draft_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_draft_items_scope_draft_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_draft_items', 'scope_draft_id', 'scope_draft_id', 'scope_drafts', 'id', 'scope_draft_items', 'scope_draft_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_draft_items ADD CONSTRAINT scope_draft_items_scope_draft_id_fk FOREIGN KEY (scope_draft_id) REFERENCES scope_drafts(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_draft_items_scope_draft_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_draft_items' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_draft_items_cost_code_id_fk: table scope_draft_items missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_draft_items' AND column_name = 'cost_code_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_draft_items_cost_code_id_fk: column scope_draft_items.cost_code_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_draft_items_cost_code_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_draft_items_cost_code_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_draft_items', 'cost_code_id', 'cost_code_id', 'cost_codes', 'id', 'scope_draft_items', 'cost_code_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_draft_items ADD CONSTRAINT scope_draft_items_cost_code_id_fk FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_draft_items_cost_code_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_draft_items' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_draft_items_assembly_id_fk: table scope_draft_items missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_draft_items' AND column_name = 'assembly_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_draft_items_assembly_id_fk: column scope_draft_items.assembly_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_draft_items_assembly_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_draft_items_assembly_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_draft_items', 'assembly_id', 'assembly_id', 'assemblies', 'id', 'scope_draft_items', 'assembly_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_draft_items ADD CONSTRAINT scope_draft_items_assembly_id_fk FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_draft_items_assembly_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- scope_drafts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_drafts' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_drafts_tenant_id_fk: table scope_drafts missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_drafts' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_drafts_tenant_id_fk: column scope_drafts.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_drafts_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_drafts_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_drafts', 'tenant_id', 'tenant_id', 'tenants', 'id', 'scope_drafts', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_drafts ADD CONSTRAINT scope_drafts_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_drafts_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_drafts' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_drafts_project_id_fk: table scope_drafts missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_drafts' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_drafts_project_id_fk: column scope_drafts.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_drafts_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_drafts_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_drafts', 'project_id', 'project_id', 'projects', 'id', 'scope_drafts', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_drafts ADD CONSTRAINT scope_drafts_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_drafts_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_drafts' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_drafts_intake_form_id_fk: table scope_drafts missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_drafts' AND column_name = 'intake_form_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_drafts_intake_form_id_fk: column scope_drafts.intake_form_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_drafts_intake_form_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_drafts_intake_form_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_drafts', 'intake_form_id', 'intake_form_id', 'intake_forms', 'id', 'scope_drafts', 'intake_form_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_drafts ADD CONSTRAINT scope_drafts_intake_form_id_fk FOREIGN KEY (intake_form_id) REFERENCES intake_forms(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_drafts_intake_form_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- scope_override_log
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_override_log' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_override_log_scope_draft_id_fk: table scope_override_log missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_override_log' AND column_name = 'scope_draft_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_override_log_scope_draft_id_fk: column scope_override_log.scope_draft_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_override_log_scope_draft_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_override_log_scope_draft_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_override_log', 'scope_draft_id', 'scope_draft_id', 'scope_drafts', 'id', 'scope_override_log', 'scope_draft_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_override_log ADD CONSTRAINT scope_override_log_scope_draft_id_fk FOREIGN KEY (scope_draft_id) REFERENCES scope_drafts(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_override_log_scope_draft_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_override_log' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_override_log_override_id_fk: table scope_override_log missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_override_log' AND column_name = 'override_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_override_log_override_id_fk: column scope_override_log.override_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_override_log_override_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_override_log_override_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_override_log', 'override_id', 'override_id', 'geographic_overrides', 'id', 'scope_override_log', 'override_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_override_log ADD CONSTRAINT scope_override_log_override_id_fk FOREIGN KEY (override_id) REFERENCES geographic_overrides(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_override_log_override_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- scope_review_deltas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_review_deltas' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_review_deltas_scope_draft_id_fk: table scope_review_deltas missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_review_deltas' AND column_name = 'scope_draft_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_review_deltas_scope_draft_id_fk: column scope_review_deltas.scope_draft_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_review_deltas_scope_draft_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_review_deltas_scope_draft_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_review_deltas', 'scope_draft_id', 'scope_draft_id', 'scope_drafts', 'id', 'scope_review_deltas', 'scope_draft_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_review_deltas ADD CONSTRAINT scope_review_deltas_scope_draft_id_fk FOREIGN KEY (scope_draft_id) REFERENCES scope_drafts(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_review_deltas_scope_draft_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- scope_review_snapshots
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_review_snapshots' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_review_snapshots_scope_draft_id_fk: table scope_review_snapshots missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_review_snapshots' AND column_name = 'scope_draft_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_review_snapshots_scope_draft_id_fk: column scope_review_snapshots.scope_draft_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_review_snapshots_scope_draft_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_review_snapshots_scope_draft_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_review_snapshots', 'scope_draft_id', 'scope_draft_id', 'scope_drafts', 'id', 'scope_review_snapshots', 'scope_draft_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_review_snapshots ADD CONSTRAINT scope_review_snapshots_scope_draft_id_fk FOREIGN KEY (scope_draft_id) REFERENCES scope_drafts(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_review_snapshots_scope_draft_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_review_snapshots' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_review_snapshots_bundle_id_fk: table scope_review_snapshots missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_review_snapshots' AND column_name = 'bundle_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_review_snapshots_bundle_id_fk: column scope_review_snapshots.bundle_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_review_snapshots_bundle_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_review_snapshots_bundle_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_review_snapshots', 'bundle_id', 'bundle_id', 'bundles', 'id', 'scope_review_snapshots', 'bundle_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_review_snapshots ADD CONSTRAINT scope_review_snapshots_bundle_id_fk FOREIGN KEY (bundle_id) REFERENCES bundles(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_review_snapshots_bundle_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;

-- scope_sources
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_sources' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_sources_tenant_id_fk: table scope_sources missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_sources' AND column_name = 'tenant_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_sources_tenant_id_fk: column scope_sources.tenant_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_sources_tenant_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_sources_tenant_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_sources', 'tenant_id', 'tenant_id', 'tenants', 'id', 'scope_sources', 'tenant_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_sources ADD CONSTRAINT scope_sources_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_sources_tenant_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_sources' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_sources_project_id_fk: table scope_sources missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_sources' AND column_name = 'project_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_sources_project_id_fk: column scope_sources.project_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_sources_project_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_sources_project_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_sources', 'project_id', 'project_id', 'projects', 'id', 'scope_sources', 'project_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_sources ADD CONSTRAINT scope_sources_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_sources_project_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_sources' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_sources_drawing_revision_id_fk: table scope_sources missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_sources' AND column_name = 'drawing_revision_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_sources_drawing_revision_id_fk: column scope_sources.drawing_revision_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_sources_drawing_revision_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_sources_drawing_revision_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_sources', 'drawing_revision_id', 'drawing_revision_id', 'drawing_revision_snapshots', 'id', 'scope_sources', 'drawing_revision_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_sources ADD CONSTRAINT scope_sources_drawing_revision_id_fk FOREIGN KEY (drawing_revision_id) REFERENCES drawing_revision_snapshots(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_sources_drawing_revision_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_sources' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_sources_intake_form_id_fk: table scope_sources missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_sources' AND column_name = 'intake_form_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_sources_intake_form_id_fk: column scope_sources.intake_form_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_sources_intake_form_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_sources_intake_form_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_sources', 'intake_form_id', 'intake_form_id', 'intake_forms', 'id', 'scope_sources', 'intake_form_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_sources ADD CONSTRAINT scope_sources_intake_form_id_fk FOREIGN KEY (intake_form_id) REFERENCES intake_forms(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_sources_intake_form_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_sources' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_sources_scope_draft_id_fk: table scope_sources missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scope_sources' AND column_name = 'scope_draft_id' AND table_schema = current_schema()
  ) THEN
    RAISE NOTICE 'skip scope_sources_scope_draft_id_fk: column scope_sources.scope_draft_id missing';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_sources_scope_draft_id_fk'
  ) THEN
    RAISE NOTICE 'skip scope_sources_scope_draft_id_fk: already present';
  ELSE
    -- Detach orphans first so the constraint can be validated.
    EXECUTE format(
      'UPDATE %I SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I t WHERE t.%I = %I.%I)',
      'scope_sources', 'scope_draft_id', 'scope_draft_id', 'scope_drafts', 'id', 'scope_sources', 'scope_draft_id'
    );
    BEGIN
      EXECUTE 'ALTER TABLE scope_sources ADD CONSTRAINT scope_sources_scope_draft_id_fk FOREIGN KEY (scope_draft_id) REFERENCES scope_drafts(id) ON DELETE SET NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip scope_sources_scope_draft_id_fk: %', SQLERRM;
    END;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- 6. INDEXES
-- ─────────────────────────────────────────────────────────────────────

-- assemblies
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'assemblies' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_assemblies_tenant ON assemblies (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_assemblies_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'assemblies' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_assemblies_category ON assemblies (category)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_assemblies_category: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'assemblies' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_assemblies_active ON assemblies (is_active)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_assemblies_active: %', SQLERRM;
    END;
  END IF;
END $$;

-- assembly_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'assembly_items' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_assembly_items_assembly ON assembly_items (assembly_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_assembly_items_assembly: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'assembly_items' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_assembly_items_cost_code ON assembly_items (cost_code_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_assembly_items_cost_code: %', SQLERRM;
    END;
  END IF;
END $$;

-- audit_logs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'audit_logs' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_audit_logs_user: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'audit_logs' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON audit_logs (table_name, record_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_audit_logs_table_record: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'audit_logs' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_audit_logs_created: %', SQLERRM;
    END;
  END IF;
END $$;

-- boq_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'boq_items' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_boq_items_lead ON boq_items (lead_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_boq_items_lead: %', SQLERRM;
    END;
  END IF;
END $$;

-- bundle_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'bundle_items' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON bundle_items (bundle_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_bundle_items_bundle: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'bundle_items' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bundle_items_assembly ON bundle_items (assembly_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_bundle_items_assembly: %', SQLERRM;
    END;
  END IF;
END $$;

-- bundles
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'bundles' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bundles_tenant ON bundles (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_bundles_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'bundles' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bundles_active ON bundles (is_active)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_bundles_active: %', SQLERRM;
    END;
  END IF;
END $$;

-- clients
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'clients' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_clients_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'clients' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_clients_active ON clients (is_active)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_clients_active: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'clients' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_clients_email ON clients (email)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_clients_email: %', SQLERRM;
    END;
  END IF;
END $$;

-- cost_code_pricing_history
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cost_code_pricing_history' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ccph_cost_code ON cost_code_pricing_history (cost_code_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_ccph_cost_code: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cost_code_pricing_history' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ccph_active ON cost_code_pricing_history (is_active)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_ccph_active: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cost_code_pricing_history' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ccph_effective ON cost_code_pricing_history (effective_date)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_ccph_effective: %', SQLERRM;
    END;
  END IF;
END $$;

-- cost_codes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cost_codes' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cost_codes_tenant ON cost_codes (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_cost_codes_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cost_codes' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cost_codes_parent ON cost_codes (parent_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_cost_codes_parent: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cost_codes' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cost_codes_active ON cost_codes (is_active)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_cost_codes_active: %', SQLERRM;
    END;
  END IF;
END $$;

-- deal_activities
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'deal_activities' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_deal_activities_deal ON deal_activities (deal_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_deal_activities_deal: %', SQLERRM;
    END;
  END IF;
END $$;

-- deal_stage_history
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'deal_stage_history' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_deal_stage_history_deal ON deal_stage_history (deal_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_deal_stage_history_deal: %', SQLERRM;
    END;
  END IF;
END $$;

-- deals
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'deals' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_deals_tenant ON deals (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_deals_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'deals' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_deals_lead ON deals (lead_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_deals_lead: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'deals' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals (stage)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_deals_stage: %', SQLERRM;
    END;
  END IF;
END $$;

-- drawing_revision_snapshots
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'drawing_revision_snapshots' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_drawing_snapshots_project ON drawing_revision_snapshots (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_drawing_snapshots_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'drawing_revision_snapshots' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_drawing_snapshots_tenant ON drawing_revision_snapshots (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_drawing_snapshots_tenant: %', SQLERRM;
    END;
  END IF;
END $$;

-- estimate_drafts
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_drafts' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_estimate_drafts_tenant ON estimate_drafts (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_estimate_drafts_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_drafts' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_estimate_drafts_project ON estimate_drafts (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_estimate_drafts_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_drafts' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_estimate_drafts_estimate ON estimate_drafts (estimate_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_estimate_drafts_estimate: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_drafts' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_estimate_drafts_scope_draft ON estimate_drafts (scope_draft_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_estimate_drafts_scope_draft: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_drafts' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_estimate_drafts_status ON estimate_drafts (status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_estimate_drafts_status: %', SQLERRM;
    END;
  END IF;
END $$;

-- estimate_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_items' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_estimate_items_tenant ON estimate_items (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_estimate_items_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_items' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_estimate_items_project ON estimate_items (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_estimate_items_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_items' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_estimate_items_cost_code ON estimate_items (cost_code_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_estimate_items_cost_code: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_items' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_estimate_items_assembly ON estimate_items (assembly_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_estimate_items_assembly: %', SQLERRM;
    END;
  END IF;
END $$;

-- estimate_variance_events
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_variance_events' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_variance_events_project ON estimate_variance_events (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_variance_events_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimate_variance_events' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_variance_events_cost_code ON estimate_variance_events (cost_code_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_variance_events_cost_code: %', SQLERRM;
    END;
  END IF;
END $$;

-- estimates
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimates' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_estimates_tenant ON estimates (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_estimates_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimates' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_estimates_project ON estimates (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_estimates_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'estimates' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates (status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_estimates_status: %', SQLERRM;
    END;
  END IF;
END $$;

-- field_feedback_reports
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'field_feedback_reports' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_field_feedback_project ON field_feedback_reports (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_field_feedback_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'field_feedback_reports' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_field_feedback_status ON field_feedback_reports (status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_field_feedback_status: %', SQLERRM;
    END;
  END IF;
END $$;

-- geographic_overrides
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'geographic_overrides' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_geo_overrides_tenant ON geographic_overrides (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_geo_overrides_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'geographic_overrides' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_geo_overrides_zone ON geographic_overrides (zone_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_geo_overrides_zone: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'geographic_overrides' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_geo_overrides_assembly ON geographic_overrides (assembly_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_geo_overrides_assembly: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'geographic_overrides' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_geo_overrides_active ON geographic_overrides (is_active)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_geo_overrides_active: %', SQLERRM;
    END;
  END IF;
END $$;

-- intake_forms
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'intake_forms' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_intake_forms_tenant ON intake_forms (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_intake_forms_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'intake_forms' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_intake_forms_project ON intake_forms (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_intake_forms_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'intake_forms' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_intake_forms_lead ON intake_forms (lead_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_intake_forms_lead: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'intake_forms' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_intake_forms_status ON intake_forms (status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_intake_forms_status: %', SQLERRM;
    END;
  END IF;
END $$;

-- lead_activities
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'lead_activities' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities (lead_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_lead_activities_lead: %', SQLERRM;
    END;
  END IF;
END $$;

-- lead_proposals
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'lead_proposals' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_lead_proposals_lead ON lead_proposals (lead_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_lead_proposals_lead: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'lead_proposals' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_lead_proposals_status ON lead_proposals (status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_lead_proposals_status: %', SQLERRM;
    END;
  END IF;
END $$;

-- leads
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'leads' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_leads_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'leads' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_leads_status: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'leads' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads (owner_user_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_leads_owner: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'leads' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_leads_tenant_status ON leads (tenant_id, status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_leads_tenant_status: %', SQLERRM;
    END;
  END IF;
END $$;

-- permissions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'permissions' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_perm_resource ON permissions (resource)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_perm_resource: %', SQLERRM;
    END;
  END IF;
END $$;

-- pipeline_partial_drafts
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'pipeline_partial_drafts' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pipeline_partial_drafts_draft ON pipeline_partial_drafts (scope_draft_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_pipeline_partial_drafts_draft: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'pipeline_partial_drafts' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pipeline_partial_drafts_status ON pipeline_partial_drafts (status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_pipeline_partial_drafts_status: %', SQLERRM;
    END;
  END IF;
END $$;

-- profiles
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'profiles' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON profiles (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_profiles_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'profiles' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles (email)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_profiles_email: %', SQLERRM;
    END;
  END IF;
END $$;

-- project_actuals
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_actuals' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_project_actuals_tenant ON project_actuals (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_project_actuals_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_actuals' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_project_actuals_project ON project_actuals (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_project_actuals_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_actuals' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_project_actuals_cost_code ON project_actuals (cost_code_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_project_actuals_cost_code: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_actuals' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_project_actuals_estimate_item ON project_actuals (estimate_item_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_project_actuals_estimate_item: %', SQLERRM;
    END;
  END IF;
END $$;

-- project_drawings
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_drawings' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_project_drawings_project ON project_drawings (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_project_drawings_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_drawings' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_project_drawings_active ON project_drawings (project_id, is_active_revision)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_project_drawings_active: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_drawings' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_project_drawings_tenant ON project_drawings (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_project_drawings_tenant: %', SQLERRM;
    END;
  END IF;
END $$;

-- project_files
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_files' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_project_files_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_files' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_project_files_tenant ON project_files (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_project_files_tenant: %', SQLERRM;
    END;
  END IF;
END $$;

-- project_members
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_members' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_project_members_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_members' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members (user_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_project_members_user: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_members' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_project_members_tenant ON project_members (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_project_members_tenant: %', SQLERRM;
    END;
  END IF;
END $$;

-- projects
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'projects' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_projects_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'projects' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_projects_status: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'projects' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_projects_lead ON projects (lead_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_projects_lead: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'projects' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_projects_client ON projects (client_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_projects_client: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'projects' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner_user_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_projects_owner: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'projects' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_projects_tenant_status ON projects (tenant_id, status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_projects_tenant_status: %', SQLERRM;
    END;
  END IF;
END $$;

-- review_actions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'review_actions' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_review_actions_estimate ON review_actions (estimate_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_review_actions_estimate: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'review_actions' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_review_actions_reviewer ON review_actions (reviewer_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_review_actions_reviewer: %', SQLERRM;
    END;
  END IF;
END $$;

-- rfi_candidates
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'rfi_candidates' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rfi_candidates_project ON rfi_candidates (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_rfi_candidates_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'rfi_candidates' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rfi_candidates_source ON rfi_candidates (scope_source_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_rfi_candidates_source: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'rfi_candidates' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rfi_candidates_tenant ON rfi_candidates (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_rfi_candidates_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'rfi_candidates' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rfi_candidates_status ON rfi_candidates (status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_rfi_candidates_status: %', SQLERRM;
    END;
  END IF;
END $$;

-- role_permissions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'role_permissions' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rp_role ON role_permissions (role_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_rp_role: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'role_permissions' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rp_perm ON role_permissions (permission_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_rp_perm: %', SQLERRM;
    END;
  END IF;
END $$;

-- roof_segments
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'roof_segments' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_roof_segments_lead ON roof_segments (lead_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_roof_segments_lead: %', SQLERRM;
    END;
  END IF;
END $$;

-- scope_draft_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_draft_items' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_draft_items_draft ON scope_draft_items (scope_draft_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_draft_items_draft: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_draft_items' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_draft_items_assembly ON scope_draft_items (assembly_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_draft_items_assembly: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_draft_items' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_draft_items_cost_code ON scope_draft_items (cost_code_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_draft_items_cost_code: %', SQLERRM;
    END;
  END IF;
END $$;

-- scope_drafts
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_drafts' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_drafts_tenant ON scope_drafts (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_drafts_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_drafts' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_drafts_project ON scope_drafts (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_drafts_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_drafts' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_drafts_status ON scope_drafts (status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_drafts_status: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_drafts' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_drafts_intake ON scope_drafts (intake_form_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_drafts_intake: %', SQLERRM;
    END;
  END IF;
END $$;

-- scope_override_log
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_override_log' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_override_log_draft ON scope_override_log (scope_draft_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_override_log_draft: %', SQLERRM;
    END;
  END IF;
END $$;

-- scope_review_deltas
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_review_deltas' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_review_deltas_draft ON scope_review_deltas (scope_draft_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_review_deltas_draft: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_review_deltas' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_review_deltas_status ON scope_review_deltas (status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_review_deltas_status: %', SQLERRM;
    END;
  END IF;
END $$;

-- scope_review_snapshots
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_review_snapshots' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_review_snapshots_draft ON scope_review_snapshots (scope_draft_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_review_snapshots_draft: %', SQLERRM;
    END;
  END IF;
END $$;

-- scope_sources
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_sources' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_sources_project ON scope_sources (project_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_sources_project: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_sources' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_sources_active ON scope_sources (project_id, is_active)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_sources_active: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_sources' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_sources_tenant ON scope_sources (tenant_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_sources_tenant: %', SQLERRM;
    END;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'scope_sources' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scope_sources_review_status ON scope_sources (review_status)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_scope_sources_review_status: %', SQLERRM;
    END;
  END IF;
END $$;

-- tenants
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'tenants' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants (is_active)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index idx_tenants_active: %', SQLERRM;
    END;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- 7. UNIQUE CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────

-- assembly_performance_metrics
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'assembly_performance_metrics' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_assembly_perf_assembly ON assembly_performance_metrics (assembly_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index uq_assembly_perf_assembly: %', SQLERRM;
    END;
  END IF;
END $$;

-- bundle_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'bundle_items' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_bundle_items_bundle_assembly ON bundle_items (bundle_id, assembly_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index uq_bundle_items_bundle_assembly: %', SQLERRM;
    END;
  END IF;
END $$;

-- cost_codes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cost_codes' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_codes_tenant_code ON cost_codes (tenant_id, code)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index uq_cost_codes_tenant_code: %', SQLERRM;
    END;
  END IF;
END $$;

-- permissions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'permissions' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_permissions_resource_action ON permissions (resource, action)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index uq_permissions_resource_action: %', SQLERRM;
    END;
  END IF;
END $$;

-- profiles
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'profiles' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_external_open_id ON profiles (external_open_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index uq_profiles_external_open_id: %', SQLERRM;
    END;
  END IF;
END $$;

-- project_members
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'project_members' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_project_members_project_user ON project_members (project_id, user_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index uq_project_members_project_user: %', SQLERRM;
    END;
  END IF;
END $$;

-- role_permissions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'role_permissions' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_role_permissions_role_perm ON role_permissions (role_id, permission_id)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index uq_role_permissions_role_perm: %', SQLERRM;
    END;
  END IF;
END $$;

-- tenants
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'tenants' AND table_schema = current_schema()
  ) THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_slug ON tenants (slug)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip index uq_tenants_slug: %', SQLERRM;
    END;
  END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════
-- END OF PHASE 1 MIGRATION
-- ═════════════════════════════════════════════════════════════════════
