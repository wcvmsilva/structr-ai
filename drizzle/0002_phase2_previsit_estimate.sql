-- ═════════════════════════════════════════════════════════════════════
-- structr.ai — PHASE 2 MIGRATION
-- Pre-visit, geo propagation, estimate versioning, JobTread export registry
-- ═════════════════════════════════════════════════════════════════════
--
-- Idempotent by design: safe to run repeatedly and safe against a database that is
-- already partially migrated. Every constraint is created inside a guard block, so an
-- unexpected data condition emits a NOTICE instead of aborting the deploy.
--
-- Order of operations:
--   1. new tables            (previsit_briefs, previsit_checklist_items, jobtread_exports)
--   2. new columns           (leads, clients, projects, estimate_drafts, scope_drafts,
--                             scope_review_snapshots)
--   3. backfill              (normalized keys, commercial channel, estimate version)
--   4. foreign keys          (business relations)
--   5. indexes               (lookup + reconciliation paths)
--   6. integrity constraints (approved estimate immutability, export state domain)
--
-- Requires: pgcrypto (or pg 13+ built-in gen_random_uuid).
-- ═════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────
-- 1. NEW TABLES
-- ─────────────────────────────────────────────────────────────────────

-- Pre-Visit Project Brief. Column list mirrors `previsitBriefs` in drizzle/schema.ts.
CREATE TABLE IF NOT EXISTS previsit_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  project_id uuid NOT NULL,
  intake_form_id uuid,
  status text NOT NULL DEFAULT 'draft',
  summary text,
  evidence_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  fact_coverage_pct numeric,
  unknown_count integer NOT NULL DEFAULT 0,
  inference_count integer NOT NULL DEFAULT 0,
  next_step text NOT NULL,
  next_step_rationale text,
  discarded_next_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  geo_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  emits_definitive_price boolean NOT NULL DEFAULT false,
  prepared_by uuid,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Field inspection checklist derived from the brief.
CREATE TABLE IF NOT EXISTS previsit_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  project_id uuid NOT NULL,
  brief_id uuid NOT NULL,
  item_key text NOT NULL,
  section text NOT NULL,
  label text NOT NULL,
  reason text,
  is_required boolean NOT NULL DEFAULT true,
  source_key text,
  status text NOT NULL DEFAULT 'open',
  captured_value text,
  captured_evidence text,
  captured_by uuid,
  captured_at timestamptz,
  waived_reason text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- JobTread export attempt registry. Immutable per attempt (JIC-014).
CREATE TABLE IF NOT EXISTS jobtread_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  project_id uuid,
  estimate_draft_id uuid,
  estimate_version integer,
  contract_version text NOT NULL DEFAULT 'csv-v1.0',
  status text NOT NULL DEFAULT 'requested',
  block_reason text,
  row_count integer NOT NULL DEFAULT 0,
  approved_total_cents integer,
  exported_total_cents integer,
  difference_cents integer,
  reconciliation_status text,
  csv_hash text,
  manifest jsonb,
  validation_report jsonb,
  skill_id text NOT NULL DEFAULT 'gchi-jobtread-integration-contract',
  skill_version text NOT NULL DEFAULT '1.0.0',
  requested_by uuid,
  downloaded_by uuid,
  downloaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 2. NEW COLUMNS
-- ─────────────────────────────────────────────────────────────────────

-- leads: governed origin (LIG-005) + single next step (LIG-006) + conversion outcome
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS source_channel text;
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS source_detail text;
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS client_type text;
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS commercial_channel text;
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS project_type text;
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS next_step text;
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS next_step_set_by uuid;
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS next_step_set_at timestamptz;
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS converted_client_id uuid;
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS converted_project_id uuid;
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS converted_at timestamptz;
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS conversion_decision text;
ALTER TABLE IF EXISTS leads ADD COLUMN IF NOT EXISTS conversion_blockers jsonb;

-- clients: canonical identity keys used for dedupe (LIG-003)
ALTER TABLE IF EXISTS clients ADD COLUMN IF NOT EXISTS client_type text;
ALTER TABLE IF EXISTS clients ADD COLUMN IF NOT EXISTS commercial_channel text;
ALTER TABLE IF EXISTS clients ADD COLUMN IF NOT EXISTS source_channel text;
ALTER TABLE IF EXISTS clients ADD COLUMN IF NOT EXISTS email_normalized text;
ALTER TABLE IF EXISTS clients ADD COLUMN IF NOT EXISTS phone_normalized text;
ALTER TABLE IF EXISTS clients ADD COLUMN IF NOT EXISTS origin_lead_id uuid;

