-- ═══════════════════════════════════════════════════════════════════════════════
-- structr.ai — MIGRATION 0003: PHASE 3 (field execution + real cost actuals)
--
-- Contract: docs/phase3-contract.md
-- Depends on: 0001 (tenant/identity) and 0002 (previsit/estimate versioning)
--
-- Scope:
--   1. subcontractors           — tenant-level trade partners + compliance + performance
--   2. field_tasks              — execution unit bound to project + approved estimate
--   3. field_task_events        — append-only transition history
--   4. project_cost_actuals     — real cost ledger in INTEGER CENTS
--   5. daily_logs               — one field report per project per day
--   6. project_closeouts        — closeout checklist + final variance snapshot
--   7. projects                 — Phase 3 execution columns (threshold, committed cost)
--
-- IDEMPOTENT: safe to re-run. Every DDL uses IF NOT EXISTS or a DO block that
-- swallows duplicate_object / duplicate_table, exactly like 0001 and 0002.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. SUBCONTRACTORS
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subcontractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  name text NOT NULL,
  name_normalized text NOT NULL,
  trade text NOT NULL,
  company_type text,
  contact_name text,
  contact_email text,
  contact_phone text,
  address text,
  city text,
  state text DEFAULT 'SC',
  zip text,
  license_number text,
  license_expiry date,
  insurance_carrier text,
  insurance_policy_number text,
  insurance_expiry date,
  insurance_coverage_cents integer,
  workers_comp_expiry date,
  w9_on_file boolean NOT NULL DEFAULT false,
  compliance_state text NOT NULL DEFAULT 'missing',
  rating numeric,
  on_time_pct numeric,
  quality_score numeric,
  cost_variance_avg_pct numeric,
  derived_rating numeric,
  completed_task_count integer NOT NULL DEFAULT 0,
  committed_cost_cents integer NOT NULL DEFAULT 0,
  performance_computed_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 2. FIELD TASKS
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS field_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  project_id uuid NOT NULL,
  budget_estimate_draft_id uuid,
  change_order_id uuid,
  source_key text,
  source text NOT NULL DEFAULT 'manual',
  task_type text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending',
  sequence integer NOT NULL DEFAULT 0,
  cost_code_id uuid,
  cost_code text,
  assembly_id uuid,
  estimate_item_id uuid,
  quantity numeric,
  unit text,
  budgeted_cost_cents integer,
  assignee_type text,
  subcontractor_id uuid,
  assignee_name text,
  assigned_user_id uuid,
  assigned_at timestamptz,
  assigned_by uuid,
  planned_start_date date,
  planned_end_date date,
  actual_start_date date,
  actual_end_date date,
  planned_hours numeric,
  actual_hours numeric,
  verified_by uuid,
  verified_at timestamptz,
  verification_notes text,
  block_reason text,
  blocked_at timestamptz,
  rework_count integer NOT NULL DEFAULT 0,
  photos_count integer NOT NULL DEFAULT 0,
  requires_inspection boolean NOT NULL DEFAULT false,
  inspection_passed boolean,
  notes text,
  metadata jsonb,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 3. FIELD TASK EVENTS (append-only transition history)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS field_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  project_id uuid NOT NULL,
  field_task_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  reason text,
  actor_id uuid,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 4. PROJECT COST ACTUALS (integer cents ledger)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_cost_actuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  project_id uuid NOT NULL,
  budget_estimate_draft_id uuid,
  change_order_id uuid,
  field_task_id uuid,
  estimate_item_id uuid,
  assembly_id uuid,
  cost_code_id uuid,
  cost_code text,
  cost_code_name text,
  category text NOT NULL DEFAULT 'other',
  description text,
  amount_cents integer NOT NULL,
  estimated_amount_cents integer,
  variance_cents integer,
  variance_pct numeric,
  variance_severity text,
  quantity numeric,
  unit text,
  labor_hours numeric,
  vendor_name text,
  subcontractor_id uuid,
  invoice_ref text,
  invoice_date date,
  date_incurred date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  approved_by uuid,
  approved_at timestamptz,
  paid_by uuid,
  paid_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  void_reason text,
  variance_reviewed boolean NOT NULL DEFAULT false,
  variance_reviewed_by uuid,
  variance_reviewed_at timestamptz,
  variance_reason text,
  receipt_url text,
  notes text,
  metadata jsonb,
  recorded_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 5. DAILY LOGS
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  project_id uuid NOT NULL,
  log_date date NOT NULL,
  weather text,
  temperature_f integer,
  weather_delay boolean NOT NULL DEFAULT false,
  crew_count integer NOT NULL DEFAULT 0,
  subcontractors_on_site jsonb,
  work_performed text,
  issues text,
  delays text,
  delay_hours numeric,
  materials_delivered text,
  visitors text,
  inspections_today text,
  photos_count integer NOT NULL DEFAULT 0,
  photo_urls jsonb,
  safety_incidents integer NOT NULL DEFAULT 0,
  safety_incident_details text,
  safety_incident_resolved boolean NOT NULL DEFAULT false,
  labor_hours_total numeric,
  gps_latitude numeric,
  gps_longitude numeric,
  notes text,
  metadata jsonb,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 6. PROJECT CLOSEOUTS
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_closeouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  project_id uuid NOT NULL,
  budget_estimate_draft_id uuid,
  status text NOT NULL DEFAULT 'open',
  final_inspection_passed boolean NOT NULL DEFAULT false,
  final_inspection_date date,
  final_inspection_by uuid,
  punch_list_complete boolean NOT NULL DEFAULT false,
  punch_list_item_count integer NOT NULL DEFAULT 0,
  lien_waivers_collected boolean NOT NULL DEFAULT false,
  lien_waiver_count integer NOT NULL DEFAULT 0,
  final_payment_received boolean NOT NULL DEFAULT false,
  final_payment_cents integer,
  final_payment_date date,
  warranty_docs_delivered boolean NOT NULL DEFAULT false,
  warranty_docs_ref text,
  warranty_expiry date,
  client_satisfaction_score integer,
  client_feedback text,
  checklist_completion_pct numeric,
  baseline_estimated_cents integer,
  change_order_estimated_cents integer,
  total_estimated_cents integer,
  baseline_actual_cents integer,
  change_order_actual_cents integer,
  total_actual_cents integer,
  final_variance_cents integer,
  final_variance_pct numeric,
  final_variance_severity text,
  approved_sell_price_cents integer,
  realized_gross_profit_cents integer,
  realized_gross_profit_pct numeric,
  variance_report jsonb,
  variance_threshold_pct numeric,
  blockers jsonb,
  lessons_learned text,
  notes text,
  opened_by uuid,
  opened_at timestamptz,
  ready_at timestamptz,
  closed_by uuid,
  closed_at timestamptz,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 7. PROJECTS — Phase 3 execution columns
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE projects ADD COLUMN IF NOT EXISTS variance_threshold_pct numeric DEFAULT 10;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS committed_cost_cents integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS approved_budget_cents integer;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS change_order_budget_cents integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS field_started_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS field_completed_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────
-- 8. FOREIGN KEYS
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  ALTER TABLE subcontractors
    ADD CONSTRAINT fk_subcontractors_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_subcontractors_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT fk_field_tasks_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_field_tasks_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT fk_field_tasks_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_field_tasks_project skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT fk_field_tasks_budget_estimate
    FOREIGN KEY (budget_estimate_draft_id) REFERENCES estimate_drafts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_field_tasks_budget_estimate skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT fk_field_tasks_change_order
    FOREIGN KEY (change_order_id) REFERENCES estimate_drafts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_field_tasks_change_order skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT fk_field_tasks_subcontractor
    FOREIGN KEY (subcontractor_id) REFERENCES subcontractors(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_field_tasks_subcontractor skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT fk_field_tasks_cost_code
    FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_field_tasks_cost_code skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT fk_field_tasks_assembly
    FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_field_tasks_assembly skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT fk_field_tasks_estimate_item
    FOREIGN KEY (estimate_item_id) REFERENCES estimate_items(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_field_tasks_estimate_item skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE field_task_events
    ADD CONSTRAINT fk_field_task_events_task
    FOREIGN KEY (field_task_id) REFERENCES field_tasks(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_field_task_events_task skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE field_task_events
    ADD CONSTRAINT fk_field_task_events_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_field_task_events_project skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT fk_pca_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_pca_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT fk_pca_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_pca_project skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT fk_pca_budget_estimate
    FOREIGN KEY (budget_estimate_draft_id) REFERENCES estimate_drafts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_pca_budget_estimate skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT fk_pca_change_order
    FOREIGN KEY (change_order_id) REFERENCES estimate_drafts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_pca_change_order skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT fk_pca_field_task
    FOREIGN KEY (field_task_id) REFERENCES field_tasks(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_pca_field_task skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT fk_pca_estimate_item
    FOREIGN KEY (estimate_item_id) REFERENCES estimate_items(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_pca_estimate_item skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT fk_pca_assembly
    FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_pca_assembly skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT fk_pca_cost_code
    FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_pca_cost_code skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT fk_pca_subcontractor
    FOREIGN KEY (subcontractor_id) REFERENCES subcontractors(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_pca_subcontractor skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE daily_logs
    ADD CONSTRAINT fk_daily_logs_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_daily_logs_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE daily_logs
    ADD CONSTRAINT fk_daily_logs_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_daily_logs_project skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE project_closeouts
    ADD CONSTRAINT fk_project_closeouts_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_project_closeouts_tenant skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE project_closeouts
    ADD CONSTRAINT fk_project_closeouts_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_project_closeouts_project skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE project_closeouts
    ADD CONSTRAINT fk_project_closeouts_budget_estimate
    FOREIGN KEY (budget_estimate_draft_id) REFERENCES estimate_drafts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'fk_project_closeouts_budget_estimate skipped: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 9. INDEXES
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_subcontractors_tenant ON subcontractors (tenant_id);
CREATE INDEX IF NOT EXISTS idx_subcontractors_trade ON subcontractors (trade);
CREATE INDEX IF NOT EXISTS idx_subcontractors_status ON subcontractors (status);
CREATE INDEX IF NOT EXISTS idx_subcontractors_insurance_expiry ON subcontractors (insurance_expiry);
CREATE INDEX IF NOT EXISTS idx_subcontractors_license_expiry ON subcontractors (license_expiry);
CREATE UNIQUE INDEX IF NOT EXISTS uq_subcontractors_tenant_name_trade
  ON subcontractors (tenant_id, name_normalized, trade);

CREATE INDEX IF NOT EXISTS idx_field_tasks_tenant ON field_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_field_tasks_project ON field_tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_field_tasks_status ON field_tasks (status);
CREATE INDEX IF NOT EXISTS idx_field_tasks_project_status ON field_tasks (project_id, status);
CREATE INDEX IF NOT EXISTS idx_field_tasks_type ON field_tasks (task_type);
CREATE INDEX IF NOT EXISTS idx_field_tasks_subcontractor ON field_tasks (subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_field_tasks_budget_estimate ON field_tasks (budget_estimate_draft_id);
CREATE INDEX IF NOT EXISTS idx_field_tasks_change_order ON field_tasks (change_order_id);
CREATE INDEX IF NOT EXISTS idx_field_tasks_planned_end ON field_tasks (planned_end_date);
-- Idempotency of change-order derived tasks (§7): one task per (project, source_key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_field_tasks_source_key
  ON field_tasks (project_id, source_key) WHERE source_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_field_task_events_task ON field_task_events (field_task_id);
CREATE INDEX IF NOT EXISTS idx_field_task_events_project ON field_task_events (project_id);
CREATE INDEX IF NOT EXISTS idx_field_task_events_created ON field_task_events (created_at);

CREATE INDEX IF NOT EXISTS idx_pca_tenant ON project_cost_actuals (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pca_project ON project_cost_actuals (project_id);
CREATE INDEX IF NOT EXISTS idx_pca_status ON project_cost_actuals (status);
CREATE INDEX IF NOT EXISTS idx_pca_project_status ON project_cost_actuals (project_id, status);
CREATE INDEX IF NOT EXISTS idx_pca_cost_code ON project_cost_actuals (cost_code_id);
CREATE INDEX IF NOT EXISTS idx_pca_cost_code_text ON project_cost_actuals (project_id, cost_code);
CREATE INDEX IF NOT EXISTS idx_pca_field_task ON project_cost_actuals (field_task_id);
CREATE INDEX IF NOT EXISTS idx_pca_subcontractor ON project_cost_actuals (subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_pca_budget_estimate ON project_cost_actuals (budget_estimate_draft_id);
CREATE INDEX IF NOT EXISTS idx_pca_change_order ON project_cost_actuals (change_order_id);
CREATE INDEX IF NOT EXISTS idx_pca_date_incurred ON project_cost_actuals (date_incurred);
CREATE INDEX IF NOT EXISTS idx_pca_severity ON project_cost_actuals (variance_severity);
-- One invoice reference per vendor per tenant (duplicate invoice guard)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pca_tenant_vendor_invoice
  ON project_cost_actuals (tenant_id, vendor_name, invoice_ref)
  WHERE invoice_ref IS NOT NULL AND vendor_name IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_daily_logs_tenant ON daily_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_project ON daily_logs (project_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs (log_date);
-- DL-001: one log per project per day
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_logs_project_date
  ON daily_logs (project_id, log_date);

CREATE INDEX IF NOT EXISTS idx_project_closeouts_tenant ON project_closeouts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_project_closeouts_status ON project_closeouts (status);
CREATE INDEX IF NOT EXISTS idx_project_closeouts_estimate ON project_closeouts (budget_estimate_draft_id);
-- One live closeout per project (a second one would create two versions of the truth)
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_closeouts_project_active
  ON project_closeouts (project_id) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 10. INTEGRITY CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────

-- 10.1 Field task status domain (FO-001)
DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT ck_field_tasks_status_domain
    CHECK (status IN (
      'pending', 'assigned', 'in_progress', 'completed', 'verified', 'blocked', 'cancelled'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_field_tasks_status_domain skipped: %', SQLERRM;
END $$;

-- 10.2 Field task source domain
DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT ck_field_tasks_source_domain
    CHECK (source IN ('estimate', 'change_order', 'manual', 'punch_list', 'inspection'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_field_tasks_source_domain skipped: %', SQLERRM;
END $$;

-- 10.3 Assignee type domain (FO-002)
DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT ck_field_tasks_assignee_type_domain
    CHECK (assignee_type IS NULL OR assignee_type IN ('subcontractor', 'crew', 'self_perform', 'vendor'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_field_tasks_assignee_type_domain skipped: %', SQLERRM;
END $$;

-- 10.4 An assigned task must have a responsible party (FO-002)
DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT ck_field_tasks_assigned_has_assignee
    CHECK (
      status NOT IN ('assigned', 'in_progress', 'completed', 'verified')
      OR assignee_type IS NOT NULL
    );
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_field_tasks_assigned_has_assignee skipped: %', SQLERRM;
END $$;

-- 10.5 A subcontractor assignment requires the subcontractor id (FO-002)
DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT ck_field_tasks_sub_assignment_has_id
    CHECK (assignee_type IS DISTINCT FROM 'subcontractor' OR subcontractor_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_field_tasks_sub_assignment_has_id skipped: %', SQLERRM;
END $$;

-- 10.6 A completed task must carry the actual end date (FO-003)
DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT ck_field_tasks_completed_has_end_date
    CHECK (status NOT IN ('completed', 'verified') OR actual_end_date IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_field_tasks_completed_has_end_date skipped: %', SQLERRM;
END $$;

-- 10.7 A blocked task must carry a reason (FO-005)
DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT ck_field_tasks_blocked_has_reason
    CHECK (status <> 'blocked' OR (block_reason IS NOT NULL AND length(btrim(block_reason)) >= 5));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_field_tasks_blocked_has_reason skipped: %', SQLERRM;
END $$;

-- 10.8 A verified task must record who verified it (FO-004)
DO $$
BEGIN
  ALTER TABLE field_tasks
    ADD CONSTRAINT ck_field_tasks_verified_has_verifier
    CHECK (status <> 'verified' OR verified_by IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_field_tasks_verified_has_verifier skipped: %', SQLERRM;
END $$;

-- 10.9 Actual status domain (AC-004)
DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT ck_pca_status_domain
    CHECK (status IN ('pending', 'approved', 'paid', 'rejected', 'void'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_pca_status_domain skipped: %', SQLERRM;
END $$;

-- 10.10 Actual cost category domain
DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT ck_pca_category_domain
    CHECK (category IN (
      'labor', 'materials', 'subcontractor', 'equipment_rental',
      'permits_fees', 'allowance', 'other'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_pca_category_domain skipped: %', SQLERRM;
END $$;

-- 10.11 Amount must be non-negative integer cents (AC-003)
DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT ck_pca_amount_non_negative
    CHECK (amount_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_pca_amount_non_negative skipped: %', SQLERRM;
END $$;

-- 10.12 An actual must carry a cost code (AC-002)
DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT ck_pca_cost_code_required
    CHECK (cost_code_id IS NOT NULL OR (cost_code IS NOT NULL AND length(btrim(cost_code)) > 0));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_pca_cost_code_required skipped: %', SQLERRM;
END $$;

-- 10.13 An actual must carry a payee (AC-005)
DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT ck_pca_payee_required
    CHECK (subcontractor_id IS NOT NULL OR (vendor_name IS NOT NULL AND length(btrim(vendor_name)) > 0));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_pca_payee_required skipped: %', SQLERRM;
END $$;

-- 10.14 A committed actual must have an approved estimate baseline (AC-001)
DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT ck_pca_committed_has_budget
    CHECK (
      status NOT IN ('approved', 'paid')
      OR budget_estimate_draft_id IS NOT NULL
      OR change_order_id IS NOT NULL
    );
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_pca_committed_has_budget skipped: %', SQLERRM;
END $$;

-- 10.15 Variance severity domain
DO $$
BEGIN
  ALTER TABLE project_cost_actuals
    ADD CONSTRAINT ck_pca_variance_severity_domain
    CHECK (variance_severity IS NULL OR variance_severity IN (
      'ok', 'under_budget', 'warning', 'critical', 'unbudgeted'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_pca_variance_severity_domain skipped: %', SQLERRM;
END $$;

-- 10.16 Subcontractor status and compliance domains
DO $$
BEGIN
  ALTER TABLE subcontractors
    ADD CONSTRAINT ck_subcontractors_status_domain
    CHECK (status IN ('active', 'probation', 'suspended', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_subcontractors_status_domain skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE subcontractors
    ADD CONSTRAINT ck_subcontractors_compliance_domain
    CHECK (compliance_state IN ('compliant', 'expiring', 'expired', 'missing'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_subcontractors_compliance_domain skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE subcontractors
    ADD CONSTRAINT ck_subcontractors_rating_range
    CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_subcontractors_rating_range skipped: %', SQLERRM;
END $$;

-- 10.17 Daily log sanity: crew count and incidents are never negative, and a reported
--       safety incident must be described (a number with no story is not a record).
DO $$
BEGIN
  ALTER TABLE daily_logs
    ADD CONSTRAINT ck_daily_logs_counts_non_negative
    CHECK (crew_count >= 0 AND photos_count >= 0 AND safety_incidents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_daily_logs_counts_non_negative skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE daily_logs
    ADD CONSTRAINT ck_daily_logs_incident_details
    CHECK (
      safety_incidents = 0
      OR (safety_incident_details IS NOT NULL AND length(btrim(safety_incident_details)) > 0)
    );
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_daily_logs_incident_details skipped: %', SQLERRM;
END $$;

-- 10.18 Closeout status domain and closing gates (CO-002, CO-003)
DO $$
BEGIN
  ALTER TABLE project_closeouts
    ADD CONSTRAINT ck_project_closeouts_status_domain
    CHECK (status IN ('blocked', 'open', 'in_progress', 'ready_to_close', 'closed'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_project_closeouts_status_domain skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE project_closeouts
    ADD CONSTRAINT ck_project_closeouts_satisfaction_range
    CHECK (client_satisfaction_score IS NULL OR (client_satisfaction_score >= 0 AND client_satisfaction_score <= 10));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_project_closeouts_satisfaction_range skipped: %', SQLERRM;
END $$;

-- A closed project must have the mandatory checklist satisfied (CO-002)
DO $$
BEGIN
  ALTER TABLE project_closeouts
    ADD CONSTRAINT ck_project_closeouts_closed_checklist
    CHECK (
      status <> 'closed'
      OR (
        final_inspection_passed = true
        AND punch_list_complete = true
        AND lien_waivers_collected = true
        AND final_payment_received = true
        AND warranty_docs_delivered = true
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_project_closeouts_closed_checklist skipped: %', SQLERRM;
END $$;

-- A closed project must have the final variance snapshot persisted (§8)
DO $$
BEGIN
  ALTER TABLE project_closeouts
    ADD CONSTRAINT ck_project_closeouts_closed_has_report
    CHECK (status <> 'closed' OR variance_report IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN
  RAISE NOTICE 'ck_project_closeouts_closed_has_report skipped: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 11. DB-LEVEL GUARDS (mirror the API rules so raw SQL cannot bypass them)
-- ─────────────────────────────────────────────────────────────────────

-- 11.1 A verified field task is terminal: no status may move away from it (FO-006).
CREATE OR REPLACE FUNCTION structr_guard_field_task_terminal()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('verified', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'FIELD_TASK_TERMINAL: task % is % and cannot change status. Create a new task instead.', OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_guard_field_task_terminal ON field_tasks;
  CREATE TRIGGER trg_guard_field_task_terminal
    BEFORE UPDATE ON field_tasks
    FOR EACH ROW EXECUTE FUNCTION structr_guard_field_task_terminal();
EXCEPTION WHEN others THEN
  RAISE NOTICE 'trg_guard_field_task_terminal skipped: %', SQLERRM;
END $$;

-- 11.2 A paid/rejected/void actual is immutable in its money (AC-004).
CREATE OR REPLACE FUNCTION structr_guard_actual_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('paid', 'rejected', 'void') THEN
    IF (NEW.amount_cents IS DISTINCT FROM OLD.amount_cents)
       OR (NEW.cost_code_id IS DISTINCT FROM OLD.cost_code_id)
       OR (NEW.cost_code IS DISTINCT FROM OLD.cost_code)
       OR (NEW.date_incurred IS DISTINCT FROM OLD.date_incurred)
       OR (NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'paid')
    THEN
      RAISE EXCEPTION 'ACTUAL_LOCKED: actual % is % and its cost facts are immutable. Record a correcting entry instead.', OLD.id, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_guard_actual_immutable ON project_cost_actuals;
  CREATE TRIGGER trg_guard_actual_immutable
    BEFORE UPDATE ON project_cost_actuals
    FOR EACH ROW EXECUTE FUNCTION structr_guard_actual_immutable();
EXCEPTION WHEN others THEN
  RAISE NOTICE 'trg_guard_actual_immutable skipped: %', SQLERRM;
END $$;

-- 11.3 A closed closeout is immutable (§8).
CREATE OR REPLACE FUNCTION structr_guard_closeout_closed()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'closed' AND NEW.status IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION 'CLOSEOUT_LOCKED: closeout % is closed and cannot be reopened.', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_guard_closeout_closed ON project_closeouts;
  CREATE TRIGGER trg_guard_closeout_closed
    BEFORE UPDATE ON project_closeouts
    FOR EACH ROW EXECUTE FUNCTION structr_guard_closeout_closed();
EXCEPTION WHEN others THEN
  RAISE NOTICE 'trg_guard_closeout_closed skipped: %', SQLERRM;
END $$;

-- 11.4 Keep updated_at honest on every Phase 3 table.
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
  FOREACH t IN ARRAY ARRAY['subcontractors', 'field_tasks', 'project_cost_actuals', 'daily_logs', 'project_closeouts']
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- END MIGRATION 0003
-- ═══════════════════════════════════════════════════════════════════════════════
