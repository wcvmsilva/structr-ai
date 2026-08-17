-- ═══════════════════════════════════════════════════════════════════════════════
-- structr.ai — MIGRATION 0004: PHASE 4 (controlled learning + replicable product)
--
-- Contract: docs/phase4-contract.md
-- Depends on: 0001 (tenant/identity), 0002 (previsit/estimate versioning),
--             0003 (field execution + real cost actuals)
--
-- Scope:
--   1. tenant_settings             — per-tenant configuration, branding, feature flags
--   2. calibration_events          — measured accuracy findings (evidence, not authority)
--   3. calibration_reports         — persisted per-project / per-tenant calibration runs
--   4. price_adjustments           — proposed → approved → applied, with rollback
--   5. scope_completeness_scores   — approved scope vs executed scope, per project
--   6. scope_checklist_patterns    — recurring omissions promoted to a checklist
--   7. audit_log                   — canonical tenant-scoped append-only trail
--   8. analytics_snapshots         — frozen dashboard aggregations per period
--
-- IDEMPOTENT: safe to re-run. Every DDL uses IF NOT EXISTS or a DO block that
-- swallows duplicate_object / duplicate_table, exactly like 0001, 0002 and 0003.
--
-- Design decision recorded here on purpose: the legacy `audit_logs` table is NOT
-- migrated into `audit_log`. Historical rows have no tenant and no entity taxonomy;
-- backfilling a tenant into them would fabricate evidence. New writes land in
-- `audit_log`, `audit_logs` remains readable as history.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. TENANT SETTINGS
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  default_channel text NOT NULL DEFAULT 'direct',
  default_commercial_channel text NOT NULL DEFAULT 'premium',
  geo_region text NOT NULL DEFAULT 'charleston_sc',
  default_geo_risk_class text NOT NULL DEFAULT 'coastal',
  timezone text NOT NULL DEFAULT 'America/New_York',
  currency text NOT NULL DEFAULT 'USD',
  locale text NOT NULL DEFAULT 'en-US',
  supported_locales jsonb DEFAULT '["en-US"]'::jsonb,
  profit_shield_overrides jsonb DEFAULT '{}'::jsonb,
  geo_floor_overrides jsonb DEFAULT '{}'::jsonb,
  variance_threshold_pct numeric NOT NULL DEFAULT 10,
  bias_tolerance_pct numeric NOT NULL DEFAULT 5,
  max_adjustment_pct numeric NOT NULL DEFAULT 25,
  auto_apply_adjustments boolean NOT NULL DEFAULT false,
  brand_name text,
  brand_legal_name text,
  brand_logo_url text,
  brand_primary_color text,
  brand_secondary_color text,
  brand_email_signature text,
  brand_license_number text,
  brand_contact_phone text,
  brand_contact_email text,
  brand_address text,
  proposal_footer_text text,
  feature_flags jsonb DEFAULT '[]'::jsonb,
  integrations jsonb DEFAULT '{}'::jsonb,
  onboarding_status text NOT NULL DEFAULT 'not_started',
  onboarding_steps jsonb DEFAULT '{}'::jsonb,
  onboarding_completion_pct numeric NOT NULL DEFAULT 0,
  onboarding_started_at timestamptz,
  onboarding_completed_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 2. CALIBRATION EVENTS
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calibration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid,
  closeout_id uuid,
  budget_estimate_draft_id uuid,
  event_type text NOT NULL,
  scope text NOT NULL DEFAULT 'project',
  period text NOT NULL DEFAULT 'project',
  period_start date,
  period_end date,
  status text NOT NULL DEFAULT 'open',
  cost_code_id uuid,
  cost_code text,
  assembly_id uuid,
  trade text,
  geo_zone_id uuid,
  geo_zone_name text,
  geo_risk_class text,
  project_type text,
  commercial_channel text,
  finding_key text NOT NULL,
  estimated_cents integer,
  actual_cents integer,
  variance_cents integer,
  variance_pct numeric,
  estimated_duration_days numeric,
  actual_duration_days numeric,
  duration_variance_days numeric,
  observed_factor numeric,
  suggested_factor numeric,
  bias_direction text,
  mean_deviation_pct numeric,
  median_deviation_pct numeric,
  deviation_std_dev_pct numeric,
  sample_count integer NOT NULL DEFAULT 0,
  overrun_count integer NOT NULL DEFAULT 0,
  underrun_count integer NOT NULL DEFAULT 0,
  confidence_score numeric,
  confidence_band text NOT NULL DEFAULT 'insufficient',
  suggested_adjustment_pct numeric,
  recommendation text,
  rationale text,
  evidence jsonb,
  price_adjustment_id uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  superseded_by uuid,
  notes text,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 3. CALIBRATION REPORTS
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calibration_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid,
  closeout_id uuid,
  scope text NOT NULL DEFAULT 'project',
  period text NOT NULL DEFAULT 'project',
  period_start date,
  period_end date,
  report_key text NOT NULL,
  project_count integer NOT NULL DEFAULT 0,
  event_count integer NOT NULL DEFAULT 0,
  total_estimated_cents integer NOT NULL DEFAULT 0,
  total_actual_cents integer NOT NULL DEFAULT 0,
  total_variance_cents integer NOT NULL DEFAULT 0,
  total_variance_pct numeric,
  mean_abs_deviation_pct numeric,
  accuracy_score numeric,
  scope_completeness_score numeric,
  scope_completeness_verdict text,
  duration_accuracy_pct numeric,
  realized_gross_profit_pct numeric,
  estimated_gross_profit_pct numeric,
  biased_cost_codes jsonb,
  assemblies_needing_review jsonb,
  geo_factor_findings jsonb,
  duration_findings jsonb,
  scope_gap_findings jsonb,
  proposed_adjustments jsonb,
  report_snapshot jsonb,
  summary text,
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 4. PRICE ADJUSTMENTS
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS price_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  target_type text NOT NULL DEFAULT 'cost_code',
  cost_code_id uuid,
  cost_code text,
  assembly_id uuid,
  geo_zone_id uuid,
  trade text,
  adjustment_pct numeric NOT NULL,
  previous_value numeric,
  new_value numeric,
  previous_unit_cost_cents integer,
  new_unit_cost_cents integer,
  reason text NOT NULL,
  source_calibration_id uuid,
  source_report_id uuid,
  source text NOT NULL DEFAULT 'calibration',
  confidence_score numeric,
  confidence_band text,
  sample_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'proposed',
  proposed_by uuid,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  applied_by uuid,
  applied_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  rolled_back_by uuid,
  rolled_back_at timestamptz,
  rollback_reason text,
  applied_pricing_history_id uuid,
  rollback_snapshot jsonb,
  effective_from date,
  expires_at timestamptz,
  notes text,
  metadata jsonb,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 5. SCOPE COMPLETENESS SCORES
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scope_completeness_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  closeout_id uuid,
  budget_estimate_draft_id uuid,
  project_type text,
  commercial_channel text,
  score numeric NOT NULL,
  verdict text NOT NULL,
  planned_item_count integer NOT NULL DEFAULT 0,
  executed_item_count integer NOT NULL DEFAULT 0,
  matched_item_count integer NOT NULL DEFAULT 0,
  missing_item_count integer NOT NULL DEFAULT 0,
  unplanned_item_count integer NOT NULL DEFAULT 0,
  unplanned_cost_cents integer NOT NULL DEFAULT 0,
  unexecuted_cost_cents integer NOT NULL DEFAULT 0,
  missing_items jsonb,
  unexecuted_items jsonb,
  change_order_covered_count integer NOT NULL DEFAULT 0,
  summary text,
  computed_by uuid,
  computed_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 6. SCOPE CHECKLIST PATTERNS
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scope_checklist_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_type text NOT NULL,
  cost_code_id uuid,
  cost_code text NOT NULL,
  cost_code_name text,
  trade text,
  occurrence_count integer NOT NULL DEFAULT 0,
  project_count integer NOT NULL DEFAULT 0,
  frequency numeric,
  avg_unplanned_cents integer NOT NULL DEFAULT 0,
  total_unplanned_cents integer NOT NULL DEFAULT 0,
  confidence_score numeric,
  confidence_band text NOT NULL DEFAULT 'insufficient',
  is_recurring boolean NOT NULL DEFAULT false,
  suggestion text,
  evidence jsonb,
  last_seen_at timestamptz,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 7. AUDIT LOG (canonical, tenant-scoped, append-only)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  user_label text,
  entity_type text NOT NULL,
  entity_id uuid,
  entity_key text,
  action text NOT NULL,
  project_id uuid,
  before_snapshot jsonb,
  after_snapshot jsonb,
  changed_fields jsonb,
  amount_cents integer,
  reason text,
  ip_address text,
  user_agent text,
  request_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 8. ANALYTICS SNAPSHOTS
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  snapshot_type text NOT NULL,
  period text NOT NULL DEFAULT 'month',
  period_start date,
  period_end date,
  snapshot_key text NOT NULL,
  payload jsonb NOT NULL,
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 9. ADDITIVE COLUMNS ON EXISTING TABLES
-- ─────────────────────────────────────────────────────────────────────