-- projects: commercial channel, client type, canonical address key, geo propagation
ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS client_type text;
ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS commercial_channel text;
ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS source_channel text;
ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS address_normalized text;
ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS longitude numeric;
ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS geo_warnings jsonb;
ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS geo_risk_class text;
ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS updated_by uuid;

-- estimate_drafts: versioning + immutability + Profit Shield snapshot
ALTER TABLE IF EXISTS estimate_drafts ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS estimate_drafts ADD COLUMN IF NOT EXISTS superseded_by uuid;
ALTER TABLE IF EXISTS estimate_drafts ADD COLUMN IF NOT EXISTS supersedes_id uuid;
ALTER TABLE IF EXISTS estimate_drafts ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE IF EXISTS estimate_drafts ADD COLUMN IF NOT EXISTS change_order_of uuid;
ALTER TABLE IF EXISTS estimate_drafts ADD COLUMN IF NOT EXISTS change_order_reason text;
ALTER TABLE IF EXISTS estimate_drafts ADD COLUMN IF NOT EXISTS commercial_channel text;
ALTER TABLE IF EXISTS estimate_drafts ADD COLUMN IF NOT EXISTS profit_shield_floor_pct numeric;
ALTER TABLE IF EXISTS estimate_drafts ADD COLUMN IF NOT EXISTS profit_shield_evaluation jsonb;
ALTER TABLE IF EXISTS estimate_drafts ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb;

-- scope_drafts: geo propagation + approval accountability
ALTER TABLE IF EXISTS scope_drafts ADD COLUMN IF NOT EXISTS geo_warnings jsonb;
ALTER TABLE IF EXISTS scope_drafts ADD COLUMN IF NOT EXISTS geo_risk_class text;
ALTER TABLE IF EXISTS scope_drafts ADD COLUMN IF NOT EXISTS previsit_brief_id uuid;
ALTER TABLE IF EXISTS scope_drafts ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE IF EXISTS scope_drafts ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE IF EXISTS scope_drafts ADD COLUMN IF NOT EXISTS rejected_by uuid;
ALTER TABLE IF EXISTS scope_drafts ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE IF EXISTS scope_drafts ADD COLUMN IF NOT EXISTS rejection_reason text;

-- scope_review_snapshots: explicit approver on the snapshot
ALTER TABLE IF EXISTS scope_review_snapshots ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE IF EXISTS scope_review_snapshots ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE IF EXISTS scope_review_snapshots ADD COLUMN IF NOT EXISTS decision text;
ALTER TABLE IF EXISTS scope_review_snapshots ADD COLUMN IF NOT EXISTS delta_count integer NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────
-- 3. BACKFILL
-- ─────────────────────────────────────────────────────────────────────

-- 3.1 Normalized client contact keys (digits-only phone, lowercase e-mail).
DO $$
BEGIN
  UPDATE clients
     SET email_normalized = lower(btrim(email))
   WHERE email IS NOT NULL AND btrim(email) <> '' AND email_normalized IS NULL;

  UPDATE clients
     SET phone_normalized = regexp_replace(phone, '\D', '', 'g')
   WHERE phone IS NOT NULL AND btrim(phone) <> '' AND phone_normalized IS NULL;

  -- Drop a leading US country code so "+1 843..." and "843..." match.
  UPDATE clients
     SET phone_normalized = substring(phone_normalized from 2)
   WHERE phone_normalized IS NOT NULL
     AND length(phone_normalized) = 11
     AND left(phone_normalized, 1) = '1';
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Phase 2 backfill (client contact keys) skipped: %', SQLERRM;
END $$;

-- 3.2 Canonical address key for project dedupe. The SQL version is intentionally
--     conservative (case + whitespace + punctuation only); the application layer
--     performs the full abbreviation expansion on write.
DO $$
BEGIN
  UPDATE projects
     SET address_normalized = btrim(regexp_replace(lower(regexp_replace(address, '[.,#]', ' ', 'g')), '\s+', ' ', 'g'))
   WHERE address IS NOT NULL AND btrim(address) <> '' AND address_normalized IS NULL;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Phase 2 backfill (project address key) skipped: %', SQLERRM;
END $$;

