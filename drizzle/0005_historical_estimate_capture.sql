-- H1 historical capture, V2 + V2.1. Additive; no legacy ownership assignment.
-- Apply only after reconciling the existing schema in an isolated database.
CREATE UNIQUE INDEX uq_clients_tenant_identity ON clients (tenant_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_projects_historical_identity ON projects (tenant_id, id, client_id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_estimate_drafts_historical_identity ON estimate_drafts (tenant_id, project_id, client_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_profiles_tenant_identity ON profiles (tenant_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_project_files_historical_identity ON project_files (tenant_id, project_id, id);
--> statement-breakpoint
CREATE TABLE historical_estimate_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  client_id uuid NOT NULL,
  request_id uuid NOT NULL,
  recorded_by uuid NOT NULL,
  request_hash text NOT NULL,
  content_hash text NOT NULL,
  contract_version text NOT NULL,
  source_kind text NOT NULL,
  source_label text NOT NULL,
  source_file_id uuid,
  currency_code text,
  declared_subtotal_minor numeric(20,0),
  declared_discount_minor numeric(20,0),
  declared_tax_minor numeric(20,0),
  declared_total_minor numeric(20,0),
  declared_estimated_cost_minor numeric(20,0),
  commercial_terms_text text,
  raw_totals jsonb NOT NULL,
  expected_line_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT hes_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT hes_client_fk FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT hes_project_fk FOREIGN KEY (tenant_id, project_id, client_id) REFERENCES projects (tenant_id, id, client_id) ON DELETE RESTRICT,
  CONSTRAINT hes_actor_fk FOREIGN KEY (tenant_id, recorded_by) REFERENCES profiles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT hes_file_fk FOREIGN KEY (tenant_id, project_id, source_file_id) REFERENCES project_files (tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT hes_hashes CHECK (request_hash ~ '^[0-9a-f]{64}$' AND content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hes_contract CHECK (contract_version = 'historical-source-v1'),
  CONSTRAINT hes_kind CHECK (source_kind IN ('manual_transcription','file_extract')),
  CONSTRAINT hes_file_extract CHECK (source_kind <> 'file_extract' OR source_file_id IS NOT NULL),
  CONSTRAINT hes_currency CHECK (currency_code IS NULL OR currency_code = 'USD'),
  CONSTRAINT hes_currency_money CHECK (currency_code IS NOT NULL OR (declared_subtotal_minor IS NULL AND declared_discount_minor IS NULL AND declared_tax_minor IS NULL AND declared_total_minor IS NULL AND declared_estimated_cost_minor IS NULL)),
  CONSTRAINT hes_money CHECK ((declared_subtotal_minor IS NULL OR (declared_subtotal_minor >= 0 AND declared_subtotal_minor <= 99999999999999999999)) AND (declared_discount_minor IS NULL OR (declared_discount_minor >= 0 AND declared_discount_minor <= 99999999999999999999)) AND (declared_tax_minor IS NULL OR (declared_tax_minor >= 0 AND declared_tax_minor <= 99999999999999999999)) AND (declared_total_minor IS NULL OR (declared_total_minor >= 0 AND declared_total_minor <= 99999999999999999999)) AND (declared_estimated_cost_minor IS NULL OR (declared_estimated_cost_minor >= 0 AND declared_estimated_cost_minor <= 99999999999999999999))),
  CONSTRAINT hes_label CHECK (length(source_label) BETWEEN 1 AND 255),
  CONSTRAINT hes_terms CHECK (commercial_terms_text IS NULL OR length(commercial_terms_text) <= 5000),
  CONSTRAINT hes_count CHECK (expected_line_count BETWEEN 1 AND 1000),
  CONSTRAINT hes_raw CHECK (jsonb_typeof(raw_totals) = 'object' AND raw_totals ?& ARRAY['version','subtotal','discount','tax','total','estimatedCost'] AND raw_totals - ARRAY['version','subtotal','discount','tax','total','estimatedCost'] = '{}'::jsonb AND raw_totals->>'version' IS NOT DISTINCT FROM 'historical-raw-totals-v1' AND jsonb_typeof(raw_totals->'subtotal') IN ('null','string') AND (raw_totals->>'subtotal' IS NULL OR length(raw_totals->>'subtotal') <= 256) AND jsonb_typeof(raw_totals->'discount') IN ('null','string') AND (raw_totals->>'discount' IS NULL OR length(raw_totals->>'discount') <= 256) AND jsonb_typeof(raw_totals->'tax') IN ('null','string') AND (raw_totals->>'tax' IS NULL OR length(raw_totals->>'tax') <= 256) AND jsonb_typeof(raw_totals->'total') IN ('null','string') AND (raw_totals->>'total' IS NULL OR length(raw_totals->>'total') <= 256) AND jsonb_typeof(raw_totals->'estimatedCost') IN ('null','string') AND (raw_totals->>'estimatedCost' IS NULL OR length(raw_totals->>'estimatedCost') <= 256)),
  CONSTRAINT uq_hes_request UNIQUE (tenant_id, request_id),
  CONSTRAINT uq_hes_content UNIQUE (tenant_id, project_id, client_id, contract_version, content_hash),
  CONSTRAINT uq_hes_context UNIQUE (tenant_id, project_id, client_id, id),
  CONSTRAINT uq_hes_identity UNIQUE (tenant_id, id)
);
--> statement-breakpoint
CREATE INDEX idx_hes_project_date ON historical_estimate_sources (tenant_id, project_id, created_at, id);
--> statement-breakpoint
CREATE INDEX idx_hes_client ON historical_estimate_sources (tenant_id, client_id);
--> statement-breakpoint
CREATE INDEX idx_hes_actor ON historical_estimate_sources (tenant_id, recorded_by);
--> statement-breakpoint
CREATE INDEX idx_hes_file ON historical_estimate_sources (tenant_id, project_id, source_file_id);
--> statement-breakpoint
CREATE TABLE historical_estimate_source_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_line_key text NOT NULL,
  ordinal integer NOT NULL,
  description text,
  quantity numeric(20,6),
  unit text,
  unit_price numeric(20,6),
  unit_estimated_cost numeric(20,6),
  line_price_minor numeric(20,0),
  line_estimated_cost_minor numeric(20,0),
  external_code_system text,
  external_code text,
  taxable boolean,
  raw_values jsonb NOT NULL,
  line_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT hesl_source_fk FOREIGN KEY (tenant_id, source_id) REFERENCES historical_estimate_sources (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT hesl_ordinal CHECK (ordinal >= 0),
  CONSTRAINT hesl_key CHECK (length(source_line_key) BETWEEN 1 AND 128),
  CONSTRAINT hesl_description CHECK (description IS NULL OR length(description) <= 5000),
  CONSTRAINT hesl_labels CHECK ((unit IS NULL OR length(unit) <= 128) AND (external_code IS NULL OR length(external_code) <= 128) AND (external_code_system IS NULL OR length(external_code_system) <= 128)),
  CONSTRAINT hesl_money CHECK ((line_price_minor IS NULL OR (line_price_minor >= 0 AND line_price_minor <= 99999999999999999999)) AND (line_estimated_cost_minor IS NULL OR (line_estimated_cost_minor >= 0 AND line_estimated_cost_minor <= 99999999999999999999))),
  CONSTRAINT hesl_decimals CHECK ((quantity IS NULL OR (quantity >= 0 AND quantity <= 99999999999999.999999)) AND (unit_price IS NULL OR (unit_price >= 0 AND unit_price <= 99999999999999.999999)) AND (unit_estimated_cost IS NULL OR (unit_estimated_cost >= 0 AND unit_estimated_cost <= 99999999999999.999999))),
  CONSTRAINT hesl_hash CHECK (line_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hesl_raw CHECK (jsonb_typeof(raw_values) = 'object' AND raw_values ?& ARRAY['version','quantity','unitPrice','unitEstimatedCost','linePrice','lineEstimatedCost','taxable','externalCode'] AND raw_values - ARRAY['version','quantity','unitPrice','unitEstimatedCost','linePrice','lineEstimatedCost','taxable','externalCode'] = '{}'::jsonb AND raw_values->>'version' IS NOT DISTINCT FROM 'historical-raw-line-v1' AND jsonb_typeof(raw_values->'quantity') IN ('null','string') AND (raw_values->>'quantity' IS NULL OR length(raw_values->>'quantity') <= 256) AND jsonb_typeof(raw_values->'unitPrice') IN ('null','string') AND (raw_values->>'unitPrice' IS NULL OR length(raw_values->>'unitPrice') <= 256) AND jsonb_typeof(raw_values->'unitEstimatedCost') IN ('null','string') AND (raw_values->>'unitEstimatedCost' IS NULL OR length(raw_values->>'unitEstimatedCost') <= 256) AND jsonb_typeof(raw_values->'linePrice') IN ('null','string') AND (raw_values->>'linePrice' IS NULL OR length(raw_values->>'linePrice') <= 256) AND jsonb_typeof(raw_values->'lineEstimatedCost') IN ('null','string') AND (raw_values->>'lineEstimatedCost' IS NULL OR length(raw_values->>'lineEstimatedCost') <= 256) AND jsonb_typeof(raw_values->'taxable') IN ('null','string') AND (raw_values->>'taxable' IS NULL OR length(raw_values->>'taxable') <= 256) AND jsonb_typeof(raw_values->'externalCode') IN ('null','string') AND (raw_values->>'externalCode' IS NULL OR length(raw_values->>'externalCode') <= 256)),
  CONSTRAINT uq_hesl_key UNIQUE (tenant_id, source_id, source_line_key),
  CONSTRAINT uq_hesl_ordinal UNIQUE (tenant_id, source_id, ordinal),
  CONSTRAINT uq_hesl_identity UNIQUE (tenant_id, source_id, id)
);
--> statement-breakpoint
-- Pure JSON validation also closes nested findings. No permissions or approval
-- instructions can be introduced by adding fields to an immutable report.
CREATE FUNCTION public.historical_estimate_valid_reconciliation(report jsonb, stored_state text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
DECLARE
  finding jsonb;
  money_key text;
BEGIN
  IF jsonb_typeof(report) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT (report ?& ARRAY['version','state','sumPriceMinor','sumCostMinor','findings'])
    OR report - ARRAY['version','state','sumPriceMinor','sumCostMinor','findings'] <> '{}'::jsonb
    OR report->>'version' IS DISTINCT FROM 'historical-reconciliation-v1'
    OR report->>'state' IS DISTINCT FROM stored_state
    OR stored_state NOT IN ('unresolved','matched','mismatch')
  THEN RETURN false; END IF;
  FOREACH money_key IN ARRAY ARRAY['sumPriceMinor','sumCostMinor'] LOOP
    IF report->money_key <> 'null'::jsonb AND
      (jsonb_typeof(report->money_key) IS DISTINCT FROM 'string'
       OR (report->>money_key) !~ '^(0|[1-9][0-9]{0,19})$')
    THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_typeof(report->'findings') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(report->'findings') > 4002 THEN RETURN false; END IF;
  FOR finding IN SELECT value FROM jsonb_array_elements(report->'findings') LOOP
    IF jsonb_typeof(finding) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF NOT (finding ?& ARRAY['code','field'])
      OR finding - ARRAY['code','field','sourceLineKey','expectedMinor','actualMinor'] <> '{}'::jsonb
      OR jsonb_typeof(finding->'code') IS DISTINCT FROM 'string'
      OR finding->>'code' NOT IN ('unknown_currency','missing_line_price','missing_line_cost',
        'missing_declared_total','missing_declared_cost','price_total_mismatch','cost_total_mismatch',
        'price_extension_mismatch','cost_extension_mismatch','fractional_minor_extension','incomplete_extension')
      OR jsonb_typeof(finding->'field') IS DISTINCT FROM 'string'
      OR finding->>'field' NOT IN ('currency','price','cost')
    THEN RETURN false; END IF;
    IF finding ? 'sourceLineKey' AND (jsonb_typeof(finding->'sourceLineKey') IS DISTINCT FROM 'string'
      OR length(finding->>'sourceLineKey') NOT BETWEEN 1 AND 128)
    THEN RETURN false; END IF;
    IF finding ? 'expectedMinor' AND (jsonb_typeof(finding->'expectedMinor') IS DISTINCT FROM 'string'
      OR (finding->>'expectedMinor') !~ '^(0|[1-9][0-9]{0,29})$')
    THEN RETURN false; END IF;
    IF finding ? 'actualMinor' AND (jsonb_typeof(finding->'actualMinor') IS DISTINCT FROM 'string'
      OR (finding->>'actualMinor') !~ '^(0|[1-9][0-9]{0,19})$')
    THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE TABLE historical_estimate_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  client_id uuid NOT NULL,
  source_id uuid NOT NULL,
  estimate_draft_id uuid NOT NULL,
  request_id uuid NOT NULL,
  recorded_by uuid NOT NULL,
  request_hash text NOT NULL,
  selection_hash text NOT NULL,
  contract_version text NOT NULL,
  prior_import_id uuid,
  revision integer NOT NULL,
  declared_selected_total_minor numeric(20,0),
  declared_selected_estimated_cost_minor numeric(20,0),
  reconciliation_state text NOT NULL,
  reconciliation_findings jsonb NOT NULL,
  raw_selected_totals jsonb NOT NULL,
  reported_approval_at timestamptz,
  reported_approval_note text,
  expected_line_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT hei_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT hei_client_fk FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT hei_project_fk FOREIGN KEY (tenant_id, project_id, client_id) REFERENCES projects (tenant_id, id, client_id) ON DELETE RESTRICT,
  CONSTRAINT hei_actor_fk FOREIGN KEY (tenant_id, recorded_by) REFERENCES profiles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT hei_source_fk FOREIGN KEY (tenant_id, project_id, client_id, source_id) REFERENCES historical_estimate_sources (tenant_id, project_id, client_id, id) ON DELETE RESTRICT,
  CONSTRAINT hei_draft_fk FOREIGN KEY (tenant_id, project_id, client_id, estimate_draft_id) REFERENCES estimate_drafts (tenant_id, project_id, client_id, id) ON DELETE RESTRICT,
  CONSTRAINT hei_prior_fk FOREIGN KEY (tenant_id, project_id, client_id, prior_import_id) REFERENCES historical_estimate_imports (tenant_id, project_id, client_id, id) ON DELETE RESTRICT,
  CONSTRAINT hei_hashes CHECK (request_hash ~ '^[0-9a-f]{64}$' AND selection_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hei_contract CHECK (contract_version = 'historical-selection-v1'),
  CONSTRAINT hei_revision CHECK (revision > 0 AND (prior_import_id IS NULL OR prior_import_id <> id)),
  CONSTRAINT hei_state CHECK (reconciliation_state IN ('unresolved','matched','mismatch')),
  CONSTRAINT hei_findings CHECK (public.historical_estimate_valid_reconciliation(reconciliation_findings, reconciliation_state)),
  CONSTRAINT hei_money CHECK ((declared_selected_total_minor IS NULL OR (declared_selected_total_minor >= 0 AND declared_selected_total_minor <= 99999999999999999999)) AND (declared_selected_estimated_cost_minor IS NULL OR (declared_selected_estimated_cost_minor >= 0 AND declared_selected_estimated_cost_minor <= 99999999999999999999))),
  CONSTRAINT hei_note CHECK (reported_approval_note IS NULL OR length(reported_approval_note) <= 5000),
  CONSTRAINT hei_count CHECK (expected_line_count BETWEEN 1 AND 1000),
  CONSTRAINT hei_raw CHECK (jsonb_typeof(raw_selected_totals) = 'object' AND raw_selected_totals ?& ARRAY['version','total','estimatedCost'] AND raw_selected_totals - ARRAY['version','total','estimatedCost'] = '{}'::jsonb AND raw_selected_totals->>'version' IS NOT DISTINCT FROM 'historical-raw-selected-v1' AND jsonb_typeof(raw_selected_totals->'total') IN ('null','string') AND (raw_selected_totals->>'total' IS NULL OR length(raw_selected_totals->>'total') <= 256) AND jsonb_typeof(raw_selected_totals->'estimatedCost') IN ('null','string') AND (raw_selected_totals->>'estimatedCost' IS NULL OR length(raw_selected_totals->>'estimatedCost') <= 256)),
  CONSTRAINT uq_hei_request UNIQUE (tenant_id, request_id),
  CONSTRAINT uq_hei_draft UNIQUE (estimate_draft_id),
  CONSTRAINT uq_hei_content UNIQUE (tenant_id, project_id, client_id, source_id, selection_hash),
  CONSTRAINT uq_hei_context UNIQUE (tenant_id, project_id, client_id, id),
  CONSTRAINT uq_hei_source_identity UNIQUE (tenant_id, id, source_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_hei_linear ON historical_estimate_imports (tenant_id, prior_import_id) WHERE prior_import_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_hei_project_date ON historical_estimate_imports (tenant_id, project_id, created_at, id);
--> statement-breakpoint
CREATE INDEX idx_hei_source ON historical_estimate_imports (tenant_id, project_id, client_id, source_id);
--> statement-breakpoint
CREATE INDEX idx_hei_actor ON historical_estimate_imports (tenant_id, recorded_by);
--> statement-breakpoint
CREATE INDEX idx_hei_client ON historical_estimate_imports (tenant_id, client_id);
--> statement-breakpoint
CREATE TABLE historical_estimate_import_lines (
  tenant_id uuid NOT NULL,
  import_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_line_id uuid NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT hei_lines_pk PRIMARY KEY (import_id, source_line_id),
  CONSTRAINT heil_import_fk FOREIGN KEY (tenant_id, import_id, source_id) REFERENCES historical_estimate_imports (tenant_id, id, source_id) ON DELETE RESTRICT,
  CONSTRAINT heil_line_fk FOREIGN KEY (tenant_id, source_id, source_line_id) REFERENCES historical_estimate_source_lines (tenant_id, source_id, id) ON DELETE RESTRICT,
  CONSTRAINT heil_position CHECK (position >= 0),
  CONSTRAINT uq_heil_position UNIQUE (import_id, position)
);
--> statement-breakpoint
CREATE INDEX idx_heil_import ON historical_estimate_import_lines (tenant_id, import_id, source_id);
--> statement-breakpoint
CREATE INDEX idx_heil_source_line ON historical_estimate_import_lines (tenant_id, source_id, source_line_id);
--> statement-breakpoint

-- Evidence is append-only. Revisions create new rows; even soft deletion would
-- change the captured record and is refused here, independently of API guards.
CREATE FUNCTION public.historical_estimate_reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514',
    CONSTRAINT = 'historical_estimate_immutable',
    MESSAGE = 'Historical estimate evidence cannot be updated or deleted';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER hes_immutable BEFORE UPDATE OR DELETE ON historical_estimate_sources
FOR EACH ROW EXECUTE FUNCTION public.historical_estimate_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER hesl_immutable BEFORE UPDATE OR DELETE ON historical_estimate_source_lines
FOR EACH ROW EXECUTE FUNCTION public.historical_estimate_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER hei_immutable BEFORE UPDATE OR DELETE ON historical_estimate_imports
FOR EACH ROW EXECUTE FUNCTION public.historical_estimate_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER heil_immutable BEFORE UPDATE OR DELETE ON historical_estimate_import_lines
FOR EACH ROW EXECUTE FUNCTION public.historical_estimate_reject_mutation();
--> statement-breakpoint

-- Check both parent INSERT and every child INSERT at transaction completion.
-- Parent-only validation permits later child appends; child-only validation
-- permits an empty parent. Both are required for a complete immutable set.
-- Already committed parents necessarily have their exact immutable count, so
-- concurrent late insertions each exceed it even before seeing one another.
CREATE FUNCTION public.historical_estimate_check_source_set()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  source_key uuid;
  expected_count integer;
  actual_count bigint;
  source_currency text;
BEGIN
  IF TG_TABLE_NAME = 'historical_estimate_sources' THEN
    source_key := NEW.id;
  ELSE
    source_key := NEW.source_id;
  END IF;
  SELECT expected_line_count, currency_code INTO expected_count, source_currency
  FROM public.historical_estimate_sources
  WHERE tenant_id = NEW.tenant_id AND id = source_key;
  SELECT count(*) INTO actual_count
  FROM public.historical_estimate_source_lines
  WHERE tenant_id = NEW.tenant_id AND source_id = source_key;
  IF expected_count IS NULL OR actual_count IS DISTINCT FROM expected_count::bigint THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'hes_complete_line_set',
      MESSAGE = 'Historical source requires its complete declared line set';
  END IF;
  IF source_currency IS NULL AND EXISTS (
    SELECT 1 FROM public.historical_estimate_source_lines
    WHERE tenant_id = NEW.tenant_id AND source_id = source_key
      AND (unit_price IS NOT NULL OR unit_estimated_cost IS NOT NULL
        OR line_price_minor IS NOT NULL OR line_estimated_cost_minor IS NOT NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'hesl_unknown_currency',
      MESSAGE = 'Historical money requires an explicit supported source currency';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER hes_complete_after_insert
AFTER INSERT ON historical_estimate_sources DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.historical_estimate_check_source_set();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER hesl_complete_after_insert
AFTER INSERT ON historical_estimate_source_lines DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.historical_estimate_check_source_set();
--> statement-breakpoint

CREATE FUNCTION public.historical_estimate_check_import_set()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  import_key uuid;
  expected_count integer;
  actual_count bigint;
  source_currency text;
  selected_total numeric;
  selected_cost numeric;
  reconciliation_status text;
BEGIN
  IF TG_TABLE_NAME = 'historical_estimate_imports' THEN
    import_key := NEW.id;
  ELSE
    import_key := NEW.import_id;
  END IF;
  SELECT i.expected_line_count, s.currency_code, i.declared_selected_total_minor,
    i.declared_selected_estimated_cost_minor, i.reconciliation_state
  INTO expected_count, source_currency, selected_total, selected_cost, reconciliation_status
  FROM public.historical_estimate_imports i
  JOIN public.historical_estimate_sources s ON s.tenant_id = i.tenant_id AND s.id = i.source_id
  WHERE i.tenant_id = NEW.tenant_id AND i.id = import_key;
  SELECT count(*) INTO actual_count
  FROM public.historical_estimate_import_lines
  WHERE tenant_id = NEW.tenant_id AND import_id = import_key;
  IF expected_count IS NULL OR actual_count IS DISTINCT FROM expected_count::bigint THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'hei_complete_line_set',
      MESSAGE = 'Historical selection requires its complete declared line set';
  END IF;
  IF source_currency IS NULL AND (selected_total IS NOT NULL OR selected_cost IS NOT NULL
      OR reconciliation_status IS DISTINCT FROM 'unresolved') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'hei_unknown_currency',
      MESSAGE = 'Historical selection money requires an explicit supported source currency';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER hei_complete_after_insert
AFTER INSERT ON historical_estimate_imports DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.historical_estimate_check_import_set();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER heil_complete_after_insert
AFTER INSERT ON historical_estimate_import_lines DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.historical_estimate_check_import_set();
--> statement-breakpoint

-- Default-deny for roles subject to RLS. No policies, grants, or new roles are
-- introduced. Owners/BYPASSRLS principals require separate deployment validation.
ALTER TABLE historical_estimate_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE historical_estimate_source_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE historical_estimate_imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE historical_estimate_import_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
