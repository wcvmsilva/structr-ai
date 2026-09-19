-- A1 isolated core. Normative contract faa9e36b + ratified hardening addendum.
-- No writers, routes, UI, operational authority or legacy backfill.

-- Pure, closed grammar validators. No table reads and no SECURITY DEFINER.
CREATE FUNCTION public.internal_approval_trim_v1(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
  SELECT regexp_replace(value,U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+|[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+$','','g')
$$;

CREATE FUNCTION public.internal_approval_matches_v1(value jsonb, shape jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
DECLARE kind text:=shape->>'type'; scalar text; item jsonb; entry record; keys text[];
BEGIN
  IF value IS NULL THEN RETURN false; END IF;
  IF value='null'::jsonb THEN RETURN coalesce((shape->>'nullable')::boolean,false); END IF;
  IF kind='object' THEN
    IF jsonb_typeof(value)<>'object' THEN RETURN false; END IF;
    SELECT array_agg(k) INTO keys FROM jsonb_object_keys(shape->'properties') AS k;
    IF NOT (value ?& keys) OR value-keys<>'{}'::jsonb THEN RETURN false; END IF;
    FOR entry IN SELECT * FROM jsonb_each(shape->'properties') LOOP
      IF public.internal_approval_matches_v1(value->entry.key,entry.value) IS NOT TRUE THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  ELSIF kind='array' THEN
    IF jsonb_typeof(value)<>'array' OR jsonb_array_length(value)<(shape->>'min')::integer OR jsonb_array_length(value)>(shape->>'max')::integer THEN RETURN false; END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(value) LOOP
      IF public.internal_approval_matches_v1(item,shape->'items') IS NOT TRUE THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  ELSIF kind='enum' THEN RETURN (shape->'values') @> jsonb_build_array(value);
  ELSIF kind='boolean' THEN RETURN jsonb_typeof(value)='boolean';
  ELSIF kind='integer' THEN
    RETURN jsonb_typeof(value)='number' AND (value#>>'{}')~'^[0-9]+$' AND (value#>>'{}')::numeric BETWEEN (shape->>'min')::numeric AND (shape->>'max')::numeric;
  END IF;
  IF jsonb_typeof(value)<>'string' THEN RETURN false; END IF;
  scalar:=value#>>'{}';
  IF kind='uuid' THEN RETURN scalar~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND scalar<>'00000000-0000-0000-0000-000000000000';
  ELSIF kind='hash' THEN RETURN scalar~'^[0-9a-f]{64}$';
  ELSIF kind='minor' THEN RETURN scalar~'^(0|[1-9][0-9]{0,19})$';
  ELSIF kind='signed_minor' THEN RETURN scalar~'^(0|-?[1-9][0-9]{0,19})$';
  ELSIF kind IN ('decimal','positive_decimal','percent') THEN
    IF scalar!~'^(0|[1-9][0-9]{0,13})(\.[0-9]{0,5}[1-9])?$' THEN RETURN false; END IF;
    RETURN (kind<>'positive_decimal' OR scalar::numeric>0) AND (kind<>'percent' OR scalar::numeric<=100);
  ELSIF kind IN ('label','code') THEN
    RETURN char_length(scalar) BETWEEN 1 AND CASE WHEN kind='label' THEN 255 ELSE 128 END AND scalar=public.internal_approval_trim_v1(scalar) AND position(chr(13) IN scalar)=0;
  ELSIF kind='text' THEN RETURN char_length(scalar)<=5000 AND position(chr(13) IN scalar)=0;
  ELSIF kind='timestamp' THEN
    RETURN scalar~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      AND to_char(scalar::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=scalar;
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN RETURN false;
END $$;

CREATE FUNCTION public.internal_approval_lookup_key_v1(raw text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT regexp_replace(lower(public.internal_approval_trim_v1(raw)),U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+','_','g')
$$;
CREATE FUNCTION public.internal_approval_pricing_channel_v1(raw text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT CASE public.internal_approval_lookup_key_v1(raw)
  WHEN 'direct' THEN 'direct' WHEN 'residential' THEN 'direct' WHEN 'res' THEN 'direct' WHEN 'homeowner' THEN 'direct'
  WHEN 'insurance' THEN 'insurance' WHEN 'ins' THEN 'insurance' WHEN 'insurance_restoration' THEN 'insurance'
  WHEN 'commercial' THEN 'commercial' WHEN 'comm' THEN 'commercial' WHEN 'commercial_buildout' THEN 'commercial' END
$$;
CREATE FUNCTION public.internal_approval_channel_v1(raw text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT CASE public.internal_approval_lookup_key_v1(raw)
  WHEN 'premium' THEN 'premium' WHEN 'homeowner' THEN 'premium' WHEN 'residential' THEN 'premium' WHEN 'direct' THEN 'premium' WHEN 'retail' THEN 'premium' WHEN 'owner' THEN 'premium' WHEN 'high_end' THEN 'premium'
  WHEN 'trade' THEN 'trade' WHEN 'builder' THEN 'trade' WHEN 'gc' THEN 'trade' WHEN 'general_contractor' THEN 'trade' WHEN 'trade_partner' THEN 'trade' WHEN 'wholesale' THEN 'trade' WHEN 'commercial' THEN 'trade' WHEN 'commercial_buildout' THEN 'trade' WHEN 'insurance' THEN 'trade' WHEN 'insurance_restoration' THEN 'trade'
  WHEN 'capital' THEN 'capital' WHEN 'investor' THEN 'capital' WHEN 'fund' THEN 'capital' WHEN 'developer' THEN 'capital' WHEN 'institutional' THEN 'capital' END
$$;

CREATE FUNCTION public.internal_approval_snapshot_shape_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $shape$
 SELECT $snapshot${"type":"object","properties":{"version":{"type":"enum","values":["internal-approval-snapshot-v1"]},"identity":{"type":"object","properties":{"tenantId":{"type":"uuid"},"projectId":{"type":"uuid"},"clientId":{"type":"uuid"},"estimateDraftId":{"type":"uuid"},"draftVersion":{"type":"integer","min":1,"max":2147483647}}},"origin":{"type":"object","properties":{"source":{"type":"enum","values":["assembly_calculator","scope_draft","version","change_order"]},"sourceCreatedAt":{"type":"timestamp"},"pricingSchemaVersion":{"type":"code","nullable":true},"estimateId":{"type":"uuid","nullable":true},"intakeFormId":{"type":"uuid","nullable":true},"bundleId":{"type":"uuid","nullable":true},"supersedesId":{"type":"uuid","nullable":true},"changeOrderOf":{"type":"uuid","nullable":true},"lineageBasis":{"type":"enum","values":["verified_calculated_chain"]}}},"presentation":{"type":"object","properties":{"bundleName":{"type":"label","nullable":true},"reviewedNotes":{"type":"text","nullable":true}}},"financials":{"type":"object","properties":{"currencyCode":{"type":"enum","values":["USD"]},"currencyBasis":{"type":"enum","values":["approver_confirmation"]},"subtotalPriceMinor":{"type":"minor"},"discountApplied":{"type":"boolean"},"discountMinor":{"type":"minor"},"finalPriceMinor":{"type":"minor"},"estimatedCostMinor":{"type":"minor"}}},"lines":{"type":"array","items":{"type":"object","properties":{"lineKey":{"type":"code"},"ordinal":{"type":"integer","min":1,"max":1000},"costGroupName":{"type":"label"},"costItemName":{"type":"label"},"description":{"type":"text","nullable":true},"quantity":{"type":"positive_decimal"},"unit":{"type":"code","nullable":true},"unitCostSnapshot":{"type":"decimal","nullable":true},"unitPriceSnapshot":{"type":"decimal","nullable":true},"lineTotalCostMinor":{"type":"minor"},"lineTotalPriceMinor":{"type":"minor"},"assemblyId":{"type":"uuid","nullable":true},"costCode":{"type":"code","nullable":true},"taxable":{"type":"boolean","nullable":true},"csvClassification":{"type":"object","properties":{"classificationVersion":{"type":"enum","values":["jobtread-s20.1-classification-h1-8550e842-v1"]},"costType":{"type":"enum","values":["Allowance","Equipment / Rental","Labor","Materials","Other","Permits / Fees","Subcontractor"]},"normalizedUnit":{"type":"enum","values":["Each","Hours","Linear Feet","Lump Sum","Square Feet","Squares","Tons","Cubic Yards","Pounds","Bags","Boxes","Bundles","Gallons","Pieces","Rolls","Sets","Sheets"]},"costCode":{"type":"code","nullable":true},"costTypeSource":{"type":"enum","values":["classifyCostType_v1"]},"unitSource":{"type":"enum","values":["stored_canonical","normalizeUnit_v1"]},"costCodeSource":{"type":"enum","values":["stored","inferCostCode_v1","unknown"]}},"nullable":true}}},"min":1,"max":1000},"assemblySelections":{"type":"array","items":{"type":"object","properties":{"selectionKey":{"type":"code"},"ordinal":{"type":"integer","min":1,"max":1000},"assemblyId":{"type":"uuid"},"assemblyName":{"type":"label"},"assemblyCode":{"type":"code","nullable":true},"category":{"type":"label","nullable":true},"quantity":{"type":"positive_decimal"},"unitCost":{"type":"decimal","nullable":true},"unitPrice":{"type":"decimal","nullable":true},"extendedCostMinor":{"type":"minor","nullable":true},"extendedPriceMinor":{"type":"minor","nullable":true}}},"min":0,"max":1000},"commercialContext":{"type":"object","properties":{"pricingContext":{"type":"object","properties":{"pricingChannel":{"type":"enum","values":["direct","insurance","commercial"],"nullable":true},"finishLevel":{"type":"code","nullable":true},"region":{"type":"code","nullable":true},"zone":{"type":"code","nullable":true},"trade":{"type":"code","nullable":true},"coastalModifier":{"type":"decimal","nullable":true},"storedCommercialChannel":{"type":"enum","values":["premium","trade","capital"],"nullable":true},"storedGeoRiskClass":{"type":"enum","values":["inland","coastal","barrier_island"],"nullable":true},"storedRiskBasis":{"type":"enum","values":["persisted_pricing_context","unknown"]}}},"policyContext":{"type":"object","properties":{"version":{"type":"enum","values":["internal-approval-policy-v1"]},"evaluatorVersion":{"type":"enum","values":["phase2-channel-geo-plus-tenant-exact-v1"]},"commercialChannel":{"type":"enum","values":["premium","trade","capital"]},"channelBasis":{"type":"enum","values":["draft.commercialChannel","draft.pricingSnapshot.commercialChannel","draft.draftData.commercialChannel","draft.channel_mapping"]},"channelRawValue":{"type":"code"},"geoRiskClass":{"type":"enum","values":["inland","coastal","barrier_island"]},"riskBasis":{"type":"enum","values":["project_at_internal_review"]},"projectGeo":{"type":"object","properties":{"zone":{"type":"code"},"zoneId":{"type":"uuid"},"zoneTenantId":{"type":"uuid"},"zoneSnapshotCapturedAt":{"type":"timestamp"},"geocodedAt":{"type":"timestamp"},"geocodeConfidence":{"type":"enum","values":["high","medium"]},"geocodeSource":{"type":"enum","values":["google_maps"]},"coastalExposureLevel":{"type":"enum","values":["none","low","moderate","high","extreme"]},"riskResolutionBasis":{"type":"enum","values":["zone_exposure","persisted_project_risk"]},"persistedProjectRiskClass":{"type":"enum","values":["inland","coastal","barrier_island"],"nullable":true},"costMultiplier":{"type":"positive_decimal","nullable":true},"zoneMinFloorPct":{"type":"percent","nullable":true},"warningCodes":{"type":"array","items":{"type":"enum","values":["geo.geocode_failed","geo.geocode_low_confidence","geo.zone_not_detected","geo.coastal_exposure","geo.barrier_island_exposure","geo.outside_service_radius","geo.high_cost_multiplier"]},"min":0,"max":7}}},"tenantSettings":{"type":"object","properties":{"settingsId":{"type":"uuid","nullable":true},"settingsUpdatedAt":{"type":"timestamp","nullable":true},"channelOverridePct":{"type":"percent","nullable":true},"geoOverridePct":{"type":"percent","nullable":true}}},"floors":{"type":"object","properties":{"channelBasePct":{"type":"percent"},"geoBasePct":{"type":"percent"},"effectiveFloorPct":{"type":"percent"},"globalWarningPct":{"type":"enum","values":["35"]},"individualWarningPct":{"type":"enum","values":["28"]},"floorKind":{"type":"enum","values":["margin","fee"]}}}}}}},"scopeReference":{"type":"object","properties":{"association":{"type":"enum","values":["none","draft_link_only"]},"scopeDraftId":{"type":"uuid","nullable":true},"reviewSnapshotId":{"type":"uuid","nullable":true}}}}}$snapshot$::jsonb
$shape$;
CREATE FUNCTION public.internal_approval_evaluation_shape_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $shape$
 SELECT $evaluation${"type":"object","properties":{"version":{"type":"enum","values":["internal-approval-evaluation-v1"]},"policyVersion":{"type":"enum","values":["phase2-channel-geo-plus-tenant-exact-v1"]},"policyHash":{"type":"hash"},"commercialChannel":{"type":"enum","values":["premium","trade","capital"]},"geoRiskClass":{"type":"enum","values":["inland","coastal","barrier_island"]},"floorKind":{"type":"enum","values":["margin","fee"]},"effectiveFloorPct":{"type":"percent"},"priceMinor":{"type":"minor"},"costMinor":{"type":"minor"},"profitMinor":{"type":"signed_minor"},"passed":{"type":"boolean"},"violations":{"type":"array","items":{"type":"enum","values":["margin_below_effective_floor"]},"min":0,"max":1},"warnings":{"type":"array","items":{"type":"object","properties":{"code":{"type":"enum","values":["below_global_warning","assembly_below_individual_warning","assembly_margin_unknown"]},"selectionKey":{"type":"code","nullable":true},"thresholdPct":{"type":"percent","nullable":true}}},"min":0,"max":1001}}}$evaluation$::jsonb
$shape$;

CREATE FUNCTION public.internal_approval_valid_snapshot_v1(snapshot jsonb, evaluation jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
DECLARE f jsonb; p jsonb; pricing jsonb; geo jsonb; settings jsonb; floors jsonb; item jsonb; classification jsonb;
        total_price numeric:=0;total_cost numeric:=0;price numeric;cost numeric;floor numeric;channel_floor numeric;geo_floor numeric;
        position integer:=0; expected_warnings jsonb:='[]'::jsonb; expected_evaluation jsonb; warning text;last_warning integer:=0;warning_position integer;
BEGIN
 IF public.internal_approval_matches_v1(snapshot,public.internal_approval_snapshot_shape_v1()) IS NOT TRUE OR public.internal_approval_matches_v1(evaluation,public.internal_approval_evaluation_shape_v1()) IS NOT TRUE THEN RETURN false; END IF;
 f:=snapshot->'financials';p:=snapshot->'commercialContext'->'policyContext';pricing:=snapshot->'commercialContext'->'pricingContext';
 geo:=p->'projectGeo';settings:=p->'tenantSettings';floors:=p->'floors';
 price:=(f->>'finalPriceMinor')::numeric;cost:=(f->>'estimatedCostMinor')::numeric;
 IF price<=0 OR (f->>'subtotalPriceMinor')::numeric-(f->>'discountMinor')::numeric<>price OR (f->>'discountMinor')::numeric>(f->>'subtotalPriceMinor')::numeric OR (f->'discountApplied'='false'::jsonb AND f->>'discountMinor'<>'0') THEN RETURN false; END IF;
 IF snapshot->'origin'->>'source'='version' AND snapshot->'origin'->'supersedesId'='null'::jsonb OR snapshot->'origin'->>'source'='change_order' AND snapshot->'origin'->'changeOrderOf'='null'::jsonb THEN RETURN false; END IF;
 IF snapshot->'scopeReference'->'reviewSnapshotId'<>'null'::jsonb OR (snapshot->'scopeReference'->>'association'='none') IS DISTINCT FROM (snapshot->'scopeReference'->'scopeDraftId'='null'::jsonb) THEN RETURN false; END IF;
 IF (settings->'settingsId'='null'::jsonb) IS DISTINCT FROM (settings->'settingsUpdatedAt'='null'::jsonb) OR (settings->'settingsId'='null'::jsonb AND (settings->'channelOverridePct'<>'null'::jsonb OR settings->'geoOverridePct'<>'null'::jsonb)) THEN RETURN false; END IF;
 IF geo->>'zoneTenantId' IS DISTINCT FROM snapshot->'identity'->>'tenantId' OR (CASE WHEN p->>'channelBasis'='draft.channel_mapping' THEN public.internal_approval_channel_v1(public.internal_approval_pricing_channel_v1(p->>'channelRawValue')) ELSE public.internal_approval_channel_v1(p->>'channelRawValue') END) IS DISTINCT FROM p->>'commercialChannel' THEN RETURN false; END IF;
 IF pricing->'storedCommercialChannel'<>'null'::jsonb AND pricing->>'storedCommercialChannel'<>p->>'commercialChannel' OR pricing->'storedGeoRiskClass'<>'null'::jsonb AND pricing->>'storedGeoRiskClass'<>p->>'geoRiskClass' OR ((pricing->>'storedRiskBasis'='unknown') IS DISTINCT FROM (pricing->'storedGeoRiskClass'='null'::jsonb)) OR (pricing->'zone'<>'null'::jsonb AND pricing->'zone' IS DISTINCT FROM geo->'zone') THEN RETURN false; END IF;
 IF geo->>'coastalExposureLevel' IN ('moderate','high','extreme') THEN
  IF geo->>'riskResolutionBasis'<>'zone_exposure' OR p->>'geoRiskClass'<>(CASE WHEN geo->>'coastalExposureLevel'='extreme' THEN 'barrier_island' ELSE 'coastal' END) THEN RETURN false; END IF;
 ELSE
  IF geo->>'riskResolutionBasis'<>'persisted_project_risk' OR geo->>'persistedProjectRiskClass' IS DISTINCT FROM p->>'geoRiskClass' OR p->>'geoRiskClass' IS DISTINCT FROM (CASE WHEN lower(geo->>'zone')~'barrier|isle of palms|sullivan|folly|kiawah|seabrook|edisto|dewees|capers|island' THEN 'barrier_island' WHEN lower(geo->>'zone')~'coastal|beach|waterfront|marsh|tidal|harbor|creek|sound|peninsula' THEN 'coastal' ELSE 'inland' END) THEN RETURN false; END IF;
 END IF;
 IF geo->'persistedProjectRiskClass'<>'null'::jsonb AND geo->>'persistedProjectRiskClass'<>p->>'geoRiskClass' THEN RETURN false; END IF;
 FOR warning IN SELECT jsonb_array_elements_text(geo->'warningCodes') LOOP
  warning_position:=array_position(ARRAY['geo.geocode_failed','geo.geocode_low_confidence','geo.zone_not_detected','geo.coastal_exposure','geo.barrier_island_exposure','geo.outside_service_radius','geo.high_cost_multiplier'],warning);
  IF warning_position<=3 OR warning_position<=last_warning THEN RETURN false; END IF;last_warning:=warning_position;
 END LOOP;
 IF (p->>'geoRiskClass'='barrier_island' AND NOT(geo->'warningCodes' ? 'geo.barrier_island_exposure')) OR (p->>'geoRiskClass'='coastal' AND NOT(geo->'warningCodes' ? 'geo.coastal_exposure')) OR ((geo->>'costMultiplier')::numeric>=1.15 AND NOT(geo->'warningCodes' ? 'geo.high_cost_multiplier')) THEN RETURN false; END IF;
 channel_floor:=CASE p->>'commercialChannel' WHEN 'premium' THEN 28 WHEN 'trade' THEN 18 ELSE 15 END;
 geo_floor:=CASE p->>'geoRiskClass' WHEN 'inland' THEN 0 WHEN 'coastal' THEN 42 ELSE 50 END;
 floor:=greatest(channel_floor,geo_floor,(settings->>'channelOverridePct')::numeric,(settings->>'geoOverridePct')::numeric);
 IF (floors->>'channelBasePct')::numeric<>channel_floor OR (floors->>'geoBasePct')::numeric<>geo_floor OR (floors->>'effectiveFloorPct')::numeric<>floor OR floors->>'floorKind'<>(CASE WHEN p->>'commercialChannel'='capital' THEN 'fee' ELSE 'margin' END) OR (geo->>'zoneMinFloorPct')::numeric>floor THEN RETURN false; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(snapshot->'lines') LOOP
  position:=position+1;
  IF item->>'lineKey'<>'line:'||position::text OR (item->>'ordinal')::integer<>position THEN RETURN false; END IF;
  total_price:=total_price+(item->>'lineTotalPriceMinor')::numeric;total_cost:=total_cost+(item->>'lineTotalCostMinor')::numeric;
  classification:=item->'csvClassification';
  IF classification<>'null'::jsonb THEN
   IF item->'unit'='null'::jsonb OR item->'unitCostSnapshot'='null'::jsonb OR item->'unitPriceSnapshot'='null'::jsonb THEN RETURN false; END IF;
   IF (classification->>'costCodeSource'='unknown') IS DISTINCT FROM (classification->'costCode'='null'::jsonb) THEN RETURN false; END IF;
   IF classification->>'unitSource'='stored_canonical' AND classification->>'normalizedUnit' IS DISTINCT FROM item->>'unit' THEN RETURN false; END IF;
   IF classification->>'costCodeSource'='stored' THEN
    IF item->'costCode'='null'::jsonb OR classification->'costCode' IS DISTINCT FROM item->'costCode' THEN RETURN false; END IF;
   ELSIF item->'costCode'<>'null'::jsonb THEN RETURN false; END IF;
  END IF;
 END LOOP;
 IF total_price<>(f->>'subtotalPriceMinor')::numeric OR total_cost<>cost THEN RETURN false; END IF;
 IF 100*(price-cost)<floor*price THEN RETURN false; END IF;
 IF 100*(price-cost)<35*price THEN expected_warnings:=expected_warnings||jsonb_build_array(jsonb_build_object('code','below_global_warning','selectionKey',NULL,'thresholdPct','35')); END IF;
 position:=0;
 FOR item IN SELECT * FROM jsonb_array_elements(snapshot->'assemblySelections') LOOP
  position:=position+1;
  IF item->>'selectionKey'<>'selection:'||position::text OR (item->>'ordinal')::integer<>position THEN RETURN false; END IF;
  IF item->'extendedCostMinor'='null'::jsonb OR item->'extendedPriceMinor'='null'::jsonb OR (item->>'extendedPriceMinor')::numeric=0 THEN
   expected_warnings:=expected_warnings||jsonb_build_array(jsonb_build_object('code','assembly_margin_unknown','selectionKey',item->>'selectionKey','thresholdPct',NULL));
  ELSIF 100*((item->>'extendedPriceMinor')::numeric-(item->>'extendedCostMinor')::numeric)<28*(item->>'extendedPriceMinor')::numeric THEN
   expected_warnings:=expected_warnings||jsonb_build_array(jsonb_build_object('code','assembly_below_individual_warning','selectionKey',item->>'selectionKey','thresholdPct','28'));
  END IF;
 END LOOP;
 expected_evaluation:=jsonb_build_object('version','internal-approval-evaluation-v1','policyVersion',p->>'evaluatorVersion','policyHash',evaluation->>'policyHash','commercialChannel',p->>'commercialChannel','geoRiskClass',p->>'geoRiskClass','floorKind',floors->>'floorKind','effectiveFloorPct',floors->>'effectiveFloorPct','priceMinor',f->>'finalPriceMinor','costMinor',f->>'estimatedCostMinor','profitMinor',(price-cost)::text,'passed',true,'violations','[]'::jsonb,'warnings',expected_warnings);
 RETURN evaluation=expected_evaluation;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

ALTER TABLE public.estimate_drafts ADD COLUMN a1_version_request_id uuid;
ALTER TABLE public.estimate_drafts ADD COLUMN a1_version_request_hash text;

CREATE TABLE public.estimate_internal_approval_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, client_id uuid NOT NULL,
  estimate_draft_id uuid NOT NULL, draft_version integer NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(), deleted_at timestamptz(3),
  contract_version text NOT NULL, content_hash text NOT NULL,
  currency_code text NOT NULL, currency_basis text NOT NULL,
  subtotal_price_minor numeric(20,0) NOT NULL, discount_minor numeric(20,0) NOT NULL,
  final_price_minor numeric(20,0) NOT NULL, estimated_cost_minor numeric(20,0) NOT NULL,
  policy_version text NOT NULL, policy_hash text NOT NULL,
  snapshot_payload jsonb NOT NULL, policy_evaluation jsonb NOT NULL, captured_by uuid NOT NULL
);
CREATE TABLE public.estimate_internal_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, client_id uuid NOT NULL, estimate_draft_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(), deleted_at timestamptz(3),
  snapshot_id uuid NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL,
  approved_by uuid NOT NULL, approved_at timestamptz(3) NOT NULL DEFAULT now(), reason text NOT NULL, contract_version text NOT NULL
);
CREATE TABLE public.estimate_internal_approval_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, client_id uuid NOT NULL, estimate_draft_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(), deleted_at timestamptz(3),
  approval_id uuid NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL,
  revoked_by uuid NOT NULL, revoked_at timestamptz(3) NOT NULL DEFAULT now(), reason text NOT NULL, contract_version text NOT NULL
);

ALTER TABLE public."estimate_drafts" ADD CONSTRAINT "ck_ed_a1_version_request" CHECK (("estimate_drafts"."a1_version_request_id" IS NULL AND "estimate_drafts"."a1_version_request_hash" IS NULL) OR ("estimate_drafts"."a1_version_request_id" IS NOT NULL AND "estimate_drafts"."a1_version_request_hash" IS NOT NULL AND "estimate_drafts"."a1_version_request_hash" ~ '^[0-9a-f]{64}$' AND "estimate_drafts"."tenant_id" IS NOT NULL AND "estimate_drafts"."project_id" IS NOT NULL AND "estimate_drafts"."client_id" IS NOT NULL AND "estimate_drafts"."created_by" IS NOT NULL AND "estimate_drafts"."supersedes_id" IS NOT NULL AND "estimate_drafts"."source" IS NOT DISTINCT FROM 'version' AND NOT ('00000000-0000-0000-0000-000000000000'::uuid = ANY(ARRAY["estimate_drafts"."id","estimate_drafts"."tenant_id","estimate_drafts"."project_id","estimate_drafts"."client_id","estimate_drafts"."created_by","estimate_drafts"."supersedes_id","estimate_drafts"."a1_version_request_id"]))));
CREATE UNIQUE INDEX "uq_ed_a1_version_request" ON public."estimate_drafts" ("tenant_id","a1_version_request_id") WHERE "estimate_drafts"."a1_version_request_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_ed_a1_version_successor" ON public."estimate_drafts" ("tenant_id","supersedes_id") WHERE "estimate_drafts"."a1_version_request_id" IS NOT NULL;
ALTER TABLE public."estimate_internal_approval_snapshots" ADD CONSTRAINT "ck_eias_uuids" CHECK (NOT ('00000000-0000-0000-0000-000000000000'::uuid = ANY(ARRAY["estimate_internal_approval_snapshots"."id","estimate_internal_approval_snapshots"."tenant_id","estimate_internal_approval_snapshots"."project_id","estimate_internal_approval_snapshots"."client_id","estimate_internal_approval_snapshots"."estimate_draft_id","estimate_internal_approval_snapshots"."captured_by"])));
ALTER TABLE public."estimate_internal_approval_snapshots" ADD CONSTRAINT "ck_eias_times" CHECK ("estimate_internal_approval_snapshots"."updated_at" = "estimate_internal_approval_snapshots"."created_at" AND "estimate_internal_approval_snapshots"."deleted_at" IS NULL);
ALTER TABLE public."estimate_internal_approval_snapshots" ADD CONSTRAINT "ck_eias_contract" CHECK ("estimate_internal_approval_snapshots"."contract_version" = 'internal-approval-snapshot-v1' AND "estimate_internal_approval_snapshots"."currency_code" = 'USD' AND "estimate_internal_approval_snapshots"."currency_basis" = 'approver_confirmation' AND "estimate_internal_approval_snapshots"."policy_version" = 'phase2-channel-geo-plus-tenant-exact-v1' AND "estimate_internal_approval_snapshots"."draft_version" > 0);
ALTER TABLE public."estimate_internal_approval_snapshots" ADD CONSTRAINT "ck_eias_hashes" CHECK ("estimate_internal_approval_snapshots"."content_hash" ~ '^[0-9a-f]{64}$' AND "estimate_internal_approval_snapshots"."policy_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE public."estimate_internal_approval_snapshots" ADD CONSTRAINT "ck_eias_money" CHECK ("estimate_internal_approval_snapshots"."subtotal_price_minor" >= 0 AND "estimate_internal_approval_snapshots"."discount_minor" >= 0 AND "estimate_internal_approval_snapshots"."estimated_cost_minor" >= 0 AND "estimate_internal_approval_snapshots"."final_price_minor" > 0 AND "estimate_internal_approval_snapshots"."discount_minor" <= "estimate_internal_approval_snapshots"."subtotal_price_minor" AND "estimate_internal_approval_snapshots"."subtotal_price_minor" - "estimate_internal_approval_snapshots"."discount_minor" = "estimate_internal_approval_snapshots"."final_price_minor");
ALTER TABLE public."estimate_internal_approval_snapshots" ADD CONSTRAINT "ck_eias_payload" CHECK (public.internal_approval_valid_snapshot_v1("estimate_internal_approval_snapshots"."snapshot_payload", "estimate_internal_approval_snapshots"."policy_evaluation") IS TRUE);
ALTER TABLE public."estimate_internal_approval_snapshots" ADD CONSTRAINT "ck_eias_evaluation" CHECK (("estimate_internal_approval_snapshots"."snapshot_payload"->'identity' = jsonb_build_object('tenantId',"estimate_internal_approval_snapshots"."tenant_id",'projectId',"estimate_internal_approval_snapshots"."project_id",'clientId',"estimate_internal_approval_snapshots"."client_id",'estimateDraftId',"estimate_internal_approval_snapshots"."estimate_draft_id",'draftVersion',"estimate_internal_approval_snapshots"."draft_version") AND "estimate_internal_approval_snapshots"."snapshot_payload"->'financials' = jsonb_build_object('currencyCode',"estimate_internal_approval_snapshots"."currency_code",'currencyBasis',"estimate_internal_approval_snapshots"."currency_basis",'subtotalPriceMinor',"estimate_internal_approval_snapshots"."subtotal_price_minor"::text,'discountApplied',"estimate_internal_approval_snapshots"."snapshot_payload"->'financials'->'discountApplied','discountMinor',"estimate_internal_approval_snapshots"."discount_minor"::text,'finalPriceMinor',"estimate_internal_approval_snapshots"."final_price_minor"::text,'estimatedCostMinor',"estimate_internal_approval_snapshots"."estimated_cost_minor"::text) AND "estimate_internal_approval_snapshots"."policy_evaluation"->>'policyHash' = "estimate_internal_approval_snapshots"."policy_hash" AND "estimate_internal_approval_snapshots"."policy_evaluation"->>'policyVersion' = "estimate_internal_approval_snapshots"."policy_version") IS TRUE);
CREATE UNIQUE INDEX "uq_eias_draft" ON public."estimate_internal_approval_snapshots" ("tenant_id","estimate_draft_id");
CREATE UNIQUE INDEX "uq_eias_context" ON public."estimate_internal_approval_snapshots" ("tenant_id","project_id","client_id","estimate_draft_id","id");
CREATE UNIQUE INDEX "uq_eias_export_identity" ON public."estimate_internal_approval_snapshots" ("tenant_id","project_id","client_id","estimate_draft_id","id","content_hash");
CREATE INDEX "idx_eias_project_created" ON public."estimate_internal_approval_snapshots" ("tenant_id","project_id","created_at");
ALTER TABLE public."estimate_internal_approval_snapshots" ADD CONSTRAINT "fk_eias_draft_context" FOREIGN KEY ("tenant_id","project_id","client_id","estimate_draft_id") REFERENCES public."estimate_drafts" ("tenant_id","project_id","client_id","id") ON DELETE restrict ON UPDATE restrict;
ALTER TABLE public."estimate_internal_approval_snapshots" ADD CONSTRAINT "fk_eias_project_context" FOREIGN KEY ("tenant_id","project_id","client_id") REFERENCES public."projects" ("tenant_id","id","client_id") ON DELETE restrict ON UPDATE restrict;
ALTER TABLE public."estimate_internal_approval_snapshots" ADD CONSTRAINT "fk_eias_client_context" FOREIGN KEY ("tenant_id","client_id") REFERENCES public."clients" ("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
ALTER TABLE public."estimate_internal_approval_snapshots" ADD CONSTRAINT "fk_eias_tenant" FOREIGN KEY ("tenant_id") REFERENCES public."tenants" ("id") ON DELETE restrict ON UPDATE restrict;
ALTER TABLE public."estimate_internal_approval_snapshots" ADD CONSTRAINT "fk_eias_actor" FOREIGN KEY ("tenant_id","captured_by") REFERENCES public."profiles" ("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
ALTER TABLE public."estimate_internal_approval_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."estimate_internal_approvals" ADD CONSTRAINT "ck_eia_uuids" CHECK (NOT ('00000000-0000-0000-0000-000000000000'::uuid = ANY(ARRAY["estimate_internal_approvals"."id","estimate_internal_approvals"."tenant_id","estimate_internal_approvals"."project_id","estimate_internal_approvals"."client_id","estimate_internal_approvals"."estimate_draft_id","estimate_internal_approvals"."snapshot_id","estimate_internal_approvals"."request_id","estimate_internal_approvals"."approved_by"])));
ALTER TABLE public."estimate_internal_approvals" ADD CONSTRAINT "ck_eia_times" CHECK ("estimate_internal_approvals"."updated_at" = "estimate_internal_approvals"."created_at" AND "estimate_internal_approvals"."approved_at" = "estimate_internal_approvals"."created_at" AND "estimate_internal_approvals"."deleted_at" IS NULL);
ALTER TABLE public."estimate_internal_approvals" ADD CONSTRAINT "ck_eia_contract" CHECK ("estimate_internal_approvals"."contract_version" = 'internal-approval-decision-v1' AND "estimate_internal_approvals"."request_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE public."estimate_internal_approvals" ADD CONSTRAINT "ck_eia_reason" CHECK (char_length("estimate_internal_approvals"."reason") BETWEEN 10 AND 2000 AND "estimate_internal_approvals"."reason"=public.internal_approval_trim_v1("estimate_internal_approvals"."reason") AND position(chr(13) in "estimate_internal_approvals"."reason")=0);
CREATE UNIQUE INDEX "uq_eia_request" ON public."estimate_internal_approvals" ("tenant_id","request_id");
CREATE UNIQUE INDEX "uq_eia_draft" ON public."estimate_internal_approvals" ("tenant_id","estimate_draft_id");
CREATE UNIQUE INDEX "uq_eia_snapshot" ON public."estimate_internal_approvals" ("tenant_id","snapshot_id");
CREATE UNIQUE INDEX "uq_eia_context" ON public."estimate_internal_approvals" ("tenant_id","project_id","client_id","estimate_draft_id","id");
CREATE UNIQUE INDEX "uq_eia_export_identity" ON public."estimate_internal_approvals" ("tenant_id","project_id","client_id","estimate_draft_id","id","snapshot_id");
CREATE INDEX "idx_eia_project_approved" ON public."estimate_internal_approvals" ("tenant_id","project_id","approved_at");
ALTER TABLE public."estimate_internal_approvals" ADD CONSTRAINT "fk_eia_snapshot_context" FOREIGN KEY ("tenant_id","project_id","client_id","estimate_draft_id","snapshot_id") REFERENCES public."estimate_internal_approval_snapshots" ("tenant_id","project_id","client_id","estimate_draft_id","id") ON DELETE restrict ON UPDATE restrict;
ALTER TABLE public."estimate_internal_approvals" ADD CONSTRAINT "fk_eia_actor" FOREIGN KEY ("tenant_id","approved_by") REFERENCES public."profiles" ("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
ALTER TABLE public."estimate_internal_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."estimate_internal_approval_revocations" ADD CONSTRAINT "ck_eiar_uuids" CHECK (NOT ('00000000-0000-0000-0000-000000000000'::uuid = ANY(ARRAY["estimate_internal_approval_revocations"."id","estimate_internal_approval_revocations"."tenant_id","estimate_internal_approval_revocations"."project_id","estimate_internal_approval_revocations"."client_id","estimate_internal_approval_revocations"."estimate_draft_id","estimate_internal_approval_revocations"."approval_id","estimate_internal_approval_revocations"."request_id","estimate_internal_approval_revocations"."revoked_by"])));
ALTER TABLE public."estimate_internal_approval_revocations" ADD CONSTRAINT "ck_eiar_times" CHECK ("estimate_internal_approval_revocations"."updated_at" = "estimate_internal_approval_revocations"."created_at" AND "estimate_internal_approval_revocations"."revoked_at" = "estimate_internal_approval_revocations"."created_at" AND "estimate_internal_approval_revocations"."deleted_at" IS NULL);
ALTER TABLE public."estimate_internal_approval_revocations" ADD CONSTRAINT "ck_eiar_contract" CHECK ("estimate_internal_approval_revocations"."contract_version" = 'internal-approval-revocation-v1' AND "estimate_internal_approval_revocations"."request_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE public."estimate_internal_approval_revocations" ADD CONSTRAINT "ck_eiar_reason" CHECK (char_length("estimate_internal_approval_revocations"."reason") BETWEEN 10 AND 2000 AND "estimate_internal_approval_revocations"."reason"=public.internal_approval_trim_v1("estimate_internal_approval_revocations"."reason") AND position(chr(13) in "estimate_internal_approval_revocations"."reason")=0);
CREATE UNIQUE INDEX "uq_eiar_request" ON public."estimate_internal_approval_revocations" ("tenant_id","request_id");
CREATE UNIQUE INDEX "uq_eiar_approval" ON public."estimate_internal_approval_revocations" ("tenant_id","approval_id");
CREATE INDEX "idx_eiar_project_revoked" ON public."estimate_internal_approval_revocations" ("tenant_id","project_id","revoked_at");
ALTER TABLE public."estimate_internal_approval_revocations" ADD CONSTRAINT "fk_eiar_approval_context" FOREIGN KEY ("tenant_id","project_id","client_id","estimate_draft_id","approval_id") REFERENCES public."estimate_internal_approvals" ("tenant_id","project_id","client_id","estimate_draft_id","id") ON DELETE restrict ON UPDATE restrict;
ALTER TABLE public."estimate_internal_approval_revocations" ADD CONSTRAINT "fk_eiar_actor" FOREIGN KEY ("tenant_id","revoked_by") REFERENCES public."profiles" ("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
ALTER TABLE public."estimate_internal_approval_revocations" ENABLE ROW LEVEL SECURITY;

-- A legacy JSON number/string is compared exactly, never via floating point.
CREATE FUNCTION public.internal_approval_legacy_number_v1(value jsonb,scale_limit integer) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
DECLARE scalar text;
BEGIN
 IF value IS NULL OR value='null'::jsonb THEN RETURN NULL; END IF;
 IF jsonb_typeof(value) NOT IN ('number','string') THEN RAISE EXCEPTION 'A1_SOURCE_NUMBER_INVALID' USING ERRCODE='23514'; END IF;
 scalar:=value#>>'{}';
 IF scalar!~('^(0|[1-9][0-9]{0,'||CASE WHEN scale_limit=2 THEN '17' ELSE '13' END||'})(\.[0-9]{1,'||scale_limit::text||'})?$') THEN RAISE EXCEPTION 'A1_SOURCE_NUMBER_INVALID' USING ERRCODE='23514'; END IF;
 RETURN scalar::numeric;
END $$;

CREATE FUNCTION public.internal_approval_draft_matches_v1(d public.estimate_drafts,s jsonb,include_notes boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
DECLARE f jsonb:=s->'financials';o jsonb:=s->'origin';pc jsonb:=s->'commercialContext'->'pricingContext';p jsonb:=s->'commercialContext'->'policyContext';raw jsonb;item jsonb;i integer;candidate text;resolved text;raw_risk text;raw_channel text;basis text;
BEGIN
 IF d.source IS DISTINCT FROM o->>'source' OR date_trunc('milliseconds',d.created_at) IS DISTINCT FROM (o->>'sourceCreatedAt')::timestamptz OR public.internal_approval_trim_v1(replace(replace(d.pricing_schema_version,E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM o->>'pricingSchemaVersion' OR d.estimate_id::text IS DISTINCT FROM o->>'estimateId' OR d.intake_form_id::text IS DISTINCT FROM o->>'intakeFormId' OR d.bundle_id::text IS DISTINCT FROM o->>'bundleId' OR d.supersedes_id::text IS DISTINCT FROM o->>'supersedesId' OR d.change_order_of::text IS DISTINCT FROM o->>'changeOrderOf' THEN RETURN false; END IF;
 IF d.bundle_name IS NOT NULL AND public.internal_approval_trim_v1(replace(replace(d.bundle_name,E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM s->'presentation'->>'bundleName' OR d.bundle_name IS NULL AND s->'presentation'->'bundleName'<>'null'::jsonb THEN RETURN false; END IF;
 IF include_notes AND replace(replace(d.notes,E'\r\n',E'\n'),E'\r',E'\n') IS DISTINCT FROM s->'presentation'->>'reviewedNotes' THEN RETURN false; END IF;
 IF d.subtotal_price*100 IS DISTINCT FROM (f->>'subtotalPriceMinor')::numeric OR d.discount_amount*100 IS DISTINCT FROM (f->>'discountMinor')::numeric OR d.final_total_price*100 IS DISTINCT FROM (f->>'finalPriceMinor')::numeric OR d.subtotal_cost*100 IS DISTINCT FROM (f->>'estimatedCostMinor')::numeric OR to_jsonb(d.discount_applied) IS DISTINCT FROM f->'discountApplied' THEN RETURN false; END IF;
 IF d.scope_draft_id::text IS DISTINCT FROM s->'scopeReference'->>'scopeDraftId' THEN RETURN false; END IF;
 IF public.internal_approval_trim_v1(replace(replace(d.finish_level,E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM pc->>'finishLevel' OR public.internal_approval_trim_v1(replace(replace(d.region,E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM pc->>'region' OR public.internal_approval_trim_v1(replace(replace(d.zone,E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM pc->>'zone' OR public.internal_approval_trim_v1(replace(replace(d.trade,E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM pc->>'trade' OR d.coastal_modifier IS DISTINCT FROM (pc->>'coastalModifier')::numeric THEN RETURN false; END IF;
 IF d.channel IS NOT NULL AND public.internal_approval_pricing_channel_v1(d.channel) IS DISTINCT FROM pc->>'pricingChannel' OR d.channel IS NULL AND pc->'pricingChannel'<>'null'::jsonb THEN RETURN false; END IF;
 raw_channel:=coalesce(d.commercial_channel,d.pricing_snapshot->>'commercialChannel',d.draft_data->>'commercialChannel');
 IF public.internal_approval_channel_v1(raw_channel) IS DISTINCT FROM pc->>'storedCommercialChannel' THEN RETURN false; END IF;
 raw_risk:=coalesce(d.pricing_snapshot->>'geoRiskClass',d.draft_data->>'geoRiskClass');
 IF raw_risk IS DISTINCT FROM pc->>'storedGeoRiskClass' OR (raw_risk IS NULL) IS DISTINCT FROM (pc->>'storedRiskBasis'='unknown') THEN RETURN false; END IF;
 IF d.commercial_channel IS NOT NULL THEN candidate:=d.commercial_channel;basis:='draft.commercialChannel';
 ELSIF d.pricing_snapshot->>'commercialChannel' IS NOT NULL THEN candidate:=d.pricing_snapshot->>'commercialChannel';basis:='draft.pricingSnapshot.commercialChannel';
 ELSIF d.draft_data->>'commercialChannel' IS NOT NULL THEN candidate:=d.draft_data->>'commercialChannel';basis:='draft.draftData.commercialChannel';
 ELSE candidate:=d.channel;basis:='draft.channel_mapping';END IF;
 IF public.internal_approval_trim_v1(replace(replace(candidate,E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM p->>'channelRawValue' OR basis IS DISTINCT FROM p->>'channelBasis' THEN RETURN false; END IF;
 FOREACH candidate IN ARRAY ARRAY[d.commercial_channel,d.pricing_snapshot->>'commercialChannel',d.draft_data->>'commercialChannel'] LOOP
  IF candidate IS NOT NULL THEN resolved:=public.internal_approval_channel_v1(candidate);IF resolved IS NULL OR resolved<>p->>'commercialChannel' THEN RETURN false;END IF;END IF;
 END LOOP;
 IF d.channel IS NOT NULL AND public.internal_approval_channel_v1(public.internal_approval_pricing_channel_v1(d.channel)) IS DISTINCT FROM p->>'commercialChannel' THEN RETURN false;END IF;
 IF jsonb_typeof(d.line_items) IS DISTINCT FROM 'array' OR jsonb_array_length(d.line_items)<>jsonb_array_length(s->'lines') OR jsonb_typeof(d.assembly_selections) IS DISTINCT FROM 'array' OR jsonb_array_length(d.assembly_selections)<>jsonb_array_length(s->'assemblySelections') THEN RETURN false; END IF;
 FOR i IN 0..jsonb_array_length(s->'lines')-1 LOOP
  raw:=d.line_items->i;item:=s->'lines'->i;
  IF public.internal_approval_trim_v1(replace(replace(raw->>'costGroupName',E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM item->>'costGroupName' OR public.internal_approval_trim_v1(replace(replace(raw->>'costItemName',E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM item->>'costItemName' OR replace(replace(raw->>'description',E'\r\n',E'\n'),E'\r',E'\n') IS DISTINCT FROM item->>'description' OR public.internal_approval_trim_v1(replace(replace(raw->>'unit',E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM item->>'unit' OR raw->>'assemblyId' IS DISTINCT FROM item->>'assemblyId' OR public.internal_approval_trim_v1(replace(replace(raw->>'costCode',E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM item->>'costCode' OR coalesce(raw->'taxable','null'::jsonb) IS DISTINCT FROM item->'taxable' THEN RETURN false; END IF;
  IF public.internal_approval_legacy_number_v1(raw->'quantity',6) IS DISTINCT FROM (item->>'quantity')::numeric OR public.internal_approval_legacy_number_v1(raw->'unitCostSnapshot',6) IS DISTINCT FROM (item->>'unitCostSnapshot')::numeric OR public.internal_approval_legacy_number_v1(raw->'unitPriceSnapshot',6) IS DISTINCT FROM (item->>'unitPriceSnapshot')::numeric OR public.internal_approval_legacy_number_v1(raw->'lineTotalCost',2)*100 IS DISTINCT FROM (item->>'lineTotalCostMinor')::numeric OR public.internal_approval_legacy_number_v1(raw->'lineTotalPrice',2)*100 IS DISTINCT FROM (item->>'lineTotalPriceMinor')::numeric THEN RETURN false; END IF;
 END LOOP;
 IF d.assembly_count IS NOT NULL AND d.assembly_count<>jsonb_array_length(s->'assemblySelections') THEN RETURN false; END IF;
 FOR i IN 0..jsonb_array_length(s->'assemblySelections')-1 LOOP
  raw:=d.assembly_selections->i;item:=s->'assemblySelections'->i;
  IF raw->>'assemblyId' IS DISTINCT FROM item->>'assemblyId' OR public.internal_approval_trim_v1(replace(replace(raw->>'assemblyName',E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM item->>'assemblyName' OR public.internal_approval_trim_v1(replace(replace(raw->>'assemblyCode',E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM item->>'assemblyCode' OR public.internal_approval_trim_v1(replace(replace(raw->>'category',E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM item->>'category' OR public.internal_approval_legacy_number_v1(raw->'quantity',6) IS DISTINCT FROM (item->>'quantity')::numeric OR public.internal_approval_legacy_number_v1(raw->'unitCost',6) IS DISTINCT FROM (item->>'unitCost')::numeric OR public.internal_approval_legacy_number_v1(raw->'unitPrice',6) IS DISTINCT FROM (item->>'unitPrice')::numeric OR public.internal_approval_legacy_number_v1(raw->'extendedCost',2)*100 IS DISTINCT FROM (item->>'extendedCostMinor')::numeric OR public.internal_approval_legacy_number_v1(raw->'extendedPrice',2)*100 IS DISTINCT FROM (item->>'extendedPriceMinor')::numeric THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION public.internal_approval_check_lineage_v1(root_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE root_d public.estimate_drafts;d public.estimate_drafts;stack jsonb;entry jsonb;path jsonb;seen uuid[]:='{}'::uuid[];current_id uuid;parent_id uuid;n integer:=0;
BEGIN
 SELECT * INTO root_d FROM public.estimate_drafts WHERE id=root_id;
 IF NOT FOUND OR root_d.tenant_id IS NULL OR root_d.client_id IS NULL THEN RAISE EXCEPTION 'A1_LINEAGE_CONTEXT_INVALID' USING ERRCODE='23514'; END IF;
 stack:=jsonb_build_array(jsonb_build_object('id',root_id,'path','[]'::jsonb));
 WHILE jsonb_array_length(stack)>0 LOOP
  entry:=stack->0;stack:=stack-0;current_id:=(entry->>'id')::uuid;path:=entry->'path';
  IF path @> jsonb_build_array(current_id::text) THEN RAISE EXCEPTION 'A1_LINEAGE_CYCLE' USING ERRCODE='23514';END IF;
  IF current_id=ANY(seen) THEN CONTINUE;END IF;
  n:=n+1;IF n>1000 THEN RAISE EXCEPTION 'A1_LINEAGE_LIMIT' USING ERRCODE='23514';END IF;
  SELECT * INTO d FROM public.estimate_drafts WHERE id=current_id FOR KEY SHARE;
  IF NOT FOUND OR d.tenant_id IS DISTINCT FROM root_d.tenant_id OR d.project_id IS DISTINCT FROM root_d.project_id OR d.client_id IS DISTINCT FROM root_d.client_id THEN RAISE EXCEPTION 'A1_LINEAGE_CONTEXT_INVALID' USING ERRCODE='23514';END IF;
  IF d.source IS NULL OR d.source NOT IN ('assembly_calculator','scope_draft','version','change_order') OR EXISTS(SELECT 1 FROM public.historical_estimate_imports h WHERE h.estimate_draft_id=d.id) THEN RAISE EXCEPTION 'A1_LINEAGE_SOURCE_INVALID' USING ERRCODE='23514';END IF;
  IF d.source='version' AND d.supersedes_id IS NULL OR d.source='change_order' AND d.change_order_of IS NULL THEN RAISE EXCEPTION 'A1_LINEAGE_PARENT_MISSING' USING ERRCODE='23514';END IF;
  seen:=array_append(seen,current_id);path:=path||jsonb_build_array(current_id::text);
  FOR parent_id IN SELECT DISTINCT p FROM unnest(ARRAY[d.supersedes_id,d.change_order_of]) AS p WHERE p IS NOT NULL ORDER BY p LOOP
   stack:=jsonb_build_array(jsonb_build_object('id',parent_id,'path',path))||stack;
  END LOOP;
 END LOOP;
END $$;

CREATE FUNCTION public.internal_approval_reject_mutation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'A1_EVIDENCE_IMMUTABLE: % on %',TG_OP,TG_TABLE_NAME USING ERRCODE='23514'; END $$;

-- Replace only the legacy guard function; retain its protection for old approved rows.
CREATE OR REPLACE FUNCTION public.structr_guard_approved_estimate() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE parent public.estimate_drafts;child public.estimate_drafts;has_evidence boolean;protected_old jsonb;protected_new jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.a1_version_request_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.estimate_drafts s WHERE s.supersedes_id=OLD.id AND s.a1_version_request_id IS NOT NULL) THEN RAISE EXCEPTION 'A1_VERSION_IDENTITY_PERMANENT' USING ERRCODE='23514';END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status IN ('approved','internally_approved','internal_approval_revoked') THEN RAISE EXCEPTION 'A1_DECISION_REQUIRES_REVIEWED_DRAFT' USING ERRCODE='23514';END IF;
  IF NEW.a1_version_request_id IS NOT NULL THEN
   SELECT * INTO parent FROM public.estimate_drafts WHERE id=NEW.supersedes_id FOR KEY SHARE;
   IF NOT FOUND OR parent.tenant_id IS DISTINCT FROM NEW.tenant_id OR parent.project_id IS DISTINCT FROM NEW.project_id OR parent.client_id IS DISTINCT FROM NEW.client_id OR parent.superseded_by IS NOT NULL THEN RAISE EXCEPTION 'A1_VERSION_PARENT_INVALID' USING ERRCODE='23514';END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.status='approved' AND OLD.status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'A1_LEGACY_APPROVAL_WRITE_DISABLED' USING ERRCODE='23514';END IF;
 IF OLD.a1_version_request_id IS NOT NULL AND (to_jsonb(OLD)-ARRAY['status','version','estimate_id','draft_data','bundle_name','zone','finish_level','trade','pricing_schema_version','channel','region','coastal_modifier','subtotal_price','subtotal_cost','final_total_price','discount_applied','discount_amount','gross_profit','gross_profit_pct','profit_shield_passed','profit_shield_min_pct','assembly_selections','line_items','intake_form_id','warnings_json','scope_draft_id','notes','metadata','bundle_id','assembly_count','approved_by','approved_at','rejected_by','rejected_at','rejection_reason','created_at','updated_at','superseded_by','locked_at','change_order_of','change_order_reason','commercial_channel','profit_shield_floor_pct','profit_shield_evaluation','pricing_snapshot']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','version','estimate_id','draft_data','bundle_name','zone','finish_level','trade','pricing_schema_version','channel','region','coastal_modifier','subtotal_price','subtotal_cost','final_total_price','discount_applied','discount_amount','gross_profit','gross_profit_pct','profit_shield_passed','profit_shield_min_pct','assembly_selections','line_items','intake_form_id','warnings_json','scope_draft_id','notes','metadata','bundle_id','assembly_count','approved_by','approved_at','rejected_by','rejected_at','rejection_reason','created_at','updated_at','superseded_by','locked_at','change_order_of','change_order_reason','commercial_channel','profit_shield_floor_pct','profit_shield_evaluation','pricing_snapshot']) THEN RAISE EXCEPTION 'A1_VERSION_REQUEST_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF OLD.a1_version_request_id IS NULL AND NEW.a1_version_request_id IS NOT NULL THEN RAISE EXCEPTION 'A1_VERSION_REQUEST_INSERT_ONLY' USING ERRCODE='23514';END IF;
 SELECT * INTO child FROM public.estimate_drafts WHERE supersedes_id=OLD.id AND a1_version_request_id IS NOT NULL;
 IF FOUND AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.superseded_by IS DISTINCT FROM child.id) THEN RAISE EXCEPTION 'A1_VERSION_BACKPOINTER_IMMUTABLE' USING ERRCODE='23514';END IF;
 has_evidence:=EXISTS(SELECT 1 FROM public.estimate_internal_approval_snapshots WHERE estimate_draft_id=OLD.id);
 IF has_evidence OR OLD.status IN ('internally_approved','internal_approval_revoked') THEN
  protected_old:=to_jsonb(OLD)-ARRAY['notes','updated_at','superseded_by','status'];protected_new:=to_jsonb(NEW)-ARRAY['notes','updated_at','superseded_by','status'];
  IF protected_old IS DISTINCT FROM protected_new OR (NEW.status IS DISTINCT FROM OLD.status AND NOT(OLD.status='internally_approved' AND NEW.status='internal_approval_revoked')) THEN RAISE EXCEPTION 'A1_APPROVED_DRAFT_IMMUTABLE' USING ERRCODE='23514';END IF;
  IF NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN
   IF OLD.superseded_by IS NOT NULL OR NEW.superseded_by IS NULL THEN RAISE EXCEPTION 'A1_VERSION_BACKPOINTER_IMMUTABLE' USING ERRCODE='23514';END IF;
  END IF;
 ELSIF NEW.status IN ('internally_approved','internal_approval_revoked') THEN
  IF OLD.status<>'draft' OR NEW.status<>'internally_approved' OR OLD.superseded_by IS NOT NULL OR (to_jsonb(NEW)-ARRAY['status','approved_by','approved_at','locked_at','profit_shield_evaluation','profit_shield_passed','profit_shield_min_pct','profit_shield_floor_pct','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','approved_by','approved_at','locked_at','profit_shield_evaluation','profit_shield_passed','profit_shield_min_pct','profit_shield_floor_pct','updated_at']) THEN RAISE EXCEPTION 'A1_INITIAL_APPROVAL_CONTENT_CHANGED' USING ERRCODE='23514';END IF;
 END IF;
 IF OLD.status='approved' AND (NEW.final_total_price IS DISTINCT FROM OLD.final_total_price OR NEW.subtotal_price IS DISTINCT FROM OLD.subtotal_price OR NEW.subtotal_cost IS DISTINCT FROM OLD.subtotal_cost OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount OR NEW.line_items IS DISTINCT FROM OLD.line_items OR NEW.assembly_selections IS DISTINCT FROM OLD.assembly_selections OR NEW.version IS DISTINCT FROM OLD.version) THEN RAISE EXCEPTION 'ESTIMATE_VERSION_LOCKED' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.internal_approval_check_final_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE target uuid;d public.estimate_drafts;s public.estimate_internal_approval_snapshots;a public.estimate_internal_approvals;r public.estimate_internal_approval_revocations;child public.estimate_drafts;parent public.estimate_drafts;initial_evidence boolean:=TG_TABLE_NAME IN ('estimate_internal_approval_snapshots','estimate_internal_approvals');
BEGIN
 IF TG_TABLE_NAME='estimate_drafts' THEN target:=NEW.id;ELSE target:=NEW.estimate_draft_id;END IF;
 SELECT * INTO d FROM public.estimate_drafts WHERE id=target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'A1_DRAFT_MISSING' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM public.estimate_internal_approval_snapshots WHERE estimate_draft_id=target;
 SELECT * INTO a FROM public.estimate_internal_approvals WHERE estimate_draft_id=target;
 SELECT * INTO r FROM public.estimate_internal_approval_revocations WHERE estimate_draft_id=target;
 IF s.id IS NULL AND a.id IS NULL AND r.id IS NULL THEN
  IF d.status IN ('internally_approved','internal_approval_revoked') THEN RAISE EXCEPTION 'A1_DECISION_PAIR_MISSING' USING ERRCODE='23514';END IF;
 ELSE
  IF s.id IS NULL OR a.id IS NULL OR a.snapshot_id<>s.id OR a.approved_by<>s.captured_by OR a.approved_at<>s.created_at OR d.version<>s.draft_version OR d.approved_by IS DISTINCT FROM a.approved_by OR d.approved_at IS DISTINCT FROM a.approved_at OR d.locked_at IS DISTINCT FROM a.approved_at OR (r.id IS NULL AND d.status<>'internally_approved') OR (r.id IS NOT NULL AND (d.status<>'internal_approval_revoked' OR r.revoked_at<a.approved_at)) THEN RAISE EXCEPTION 'A1_DECISION_STATE_MISMATCH' USING ERRCODE='23514';END IF;
  IF public.internal_approval_draft_matches_v1(d,s.snapshot_payload,initial_evidence) IS NOT TRUE THEN RAISE EXCEPTION 'A1_DRAFT_SNAPSHOT_MISMATCH' USING ERRCODE='23514';END IF;
  PERFORM public.internal_approval_check_lineage_v1(d.id);
 END IF;
 IF d.a1_version_request_id IS NOT NULL THEN
  SELECT * INTO parent FROM public.estimate_drafts WHERE id=d.supersedes_id FOR KEY SHARE;
  IF NOT FOUND OR parent.tenant_id IS DISTINCT FROM d.tenant_id OR parent.project_id IS DISTINCT FROM d.project_id OR parent.client_id IS DISTINCT FROM d.client_id OR parent.superseded_by IS DISTINCT FROM d.id THEN RAISE EXCEPTION 'A1_VERSION_CONTEXT_MISMATCH' USING ERRCODE='23514';END IF;
  PERFORM public.internal_approval_check_lineage_v1(d.id);
 END IF;
 SELECT * INTO child FROM public.estimate_drafts WHERE supersedes_id=d.id AND a1_version_request_id IS NOT NULL;
 IF FOUND AND (child.tenant_id IS DISTINCT FROM d.tenant_id OR child.project_id IS DISTINCT FROM d.project_id OR child.client_id IS DISTINCT FROM d.client_id OR d.superseded_by IS DISTINCT FROM child.id) THEN RAISE EXCEPTION 'A1_VERSION_CONTEXT_MISMATCH' USING ERRCODE='23514';END IF;
 IF s.id IS NOT NULL AND d.superseded_by IS NOT NULL AND (child.id IS NULL OR child.id<>d.superseded_by) THEN RAISE EXCEPTION 'A1_VERSION_SUCCESSOR_MISSING' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_guard_approved_estimate ON public.estimate_drafts;
CREATE TRIGGER trg_guard_approved_estimate BEFORE INSERT OR UPDATE OR DELETE ON public.estimate_drafts FOR EACH ROW EXECUTE FUNCTION public.structr_guard_approved_estimate();
CREATE CONSTRAINT TRIGGER a1_draft_final AFTER INSERT OR UPDATE ON public.estimate_drafts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.internal_approval_check_final_v1();
CREATE CONSTRAINT TRIGGER a1_snapshot_final AFTER INSERT ON public.estimate_internal_approval_snapshots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.internal_approval_check_final_v1();
CREATE CONSTRAINT TRIGGER a1_approval_final AFTER INSERT ON public.estimate_internal_approvals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.internal_approval_check_final_v1();
CREATE CONSTRAINT TRIGGER a1_revocation_final AFTER INSERT ON public.estimate_internal_approval_revocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.internal_approval_check_final_v1();

CREATE TRIGGER a1_snapshot_immutable BEFORE UPDATE OR DELETE ON public.estimate_internal_approval_snapshots FOR EACH ROW EXECUTE FUNCTION public.internal_approval_reject_mutation_v1();
CREATE TRIGGER a1_approval_immutable BEFORE UPDATE OR DELETE ON public.estimate_internal_approvals FOR EACH ROW EXECUTE FUNCTION public.internal_approval_reject_mutation_v1();
CREATE TRIGGER a1_revocation_immutable BEFORE UPDATE OR DELETE ON public.estimate_internal_approval_revocations FOR EACH ROW EXECUTE FUNCTION public.internal_approval_reject_mutation_v1();
CREATE TRIGGER a1_snapshot_no_truncate BEFORE TRUNCATE ON public.estimate_internal_approval_snapshots FOR EACH STATEMENT EXECUTE FUNCTION public.internal_approval_reject_mutation_v1();
CREATE TRIGGER a1_approval_no_truncate BEFORE TRUNCATE ON public.estimate_internal_approvals FOR EACH STATEMENT EXECUTE FUNCTION public.internal_approval_reject_mutation_v1();
CREATE TRIGGER a1_revocation_no_truncate BEFORE TRUNCATE ON public.estimate_internal_approval_revocations FOR EACH STATEMENT EXECUTE FUNCTION public.internal_approval_reject_mutation_v1();

-- Ratified hardening: these tables only; no global defaults, roles or positive grants.
REVOKE ALL PRIVILEGES ON TABLE public.estimate_internal_approval_snapshots,public.estimate_internal_approvals,public.estimate_internal_approval_revocations FROM PUBLIC;
DO $acl$
DECLARE api_role text;table_name text;api_oid oid;reachable_role record;
BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=api_role) THEN
   FOREACH table_name IN ARRAY ARRAY['estimate_internal_approval_snapshots','estimate_internal_approvals','estimate_internal_approval_revocations'] LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',table_name,api_role);
   END LOOP;
  END IF;
 END LOOP;
 -- Refuse inherited, column-level and SET ROLE access rather than rewriting the
 -- role graph or global defaults. Unknown runtime principals remain a release gate.
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  SELECT oid INTO api_oid FROM pg_catalog.pg_roles WHERE rolname=api_role;
  IF api_oid IS NULL THEN CONTINUE;END IF;
  FOR reachable_role IN SELECT oid FROM pg_catalog.pg_roles WHERE oid=api_oid OR pg_catalog.pg_has_role(api_oid,oid,'SET') LOOP
   FOREACH table_name IN ARRAY ARRAY['estimate_internal_approval_snapshots','estimate_internal_approvals','estimate_internal_approval_revocations'] LOOP
    IF pg_catalog.has_table_privilege(reachable_role.oid,format('public.%I',table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR pg_catalog.has_any_column_privilege(reachable_role.oid,format('public.%I',table_name),'SELECT,INSERT,UPDATE,REFERENCES') THEN
     RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='internal_approval_api_acl',MESSAGE='Internal approval API access remains through effective role privileges';
    END IF;
   END LOOP;
  END LOOP;
 END LOOP;
END $acl$;