-- 3.3 Commercial channel from the legacy pricing channel.
--     direct → premium, insurance/commercial → trade.
DO $$
BEGIN
  UPDATE projects
     SET commercial_channel = CASE
           WHEN lower(coalesce(channel, '')) IN ('direct', 'residential', 'premium', 'homeowner') THEN 'premium'
           WHEN lower(coalesce(channel, '')) IN ('investor', 'capital') THEN 'capital'
           WHEN coalesce(channel, '') <> '' THEN 'trade'
           ELSE NULL
         END
   WHERE commercial_channel IS NULL;

  UPDATE estimate_drafts
     SET commercial_channel = CASE
           WHEN lower(coalesce(channel, '')) IN ('direct', 'residential', 'premium', 'homeowner') THEN 'premium'
           WHEN lower(coalesce(channel, '')) IN ('investor', 'capital') THEN 'capital'
           WHEN coalesce(channel, '') <> '' THEN 'trade'
           ELSE NULL
         END
   WHERE commercial_channel IS NULL;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Phase 2 backfill (commercial channel) skipped: %', SQLERRM;
END $$;

-- 3.4 Governed lead origin from the legacy free-text source.
DO $$
BEGIN
  UPDATE leads
     SET source_channel = CASE lower(coalesce(source, ''))
           WHEN 'web' THEN 'website_direct'
           WHEN 'website' THEN 'website_direct'
           WHEN 'direct' THEN 'website_direct'
           WHEN 'google' THEN 'organic_search'
           WHEN 'houzz' THEN 'paid_search'
           WHEN 'referral' THEN 'referral'
           WHEN 'repeat_client' THEN 'repeat_client'
           WHEN 'social' THEN 'social'
           WHEN 'phone' THEN 'phone'
           WHEN 'walk_in' THEN 'walk_in'
           ELSE 'other'
         END
   WHERE source_channel IS NULL;

  -- Preserve the original free-text value whenever it did not map cleanly.
  UPDATE leads
     SET source_detail = 'raw_source=' || source
   WHERE source_detail IS NULL
     AND source IS NOT NULL
     AND source_channel = 'other'
     AND lower(source) <> 'other';
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Phase 2 backfill (lead origin) skipped: %', SQLERRM;
END $$;

-- 3.5 Lock already-approved estimate drafts so the immutability guard has a timestamp.
DO $$
BEGIN
  UPDATE estimate_drafts
     SET locked_at = coalesce(approved_at, updated_at)
   WHERE status = 'approved' AND locked_at IS NULL;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Phase 2 backfill (estimate lock) skipped: %', SQLERRM;
END $$;

-- 3.6 Tenant propagation for the new tables (single-tenant install: gchi).
DO $$
DECLARE default_tenant uuid;
BEGIN
  SELECT id INTO default_tenant FROM tenants WHERE slug = 'gchi' LIMIT 1;
  IF default_tenant IS NULL THEN
    RAISE NOTICE 'Phase 2: default tenant "gchi" not found — new tables keep tenant_id NULL until backfill.';
    RETURN;
  END IF;

  UPDATE previsit_briefs SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE previsit_checklist_items SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE jobtread_exports SET tenant_id = default_tenant WHERE tenant_id IS NULL;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Phase 2 backfill (tenant propagation) skipped: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. FOREIGN KEYS
-- ─────────────────────────────────────────────────────────────────────