-- Projects: learning outputs consumed by the dashboard without a join.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS calibrated_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scope_completeness_score numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS realized_gross_profit_pct numeric;

-- Cost codes: last approved adjustment, so the price book itself shows it was calibrated.
ALTER TABLE cost_codes ADD COLUMN IF NOT EXISTS last_adjustment_id uuid;
ALTER TABLE cost_codes ADD COLUMN IF NOT EXISTS last_adjustment_pct numeric;
ALTER TABLE cost_codes ADD COLUMN IF NOT EXISTS last_adjusted_at timestamptz;
ALTER TABLE cost_codes ADD COLUMN IF NOT EXISTS calibration_sample_count integer DEFAULT 0;

-- Cost code pricing history: trace a price row back to the adjustment that created it.
ALTER TABLE cost_code_pricing_history ADD COLUMN IF NOT EXISTS price_adjustment_id uuid;

-- Geo zones: tenant ownership so a second GC can carry its own zones and floors.
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS validated_floor_pct numeric;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS validated_at timestamptz;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS validation_sample_count integer DEFAULT 0;

-- Tenants: onboarding/lifecycle status visible without loading settings.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_status text DEFAULT 'not_started';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_demo boolean DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS activated_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────
-- 10. FOREIGN KEYS
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  ALTER TABLE tenant_settings
    ADD CONSTRAINT fk_tenant_settings_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_tenant_settings_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT fk_calibration_events_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_calibration_events_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT fk_calibration_events_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_calibration_events_project skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT fk_calibration_events_closeout
    FOREIGN KEY (closeout_id) REFERENCES project_closeouts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_calibration_events_closeout skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT fk_calibration_events_estimate
    FOREIGN KEY (budget_estimate_draft_id) REFERENCES estimate_drafts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_calibration_events_estimate skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT fk_calibration_events_cost_code
    FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_calibration_events_cost_code skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT fk_calibration_events_assembly
    FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_calibration_events_assembly skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT fk_calibration_events_geo_zone
    FOREIGN KEY (geo_zone_id) REFERENCES geo_zones(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_calibration_events_geo_zone skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT fk_calibration_events_superseded_by
    FOREIGN KEY (superseded_by) REFERENCES calibration_events(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_calibration_events_superseded_by skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE calibration_reports
    ADD CONSTRAINT fk_calibration_reports_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_calibration_reports_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE calibration_reports
    ADD CONSTRAINT fk_calibration_reports_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_calibration_reports_project skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE calibration_reports
    ADD CONSTRAINT fk_calibration_reports_closeout
    FOREIGN KEY (closeout_id) REFERENCES project_closeouts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_calibration_reports_closeout skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE price_adjustments
    ADD CONSTRAINT fk_price_adjustments_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_price_adjustments_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE price_adjustments
    ADD CONSTRAINT fk_price_adjustments_cost_code
    FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_price_adjustments_cost_code skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE price_adjustments
    ADD CONSTRAINT fk_price_adjustments_assembly
    FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_price_adjustments_assembly skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE price_adjustments
    ADD CONSTRAINT fk_price_adjustments_geo_zone
    FOREIGN KEY (geo_zone_id) REFERENCES geo_zones(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_price_adjustments_geo_zone skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE price_adjustments
    ADD CONSTRAINT fk_price_adjustments_source_calibration
    FOREIGN KEY (source_calibration_id) REFERENCES calibration_events(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_price_adjustments_source_calibration skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE price_adjustments
    ADD CONSTRAINT fk_price_adjustments_source_report
    FOREIGN KEY (source_report_id) REFERENCES calibration_reports(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_price_adjustments_source_report skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT fk_calibration_events_price_adjustment
    FOREIGN KEY (price_adjustment_id) REFERENCES price_adjustments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_calibration_events_price_adjustment skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE cost_code_pricing_history
    ADD CONSTRAINT fk_ccph_price_adjustment
    FOREIGN KEY (price_adjustment_id) REFERENCES price_adjustments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_ccph_price_adjustment skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE cost_codes
    ADD CONSTRAINT fk_cost_codes_last_adjustment
    FOREIGN KEY (last_adjustment_id) REFERENCES price_adjustments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_cost_codes_last_adjustment skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE geo_zones
    ADD CONSTRAINT fk_geo_zones_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_geo_zones_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE scope_completeness_scores
    ADD CONSTRAINT fk_scs_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_scs_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE scope_completeness_scores
    ADD CONSTRAINT fk_scs_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_scs_project skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE scope_completeness_scores
    ADD CONSTRAINT fk_scs_closeout
    FOREIGN KEY (closeout_id) REFERENCES project_closeouts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_scs_closeout skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE scope_completeness_scores
    ADD CONSTRAINT fk_scs_estimate
    FOREIGN KEY (budget_estimate_draft_id) REFERENCES estimate_drafts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_scs_estimate skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE scope_checklist_patterns
    ADD CONSTRAINT fk_scp_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_scp_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE scope_checklist_patterns
    ADD CONSTRAINT fk_scp_cost_code
    FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_scp_cost_code skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE audit_log
    ADD CONSTRAINT fk_audit_log_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_audit_log_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE audit_log
    ADD CONSTRAINT fk_audit_log_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_audit_log_project skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE analytics_snapshots
    ADD CONSTRAINT fk_analytics_snapshots_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_analytics_snapshots_tenant skipped: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 11. INDEXES
-- ─────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_settings_tenant ON tenant_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_settings_onboarding ON tenant_settings (onboarding_status);
CREATE INDEX IF NOT EXISTS idx_tenant_settings_region ON tenant_settings (geo_region);

CREATE INDEX IF NOT EXISTS idx_calibration_events_tenant ON calibration_events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_calibration_events_project ON calibration_events (project_id);
CREATE INDEX IF NOT EXISTS idx_calibration_events_type ON calibration_events (event_type);
CREATE INDEX IF NOT EXISTS idx_calibration_events_status ON calibration_events (status);
CREATE INDEX IF NOT EXISTS idx_calibration_events_tenant_type ON calibration_events (tenant_id, event_type);
CREATE INDEX IF NOT EXISTS idx_calibration_events_cost_code ON calibration_events (cost_code_id);
CREATE INDEX IF NOT EXISTS idx_calibration_events_assembly ON calibration_events (assembly_id);
CREATE INDEX IF NOT EXISTS idx_calibration_events_geo_zone ON calibration_events (geo_zone_id);
CREATE INDEX IF NOT EXISTS idx_calibration_events_band ON calibration_events (confidence_band);
CREATE INDEX IF NOT EXISTS idx_calibration_events_closeout ON calibration_events (closeout_id);
-- CL-005: recomputing the same finding updates it instead of duplicating it
CREATE UNIQUE INDEX IF NOT EXISTS uq_calibration_events_finding
  ON calibration_events (tenant_id, finding_key);

CREATE INDEX IF NOT EXISTS idx_calibration_reports_tenant ON calibration_reports (tenant_id);
CREATE INDEX IF NOT EXISTS idx_calibration_reports_project ON calibration_reports (project_id);
CREATE INDEX IF NOT EXISTS idx_calibration_reports_scope ON calibration_reports (scope);
CREATE INDEX IF NOT EXISTS idx_calibration_reports_period
  ON calibration_reports (tenant_id, period, period_start);
CREATE UNIQUE INDEX IF NOT EXISTS uq_calibration_reports_key
  ON calibration_reports (tenant_id, report_key);

CREATE INDEX IF NOT EXISTS idx_price_adjustments_tenant ON price_adjustments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_price_adjustments_status ON price_adjustments (status);
CREATE INDEX IF NOT EXISTS idx_price_adjustments_cost_code ON price_adjustments (cost_code_id);
CREATE INDEX IF NOT EXISTS idx_price_adjustments_assembly ON price_adjustments (assembly_id);
CREATE INDEX IF NOT EXISTS idx_price_adjustments_geo_zone ON price_adjustments (geo_zone_id);
CREATE INDEX IF NOT EXISTS idx_price_adjustments_source ON price_adjustments (source_calibration_id);
CREATE INDEX IF NOT EXISTS idx_price_adjustments_tenant_status ON price_adjustments (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_price_adjustments_applied_at ON price_adjustments (applied_at);
-- PA-005: at most one live adjustment per cost code per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_adjustments_live_cost_code
  ON price_adjustments (tenant_id, cost_code_id)
  WHERE status = 'applied' AND cost_code_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_adjustments_live_assembly
  ON price_adjustments (tenant_id, assembly_id)
  WHERE status = 'applied' AND assembly_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_adjustments_live_geo_zone
  ON price_adjustments (tenant_id, geo_zone_id)
  WHERE status = 'applied' AND geo_zone_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scope_completeness_tenant ON scope_completeness_scores (tenant_id);
CREATE INDEX IF NOT EXISTS idx_scope_completeness_project ON scope_completeness_scores (project_id);
CREATE INDEX IF NOT EXISTS idx_scope_completeness_verdict ON scope_completeness_scores (verdict);
CREATE INDEX IF NOT EXISTS idx_scope_completeness_type
  ON scope_completeness_scores (tenant_id, project_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scope_completeness_project
  ON scope_completeness_scores (project_id);

CREATE INDEX IF NOT EXISTS idx_scope_patterns_tenant ON scope_checklist_patterns (tenant_id);
CREATE INDEX IF NOT EXISTS idx_scope_patterns_type ON scope_checklist_patterns (tenant_id, project_type);
CREATE INDEX IF NOT EXISTS idx_scope_patterns_recurring ON scope_checklist_patterns (is_recurring);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scope_patterns_target
  ON scope_checklist_patterns (tenant_id, project_type, cost_code);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log (project_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created ON audit_log (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_entity
  ON audit_log (tenant_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_tenant ON analytics_snapshots (tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_type
  ON analytics_snapshots (tenant_id, snapshot_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_analytics_snapshots_key
  ON analytics_snapshots (tenant_id, snapshot_key);

CREATE INDEX IF NOT EXISTS idx_geo_zones_tenant ON geo_zones (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_onboarding ON tenants (onboarding_status);
CREATE INDEX IF NOT EXISTS idx_cost_codes_last_adjustment ON cost_codes (last_adjustment_id);
CREATE INDEX IF NOT EXISTS idx_ccph_price_adjustment ON cost_code_pricing_history (price_adjustment_id);

-- ─────────────────────────────────────────────────────────────────────
-- 12. INTEGRITY CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────

-- 12.1 Calibration event type domain (CL-001)
DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT ck_calibration_events_type_domain
    CHECK (event_type IN (
      'price_accuracy', 'scope_completeness', 'duration_accuracy', 'geo_factor_validation'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_calibration_events_type_domain skipped: %', SQLERRM;
END $$;

-- 12.2 Calibration event status domain (CL-002)
DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT ck_calibration_events_status_domain
    CHECK (status IN ('open', 'acknowledged', 'actioned', 'dismissed', 'superseded'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_calibration_events_status_domain skipped: %', SQLERRM;
END $$;

-- 12.3 Calibration scope domain (CL-003)
DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT ck_calibration_events_scope_domain
    CHECK (scope IN ('project', 'tenant'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_calibration_events_scope_domain skipped: %', SQLERRM;
END $$;

-- 12.4 A project-scoped event must name a project; a tenant aggregation must not.
DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT ck_calibration_events_scope_project
    CHECK (
      (scope = 'project' AND project_id IS NOT NULL)
      OR (scope = 'tenant' AND project_id IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_calibration_events_scope_project skipped: %', SQLERRM;
END $$;

-- 12.5 Confidence band domain (CL-004)
DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT ck_calibration_events_band_domain
    CHECK (confidence_band IN ('insufficient', 'low', 'medium', 'high'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_calibration_events_band_domain skipped: %', SQLERRM;
END $$;

-- 12.6 Confidence score bounded 0–100
DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT ck_calibration_events_confidence_range
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_calibration_events_confidence_range skipped: %', SQLERRM;
END $$;

-- 12.7 Bias direction domain (§2)
DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT ck_calibration_events_bias_domain
    CHECK (bias_direction IS NULL OR bias_direction IN (
      'underestimates', 'overestimates', 'accurate', 'inconsistent'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_calibration_events_bias_domain skipped: %', SQLERRM;
END $$;

-- 12.8 Sample counts are non-negative and consistent
DO $$
BEGIN
  ALTER TABLE calibration_events
    ADD CONSTRAINT ck_calibration_events_sample_counts
    CHECK (
      sample_count >= 0 AND overrun_count >= 0 AND underrun_count >= 0
      AND (overrun_count + underrun_count) <= sample_count
    );
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_calibration_events_sample_counts skipped: %', SQLERRM;
END $$;

-- 12.9 Price adjustment status domain (PA-003)
DO $$
BEGIN
  ALTER TABLE price_adjustments
    ADD CONSTRAINT ck_price_adjustments_status_domain
    CHECK (status IN ('proposed', 'approved', 'applied', 'rejected', 'rolled_back', 'expired'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_price_adjustments_status_domain skipped: %', SQLERRM;
END $$;

-- 12.10 Price adjustment target domain
DO $$
BEGIN
  ALTER TABLE price_adjustments
    ADD CONSTRAINT ck_price_adjustments_target_domain
    CHECK (target_type IN ('cost_code', 'assembly', 'geo_factor', 'duration_factor'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_price_adjustments_target_domain skipped: %', SQLERRM;
END $$;

-- 12.11 The target of the adjustment must actually be identified.
DO $$
BEGIN
  ALTER TABLE price_adjustments
    ADD CONSTRAINT ck_price_adjustments_target_present
    CHECK (
      (target_type = 'cost_code' AND cost_code_id IS NOT NULL)
      OR (target_type = 'assembly' AND assembly_id IS NOT NULL)
      OR (target_type = 'geo_factor' AND geo_zone_id IS NOT NULL)
      OR (target_type = 'duration_factor' AND trade IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_price_adjustments_target_present skipped: %', SQLERRM;
END $$;

-- 12.12 PA-001: a single adjustment may never exceed the platform cap of 25%.
DO $$
BEGIN
  ALTER TABLE price_adjustments
    ADD CONSTRAINT ck_price_adjustments_pct_cap
    CHECK (adjustment_pct >= -25 AND adjustment_pct <= 25);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_price_adjustments_pct_cap skipped: %', SQLERRM;
END $$;

-- 12.13 PA-002: an approved adjustment must name the human who approved it.
DO $$
BEGIN
  ALTER TABLE price_adjustments
    ADD CONSTRAINT ck_price_adjustments_approval_identity
    CHECK (
      status NOT IN ('approved', 'applied')
      OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_price_adjustments_approval_identity skipped: %', SQLERRM;
END $$;

-- 12.14 PA-004: an applied adjustment must carry a rollback snapshot.
DO $$
BEGIN
  ALTER TABLE price_adjustments
    ADD CONSTRAINT ck_price_adjustments_rollback_snapshot
    CHECK (status <> 'applied' OR rollback_snapshot IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_price_adjustments_rollback_snapshot skipped: %', SQLERRM;
END $$;

-- 12.15 Scope completeness score bounded and verdict domain (SC4-002)
DO $$
BEGIN
  ALTER TABLE scope_completeness_scores
    ADD CONSTRAINT ck_scs_score_range
    CHECK (score >= 0 AND score <= 100);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_scs_score_range skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE scope_completeness_scores
    ADD CONSTRAINT ck_scs_verdict_domain
    CHECK (verdict IN ('complete', 'minor_gaps', 'material_gaps', 'systemic_gaps'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_scs_verdict_domain skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE scope_completeness_scores
    ADD CONSTRAINT ck_scs_counts_non_negative
    CHECK (
      planned_item_count >= 0 AND executed_item_count >= 0 AND matched_item_count >= 0
      AND missing_item_count >= 0 AND unplanned_item_count >= 0
      AND unplanned_cost_cents >= 0 AND unexecuted_cost_cents >= 0
    );
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_scs_counts_non_negative skipped: %', SQLERRM;
END $$;

-- 12.16 Pattern frequency bounded 0–1 and occurrence never above project count
DO $$
BEGIN
  ALTER TABLE scope_checklist_patterns
    ADD CONSTRAINT ck_scp_frequency_range
    CHECK (frequency IS NULL OR (frequency >= 0 AND frequency <= 1));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_scp_frequency_range skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE scope_checklist_patterns
    ADD CONSTRAINT ck_scp_occurrence_bounds
    CHECK (occurrence_count >= 0 AND project_count >= 0 AND occurrence_count <= project_count);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_scp_occurrence_bounds skipped: %', SQLERRM;
END $$;

-- 12.17 Audit entity type domain (AU-001)
DO $$
BEGIN
  ALTER TABLE audit_log
    ADD CONSTRAINT ck_audit_log_entity_type_domain
    CHECK (entity_type IN (
      'tenant', 'tenant_settings', 'project', 'estimate_draft', 'change_order',
      'project_closeout', 'project_cost_actual', 'field_task', 'calibration_event',
      'calibration_report', 'price_adjustment', 'cost_code', 'assembly', 'geo_zone',
      'jobtread_export'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_audit_log_entity_type_domain skipped: %', SQLERRM;
END $$;

-- 12.18 AU-003: the entity must be identifiable by uuid or business key.
DO $$
BEGIN
  ALTER TABLE audit_log
    ADD CONSTRAINT ck_audit_log_entity_identified
    CHECK (entity_id IS NOT NULL OR entity_key IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_audit_log_entity_identified skipped: %', SQLERRM;
END $$;

-- 12.19 Tenant settings: onboarding status domain and bounded percentages
DO $$
BEGIN
  ALTER TABLE tenant_settings
    ADD CONSTRAINT ck_tenant_settings_onboarding_domain
    CHECK (onboarding_status IN ('not_started', 'in_progress', 'ready', 'active', 'suspended'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_tenant_settings_onboarding_domain skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE tenant_settings
    ADD CONSTRAINT ck_tenant_settings_pct_ranges
    CHECK (
      variance_threshold_pct >= 0 AND variance_threshold_pct <= 100
      AND bias_tolerance_pct >= 0 AND bias_tolerance_pct <= 100
      AND max_adjustment_pct > 0 AND max_adjustment_pct <= 25
      AND onboarding_completion_pct >= 0 AND onboarding_completion_pct <= 100
    );
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_tenant_settings_pct_ranges skipped: %', SQLERRM;
END $$;

-- 12.20 MT-003: automatic application of a price adjustment is never allowed.
DO $$
BEGIN
  ALTER TABLE tenant_settings
    ADD CONSTRAINT ck_tenant_settings_no_auto_apply
    CHECK (auto_apply_adjustments = false);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_tenant_settings_no_auto_apply skipped: %', SQLERRM;
END $$;

-- 12.21 Analytics snapshot type domain
DO $$
BEGIN
  ALTER TABLE analytics_snapshots
    ADD CONSTRAINT ck_analytics_snapshots_type_domain
    CHECK (snapshot_type IN (
      'pipeline', 'revenue_forecast', 'profit_health', 'field_progress',
      'subcontractor_leaderboard'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_analytics_snapshots_type_domain skipped: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 13. DATABASE-LEVEL GUARDS
-- ─────────────────────────────────────────────────────────────────────

-- 13.1 PA-002 (hard guard): `applied` is only reachable from `approved`, and an applied
--      adjustment can only move to `rolled_back`. Enforced in the database because this is
--      the single rule that keeps the learning layer from repricing the company by itself.
CREATE OR REPLACE FUNCTION structr_guard_price_adjustment_transition()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'applied' AND OLD.status <> 'approved' THEN
      RAISE EXCEPTION 'ADJUSTMENT_NOT_APPROVED: price adjustment % cannot go from % to applied. Human approval is mandatory.', OLD.id, OLD.status;
    END IF;

    IF OLD.status = 'applied' AND NEW.status <> 'rolled_back' THEN
      RAISE EXCEPTION 'ADJUSTMENT_LOCKED: applied adjustment % can only be rolled back.', OLD.id;
    END IF;

    IF OLD.status IN ('rejected', 'rolled_back', 'expired') THEN
      RAISE EXCEPTION 'ADJUSTMENT_TERMINAL: adjustment % is % and cannot change. Propose a new one.', OLD.id, OLD.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_guard_price_adjustment_transition ON price_adjustments;
  CREATE TRIGGER trg_guard_price_adjustment_transition
    BEFORE UPDATE ON price_adjustments
    FOR EACH ROW EXECUTE FUNCTION structr_guard_price_adjustment_transition();
EXCEPTION WHEN others THEN
  RAISE NOTICE 'trg_guard_price_adjustment_transition skipped: %', SQLERRM;
END $$;

-- 13.2 AU-002: the audit trail is append-only. No update, no delete, ever.
CREATE OR REPLACE FUNCTION structr_guard_audit_log_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_APPEND_ONLY: audit_log rows cannot be % — the trail is evidence.', lower(TG_OP);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_guard_audit_log_append_only ON audit_log;
  CREATE TRIGGER trg_guard_audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION structr_guard_audit_log_append_only();
EXCEPTION WHEN others THEN
  RAISE NOTICE 'trg_guard_audit_log_append_only skipped: %', SQLERRM;
END $$;

-- 13.3 CL-006: a calibration event that has been actioned cannot be silently rewritten.
CREATE OR REPLACE FUNCTION structr_guard_calibration_event_actioned()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'actioned' AND NEW.status NOT IN ('actioned', 'superseded') THEN
    RAISE EXCEPTION 'CALIBRATION_ACTIONED: event % already produced an adjustment and can only be superseded.', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_guard_calibration_event_actioned ON calibration_events;
  CREATE TRIGGER trg_guard_calibration_event_actioned
    BEFORE UPDATE ON calibration_events
    FOR EACH ROW EXECUTE FUNCTION structr_guard_calibration_event_actioned();
EXCEPTION WHEN others THEN
  RAISE NOTICE 'trg_guard_calibration_event_actioned skipped: %', SQLERRM;
END $$;

-- 13.4 MT-001: mandatory feature flags cannot be removed from a tenant.
CREATE OR REPLACE FUNCTION structr_guard_mandatory_feature_flags()
RETURNS trigger AS $$
DECLARE
  flags jsonb;
BEGIN
  flags := COALESCE(NEW.feature_flags, '[]'::jsonb);

  IF NOT (flags ? 'profit_shield') THEN
    RAISE EXCEPTION 'MANDATORY_FLAG_REMOVED: profit_shield cannot be disabled for tenant %.', NEW.tenant_id;
  END IF;

  IF NOT (flags ? 'audit_trail') THEN
    RAISE EXCEPTION 'MANDATORY_FLAG_REMOVED: audit_trail cannot be disabled for tenant %.', NEW.tenant_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_guard_mandatory_feature_flags ON tenant_settings;
  CREATE TRIGGER trg_guard_mandatory_feature_flags
    BEFORE UPDATE ON tenant_settings
    FOR EACH ROW
    WHEN (NEW.feature_flags IS DISTINCT FROM OLD.feature_flags)
    EXECUTE FUNCTION structr_guard_mandatory_feature_flags();
EXCEPTION WHEN others THEN
  RAISE NOTICE 'trg_guard_mandatory_feature_flags skipped: %', SQLERRM;
END $$;

-- 13.5 Keep updated_at honest on every Phase 4 table (reuses the 0003 function).
CREATE OR REPLACE FUNCTION structr_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_settings', 'calibration_events', 'calibration_reports', 'price_adjustments',
    'scope_completeness_scores', 'scope_checklist_patterns', 'analytics_snapshots'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_updated_at ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION structr_touch_updated_at()',
      t
    );
  END LOOP;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'trg_touch_updated_at skipped: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 14. BACKFILL
-- ─────────────────────────────────────────────────────────────────────

-- 14.1 Every existing tenant receives a settings row with the default flag set.
--      The GCHI tenant keeps the coastal defaults documented in the dossier (§3.1).
INSERT INTO tenant_settings (
  tenant_id, geo_region, default_geo_risk_class, feature_flags, onboarding_status,
  onboarding_completion_pct, brand_name, brand_legal_name
)
SELECT
  t.id,
  COALESCE(t.region, 'charleston_sc'),
  'coastal',
  '["lead_intake","previsit","pricing_engine","profit_shield","scope_builder","geo_intelligence","estimate_versioning","jobtread_export","field_operations","actuals_ledger","subcontractor_management","daily_logs","closeout","calibration","price_adjustments","analytics","audit_trail"]'::jsonb,
  'active',
  100,
  t.name,
  COALESCE(t.legal_name, t.name)
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM tenant_settings ts WHERE ts.tenant_id = t.id);

-- 14.2 Existing geo zones belong to the default tenant, so a second GC starts empty
--      instead of inheriting Charleston zones it never validated.
UPDATE geo_zones
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'gchi' LIMIT 1)
WHERE tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM tenants WHERE slug = 'gchi');

-- 14.3 Tenants already operating are marked active.
UPDATE tenants
SET onboarding_status = 'active', activated_at = COALESCE(activated_at, created_at)
WHERE onboarding_status IS NULL OR onboarding_status = 'not_started';
