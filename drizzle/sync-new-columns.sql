-- STRUCTR-AI Schema Sync — New Columns (Phase 2 Audit)
-- Generated: 2026-03-30
-- Purpose: Add columns that exist in schema.ts but not yet in the database
-- Safe: Uses ADD COLUMN IF NOT EXISTS — idempotent, won't break existing data

-- assemblies
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS trade text;
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS finish_level text;
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS coastal_modifier numeric;

-- assembly_items
ALTER TABLE assembly_items ADD COLUMN IF NOT EXISTS price_book_item uuid;
ALTER TABLE assembly_items ADD COLUMN IF NOT EXISTS component_type text;
ALTER TABLE assembly_items ADD COLUMN IF NOT EXISTS unit_cost_override numeric;

-- assembly_performance_metrics
ALTER TABLE assembly_performance_metrics ADD COLUMN IF NOT EXISTS assembly_name text;
ALTER TABLE assembly_performance_metrics ADD COLUMN IF NOT EXISTS avg_variance_pct numeric;
ALTER TABLE assembly_performance_metrics ADD COLUMN IF NOT EXISTS overrun_count integer DEFAULT 0;
ALTER TABLE assembly_performance_metrics ADD COLUMN IF NOT EXISTS underrun_count integer DEFAULT 0;

-- clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- deal_activities
ALTER TABLE deal_activities ADD COLUMN IF NOT EXISTS performed_by uuid;

-- deal_stage_history
ALTER TABLE deal_stage_history ADD COLUMN IF NOT EXISTS changed_by uuid;

-- estimate_drafts
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS bundle_name text;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS zone text;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS finish_level text;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS trade text;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS pricing_schema_version text;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS coastal_modifier numeric;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS subtotal_price numeric;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS subtotal_cost numeric;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS final_total_price numeric;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS discount_applied boolean DEFAULT false;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS discount_amount numeric;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS gross_profit numeric;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS gross_profit_pct numeric;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS profit_shield_passed boolean;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS profit_shield_min_pct numeric;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS assembly_selections jsonb;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS line_items jsonb;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS intake_form_id uuid;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS warnings_json jsonb;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS scope_draft_id uuid;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS bundle_id uuid;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS client_id uuid;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS assembly_count integer;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS rejected_by uuid;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE estimate_drafts ADD COLUMN IF NOT EXISTS rejection_reason text;

-- geo_zones
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS zone_name text;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS county text;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS zip_codes text[];
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS center_lat double precision;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS center_lng double precision;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS radius_miles numeric;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS coastal_exposure_level text;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS labor_modifier numeric;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS material_modifier numeric;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS logistics_modifier numeric;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS logistics_complexity text;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS contingency_pct numeric;
ALTER TABLE geo_zones ADD COLUMN IF NOT EXISTS min_profit_shield_pct numeric;

-- geographic_overrides
ALTER TABLE geographic_overrides ADD COLUMN IF NOT EXISTS zone text;
ALTER TABLE geographic_overrides ADD COLUMN IF NOT EXISTS trade text;
ALTER TABLE geographic_overrides ADD COLUMN IF NOT EXISTS finish_level text;
ALTER TABLE geographic_overrides ADD COLUMN IF NOT EXISTS reason_template text;
ALTER TABLE geographic_overrides ADD COLUMN IF NOT EXISTS original_assembly_id uuid;
ALTER TABLE geographic_overrides ADD COLUMN IF NOT EXISTS replacement_assembly_id uuid;

-- pipeline_partial_drafts
ALTER TABLE pipeline_partial_drafts ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE pipeline_partial_drafts ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;
ALTER TABLE pipeline_partial_drafts ADD COLUMN IF NOT EXISTS max_retries integer DEFAULT 3;
ALTER TABLE pipeline_partial_drafts ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE pipeline_partial_drafts ADD COLUMN IF NOT EXISTS recovered_estimate_id uuid;
ALTER TABLE pipeline_partial_drafts ADD COLUMN IF NOT EXISTS recovered_at timestamptz;