-- previsit_briefs
DO $$
BEGIN
  ALTER TABLE previsit_briefs
    ADD CONSTRAINT fk_previsit_briefs_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_previsit_briefs_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE previsit_briefs
    ADD CONSTRAINT fk_previsit_briefs_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_previsit_briefs_project skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE previsit_briefs
    ADD CONSTRAINT fk_previsit_briefs_intake
    FOREIGN KEY (intake_form_id) REFERENCES intake_forms(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_previsit_briefs_intake skipped: %', SQLERRM;
END $$;

-- previsit_checklist_items
DO $$
BEGIN
  ALTER TABLE previsit_checklist_items
    ADD CONSTRAINT fk_previsit_checklist_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_previsit_checklist_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE previsit_checklist_items
    ADD CONSTRAINT fk_previsit_checklist_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_previsit_checklist_project skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE previsit_checklist_items
    ADD CONSTRAINT fk_previsit_checklist_brief
    FOREIGN KEY (brief_id) REFERENCES previsit_briefs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_previsit_checklist_brief skipped: %', SQLERRM;
END $$;

-- jobtread_exports
DO $$
BEGIN
  ALTER TABLE jobtread_exports
    ADD CONSTRAINT fk_jobtread_exports_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_jobtread_exports_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE jobtread_exports
    ADD CONSTRAINT fk_jobtread_exports_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_jobtread_exports_project skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE jobtread_exports
    ADD CONSTRAINT fk_jobtread_exports_estimate
    FOREIGN KEY (estimate_draft_id) REFERENCES estimate_drafts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_jobtread_exports_estimate skipped: %', SQLERRM;
END $$;

-- leads → clients / projects (conversion outcome)
DO $$
BEGIN
  ALTER TABLE leads
    ADD CONSTRAINT fk_leads_converted_client
    FOREIGN KEY (converted_client_id) REFERENCES clients(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_leads_converted_client skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE leads
    ADD CONSTRAINT fk_leads_converted_project
    FOREIGN KEY (converted_project_id) REFERENCES projects(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_leads_converted_project skipped: %', SQLERRM;
END $$;

-- clients → leads (origin)
DO $$
BEGIN
  ALTER TABLE clients
    ADD CONSTRAINT fk_clients_origin_lead
    FOREIGN KEY (origin_lead_id) REFERENCES leads(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_clients_origin_lead skipped: %', SQLERRM;
END $$;

-- estimate_drafts version chain
DO $$
BEGIN
  ALTER TABLE estimate_drafts
    ADD CONSTRAINT fk_estimate_drafts_superseded_by
    FOREIGN KEY (superseded_by) REFERENCES estimate_drafts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_estimate_drafts_superseded_by skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE estimate_drafts
    ADD CONSTRAINT fk_estimate_drafts_supersedes
    FOREIGN KEY (supersedes_id) REFERENCES estimate_drafts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_estimate_drafts_supersedes skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE estimate_drafts
    ADD CONSTRAINT fk_estimate_drafts_change_order_of
    FOREIGN KEY (change_order_of) REFERENCES estimate_drafts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_estimate_drafts_change_order_of skipped: %', SQLERRM;
END $$;

-- scope_drafts → previsit_briefs
DO $$
BEGIN
  ALTER TABLE scope_drafts
    ADD CONSTRAINT fk_scope_drafts_previsit_brief
    FOREIGN KEY (previsit_brief_id) REFERENCES previsit_briefs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_scope_drafts_previsit_brief skipped: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. INDEXES
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_previsit_briefs_tenant ON previsit_briefs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_previsit_briefs_project ON previsit_briefs (project_id);
CREATE INDEX IF NOT EXISTS idx_previsit_briefs_status ON previsit_briefs (status);
CREATE INDEX IF NOT EXISTS idx_previsit_briefs_intake ON previsit_briefs (intake_form_id);

CREATE INDEX IF NOT EXISTS idx_previsit_checklist_project ON previsit_checklist_items (project_id);
CREATE INDEX IF NOT EXISTS idx_previsit_checklist_brief ON previsit_checklist_items (brief_id);
CREATE INDEX IF NOT EXISTS idx_previsit_checklist_status ON previsit_checklist_items (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_previsit_checklist_brief_key
  ON previsit_checklist_items (brief_id, item_key);

CREATE INDEX IF NOT EXISTS idx_jobtread_exports_tenant ON jobtread_exports (tenant_id);
CREATE INDEX IF NOT EXISTS idx_jobtread_exports_project ON jobtread_exports (project_id);
CREATE INDEX IF NOT EXISTS idx_jobtread_exports_estimate ON jobtread_exports (estimate_draft_id);
CREATE INDEX IF NOT EXISTS idx_jobtread_exports_status ON jobtread_exports (status);

CREATE INDEX IF NOT EXISTS idx_leads_source_channel ON leads (source_channel);
CREATE INDEX IF NOT EXISTS idx_leads_next_step ON leads (next_step);
CREATE INDEX IF NOT EXISTS idx_clients_email_normalized ON clients (tenant_id, email_normalized);
CREATE INDEX IF NOT EXISTS idx_clients_phone_normalized ON clients (tenant_id, phone_normalized);
CREATE INDEX IF NOT EXISTS idx_projects_address_normalized ON projects (tenant_id, address_normalized);
CREATE INDEX IF NOT EXISTS idx_estimate_drafts_version ON estimate_drafts (project_id, version);
CREATE INDEX IF NOT EXISTS idx_scope_review_snapshots_approver ON scope_review_snapshots (approved_by);

-- ─────────────────────────────────────────────────────────────────────
-- 6. INTEGRITY CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────

-- 6.1 A pre-visit brief can never declare a definitive price.
DO $$
BEGIN
  ALTER TABLE previsit_briefs
    ADD CONSTRAINT ck_previsit_no_definitive_price
    CHECK (emits_definitive_price = false);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_previsit_no_definitive_price skipped: %', SQLERRM;
END $$;

-- 6.2 Pre-visit next step must belong to the closed vocabulary.
DO $$
BEGIN
  ALTER TABLE previsit_briefs
    ADD CONSTRAINT ck_previsit_next_step_domain
    CHECK (next_step IN (
      'conceptual_estimate',
      'survey_zoning_verification',
      'design',
      'structural_evaluation',
      'paid_preconstruction',
      'design_build_proposal'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_previsit_next_step_domain skipped: %', SQLERRM;
END $$;

-- 6.3 Export status must belong to the JIC workflow domain.
DO $$
BEGIN
  ALTER TABLE jobtread_exports
    ADD CONSTRAINT ck_jobtread_export_status_domain
    CHECK (status IN (
      'requested',
      'validating',
      'reconciling',
      'needs_exception_review',
      'approved_for_download',
      'downloaded',
      'blocked_validation',
      'blocked_reconciliation',
      'blocked_authorization',
      'cancelled',
      'expired'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_jobtread_export_status_domain skipped: %', SQLERRM;
END $$;

-- 6.4 An approved export must reconcile to zero difference (JIC-003).
DO $$
BEGIN
  ALTER TABLE jobtread_exports
    ADD CONSTRAINT ck_jobtread_export_reconciled
    CHECK (
      status NOT IN ('approved_for_download', 'downloaded')
      OR coalesce(difference_cents, 0) = 0
    );
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_jobtread_export_reconciled skipped: %', SQLERRM;
END $$;

-- 6.5 Estimate version must be a positive integer.
DO $$
BEGIN
  ALTER TABLE estimate_drafts
    ADD CONSTRAINT ck_estimate_drafts_version_positive
    CHECK (version >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_estimate_drafts_version_positive skipped: %', SQLERRM;
END $$;

-- 6.6 Commercial channel domain on the entities that drive margin floors.
DO $$
BEGIN
  ALTER TABLE estimate_drafts
    ADD CONSTRAINT ck_estimate_drafts_commercial_channel
    CHECK (commercial_channel IS NULL OR commercial_channel IN ('premium', 'trade', 'capital'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_estimate_drafts_commercial_channel skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE projects
    ADD CONSTRAINT ck_projects_commercial_channel
    CHECK (commercial_channel IS NULL OR commercial_channel IN ('premium', 'trade', 'capital'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_projects_commercial_channel skipped: %', SQLERRM;
END $$;

-- 6.7 Immutability guard: an approved estimate draft cannot have its money mutated.
--     The trigger blocks in-place edits and forces a new version or a change order.
CREATE OR REPLACE FUNCTION structr_guard_approved_estimate()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    -- Allowed: superseding, locking, archiving, and non-monetary annotation.
    IF (NEW.final_total_price IS DISTINCT FROM OLD.final_total_price)
       OR (NEW.subtotal_price IS DISTINCT FROM OLD.subtotal_price)
       OR (NEW.subtotal_cost IS DISTINCT FROM OLD.subtotal_cost)
       OR (NEW.discount_amount IS DISTINCT FROM OLD.discount_amount)
       OR (NEW.line_items IS DISTINCT FROM OLD.line_items)
       OR (NEW.assembly_selections IS DISTINCT FROM OLD.assembly_selections)
       OR (NEW.version IS DISTINCT FROM OLD.version)
    THEN
      RAISE EXCEPTION 'ESTIMATE_VERSION_LOCKED: estimate draft % is approved and immutable. Create a new version or a change order.', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_guard_approved_estimate ON estimate_drafts;
  CREATE TRIGGER trg_guard_approved_estimate
    BEFORE UPDATE ON estimate_drafts
    FOR EACH ROW EXECUTE FUNCTION structr_guard_approved_estimate();
EXCEPTION WHEN others THEN
  RAISE NOTICE 'trg_guard_approved_estimate skipped: %', SQLERRM;
END $$;
