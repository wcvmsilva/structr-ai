-- TEST FIXTURE ONLY. Deliberately narrow experiment, no deployment authority.
CREATE FUNCTION financial_calculator_probe.unflushed(target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b financial_calculator_probe.binding; d public.estimate_drafts;
BEGIN
  SELECT * INTO STRICT b FROM financial_calculator_probe.binding WHERE login=session_user;
  INSERT INTO public.estimate_drafts(id,tenant_id,project_id,client_id,created_by,status,source,version)
    VALUES(target,b.tenant,b.project,b.client,b.actor,'draft','assembly_calculator',1);
  SELECT * INTO STRICT d FROM public.estimate_drafts WHERE id=target;
  RETURN jsonb_build_object('id',target,'session',session_user,'owner',current_user,'row',to_jsonb(d),
    'pid',pg_backend_pid(),'txid',txid_current()::text,'isolation',current_setting('transaction_isolation'));
END $$;
ALTER FUNCTION financial_calculator_probe.unflushed(uuid) OWNER TO financial_probe_owner;
REVOKE ALL ON FUNCTION financial_calculator_probe.unflushed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION financial_calculator_probe.unflushed(uuid) TO app_runtime;

-- Deliberately fixture-specific RLS witness. This is NOT a production ACL/policy
-- preflight: it only rejects deviations from the three policies installed here.
CREATE FUNCTION financial_calculator_probe.assert_visibility() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE relation regclass;
BEGIN
  FOREACH relation IN ARRAY ARRAY['public.estimate_internal_approval_snapshots'::regclass,
    'public.estimate_internal_approvals'::regclass,'public.estimate_internal_approval_revocations'::regclass] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=relation)
      OR (SELECT count(*) FROM pg_policy WHERE polrelid=relation)<>1
      OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=relation AND polname='financial_probe_read'
        AND polcmd='r' AND polpermissive AND polroles=ARRAY['financial_probe_owner'::regrole::oid]
        AND pg_get_expr(polqual,polrelid)='true' AND polwithcheck IS NULL) THEN
      RAISE EXCEPTION 'FINANCIAL_PROBE_VISIBILITY_UNPROVEN' USING ERRCODE='42501';
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION financial_calculator_probe.assert_visibility() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION financial_calculator_probe.assert_visibility() TO financial_probe_owner;

-- Flush the existing guard while its required privileges are still active.
CREATE FUNCTION financial_calculator_probe.write_draft(target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b financial_calculator_probe.binding; d public.estimate_drafts;
BEGIN
  PERFORM financial_calculator_probe.assert_visibility();
  SELECT * INTO STRICT b FROM financial_calculator_probe.binding WHERE login=session_user;
  SET CONSTRAINTS public.a1_draft_final DEFERRED;
  INSERT INTO public.estimate_drafts(id,tenant_id,project_id,client_id,created_by,status,source,version)
    VALUES(target,b.tenant,b.project,b.client,b.actor,'draft','assembly_calculator',1);
  SET CONSTRAINTS public.a1_draft_final IMMEDIATE;
  SELECT * INTO STRICT d FROM public.estimate_drafts WHERE id=target;
  RETURN jsonb_build_object('id',target,'session',session_user,'owner',current_user,'row',to_jsonb(d),
    'pid',pg_backend_pid(),'txid',txid_current()::text,'isolation',current_setting('transaction_isolation'));
END $$;
ALTER FUNCTION financial_calculator_probe.write_draft(uuid) OWNER TO financial_probe_owner;
REVOKE ALL ON FUNCTION financial_calculator_probe.write_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION financial_calculator_probe.write_draft(uuid) TO app_runtime;
