-- TEST ONLY, temporarily installed per contradiction test then removed.
-- This privileged fixture creates structurally valid but unpaired evidence; the
-- real constraints stay enabled and the transaction must roll back every time.
CREATE FUNCTION financial_calculator_probe.stage_contradiction(target uuid,payload jsonb,evaluation jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b financial_calculator_probe.binding; snapshot_id uuid:=gen_random_uuid(); at_time timestamptz:='2026-09-19T12:00:00.123Z';
BEGIN
  SELECT * INTO STRICT b FROM financial_calculator_probe.binding WHERE login=session_user;
  INSERT INTO public.estimate_internal_approval_snapshots(id,tenant_id,project_id,client_id,estimate_draft_id,draft_version,
    contract_version,content_hash,currency_code,currency_basis,subtotal_price_minor,discount_minor,final_price_minor,
    estimated_cost_minor,policy_version,policy_hash,snapshot_payload,policy_evaluation,captured_by,created_at,updated_at)
  VALUES(snapshot_id,b.tenant,b.project,b.client,target,1,'internal-approval-snapshot-v1',repeat('a',64),'USD',
    'approver_confirmation',10000,0,10000,4000,'phase2-channel-geo-plus-tenant-exact-v1',repeat('b',64),payload,evaluation,
    b.actor,at_time,at_time);
  RETURN snapshot_id;
END $$;
REVOKE ALL ON FUNCTION financial_calculator_probe.stage_contradiction(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION financial_calculator_probe.stage_contradiction(uuid,jsonb,jsonb) TO app_runtime;

CREATE FUNCTION financial_calculator_probe.visible_evidence(target uuid) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT count(*)::integer FROM public.estimate_internal_approval_snapshots WHERE estimate_draft_id=target
$$;
ALTER FUNCTION financial_calculator_probe.visible_evidence(uuid) OWNER TO financial_probe_owner;
REVOKE ALL ON FUNCTION financial_calculator_probe.visible_evidence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION financial_calculator_probe.visible_evidence(uuid) TO app_runtime;

CREATE FUNCTION financial_calculator_probe.check_draft(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM financial_calculator_probe.assert_visibility();
  SET CONSTRAINTS public.a1_draft_final DEFERRED;
  UPDATE public.estimate_drafts SET id=id WHERE id=target;
  SET CONSTRAINTS public.a1_draft_final IMMEDIATE;
END $$;
ALTER FUNCTION financial_calculator_probe.check_draft(uuid) OWNER TO financial_probe_owner;
REVOKE ALL ON FUNCTION financial_calculator_probe.check_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION financial_calculator_probe.check_draft(uuid) TO app_runtime;