-- project_actuals
ALTER TABLE project_actuals ADD COLUMN IF NOT EXISTS cost_code_id uuid;
ALTER TABLE project_actuals ADD COLUMN IF NOT EXISTS variance_pct numeric;
ALTER TABLE project_actuals ADD COLUMN IF NOT EXISTS is_high_variance boolean DEFAULT false;

-- projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS county text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS zone text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS finish_level text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pricing_schema_version text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS zone_modifier_snapshot jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS geocode_confidence text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS geocode_source text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS geocoded_address text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- remodel_templates
ALTER TABLE remodel_templates ADD COLUMN IF NOT EXISTS service_type text;

-- scope_draft_items
ALTER TABLE scope_draft_items ADD COLUMN IF NOT EXISTS assembly_name text;
ALTER TABLE scope_draft_items ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE scope_draft_items ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE scope_draft_items ADD COLUMN IF NOT EXISTS confidence numeric;
ALTER TABLE scope_draft_items ADD COLUMN IF NOT EXISTS override_type text;

-- scope_drafts
ALTER TABLE scope_drafts ADD COLUMN IF NOT EXISTS zone text;
ALTER TABLE scope_drafts ADD COLUMN IF NOT EXISTS finish_level text;
ALTER TABLE scope_drafts ADD COLUMN IF NOT EXISTS service_type text;
ALTER TABLE scope_drafts ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE scope_drafts ADD COLUMN IF NOT EXISTS confidence numeric;
ALTER TABLE scope_drafts ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE scope_drafts ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE scope_drafts ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;
ALTER TABLE scope_drafts ADD COLUMN IF NOT EXISTS warnings_json jsonb;
ALTER TABLE scope_drafts ADD COLUMN IF NOT EXISTS intake_form_id uuid;

-- scope_override_log
ALTER TABLE scope_override_log ADD COLUMN IF NOT EXISTS override_type text;

-- scope_review_deltas
ALTER TABLE scope_review_deltas ADD COLUMN IF NOT EXISTS action_type text;
ALTER TABLE scope_review_deltas ADD COLUMN IF NOT EXISTS new_quantity numeric;
ALTER TABLE scope_review_deltas ADD COLUMN IF NOT EXISTS previous_quantity numeric;
ALTER TABLE scope_review_deltas ADD COLUMN IF NOT EXISTS operator_reason text;
ALTER TABLE scope_review_deltas ADD COLUMN IF NOT EXISTS created_by uuid;

-- scope_review_snapshots
ALTER TABLE scope_review_snapshots ADD COLUMN IF NOT EXISTS approved_items jsonb;
ALTER TABLE scope_review_snapshots ADD COLUMN IF NOT EXISTS bundle_id uuid;
ALTER TABLE scope_review_snapshots ADD COLUMN IF NOT EXISTS delta_changes jsonb;

-- scope_rules
ALTER TABLE scope_rules ADD COLUMN IF NOT EXISTS rule_code text;
ALTER TABLE scope_rules ADD COLUMN IF NOT EXISTS assembly_id uuid;
ALTER TABLE scope_rules ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE scope_rules ADD COLUMN IF NOT EXISTS finish_level text;
ALTER TABLE scope_rules ADD COLUMN IF NOT EXISTS zone text;
ALTER TABLE scope_rules ADD COLUMN IF NOT EXISTS service_type text;
ALTER TABLE scope_rules ADD COLUMN IF NOT EXISTS project_type text;
ALTER TABLE scope_rules ADD COLUMN IF NOT EXISTS reason_template text;
ALTER TABLE scope_rules ADD COLUMN IF NOT EXISTS quantity_formula jsonb;
ALTER TABLE scope_rules ADD COLUMN IF NOT EXISTS condition_json jsonb;
