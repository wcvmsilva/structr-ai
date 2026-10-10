-- TEST ONLY. Fixed synthetic context and narrow proof under production owner grants.
INSERT INTO public.tenants(id,name,slug) VALUES('30000000-0000-4000-8000-000000000001','Boundary lab','boundary-lab');
INSERT INTO public.profiles(id,tenant_id,external_open_id,full_name,role) VALUES('30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','Boundary operator','admin');
INSERT INTO public.clients(id,tenant_id,name) VALUES('30000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','Boundary client');
INSERT INTO public.projects(id,tenant_id,client_id,owner_user_id,name,project_type) VALUES('30000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000002','Boundary project','repair');
INSERT INTO public.intake_forms(id,tenant_id,project_id,form_data) VALUES('30000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000005','{}');
INSERT INTO public.audit_logs(id,user_id,action,table_name,record_id,new_values) VALUES('30000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000002','test.fixture','calculator_fixtures','30000000-0000-4000-8000-000000000008','{}');
INSERT INTO structr_financial.principal_bindings(id,session_role,subject,actor_id,tenant_id,operations) VALUES('30000000-0000-4000-8000-000000000009','structr_calculator_login_v1','30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',ARRAY['calculator.context','calculator.calculate','calculator.create','calculator.recover']);
INSERT INTO structr_financial.calculator_fixtures(id,binding_id,tenant_id,actor_id,project_id,intake_form_id,client_id,manifest,manifest_hash,provenance_audit_id) VALUES('30000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000004','{}',repeat('a',64),'30000000-0000-4000-8000-000000000007');
CREATE SCHEMA financial_boundary_probe;
REVOKE ALL ON SCHEMA financial_boundary_probe FROM PUBLIC;
GRANT USAGE ON SCHEMA financial_boundary_probe TO structr_calculator_login_v1,structr_calculator_write_owner_v1;
GRANT CREATE ON SCHEMA financial_boundary_probe TO structr_calculator_write_owner_v1;
CREATE FUNCTION financial_boundary_probe.unflushed(target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b structr_financial.principal_bindings;f structr_financial.calculator_fixtures;d public.estimate_drafts;
BEGIN
 SELECT * INTO STRICT b FROM structr_financial.principal_bindings WHERE session_role=session_user FOR SHARE;
 SELECT * INTO STRICT f FROM structr_financial.calculator_fixtures WHERE binding_id=b.id FOR SHARE;
 
 INSERT INTO public.estimate_drafts(id,tenant_id,project_id,client_id,intake_form_id,created_by,status,source,version)
 VALUES(target,b.tenant_id,f.project_id,f.client_id,f.intake_form_id,b.actor_id,'draft','assembly_calculator',1);
 
 SELECT * INTO STRICT d FROM public.estimate_drafts WHERE id=target;
 INSERT INTO public.audit_logs(user_id,action,table_name,record_id,old_values,new_values)
 VALUES(b.actor_id,'test.calculator_draft.create','estimate_drafts',target,NULL,to_jsonb(d));
 RETURN jsonb_build_object('draft',to_jsonb(d),'pid',pg_backend_pid(),'txid',txid_current()::text,'session',session_user,'owner',current_user);
END $$;
REVOKE ALL ON FUNCTION financial_boundary_probe.unflushed(uuid) FROM PUBLIC;
ALTER FUNCTION financial_boundary_probe.unflushed(uuid) OWNER TO structr_calculator_write_owner_v1;
GRANT EXECUTE ON FUNCTION financial_boundary_probe.unflushed(uuid) TO structr_calculator_login_v1;
CREATE FUNCTION financial_boundary_probe.write_draft(target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b structr_financial.principal_bindings;f structr_financial.calculator_fixtures;d public.estimate_drafts;
BEGIN
 SELECT * INTO STRICT b FROM structr_financial.principal_bindings WHERE session_role=session_user FOR SHARE;
 SELECT * INTO STRICT f FROM structr_financial.calculator_fixtures WHERE binding_id=b.id FOR SHARE;
 SET CONSTRAINTS public.a1_draft_final DEFERRED;
 INSERT INTO public.estimate_drafts(id,tenant_id,project_id,client_id,intake_form_id,created_by,status,source,version)
 VALUES(target,b.tenant_id,f.project_id,f.client_id,f.intake_form_id,b.actor_id,'draft','assembly_calculator',1);
 SET CONSTRAINTS public.a1_draft_final IMMEDIATE;
 SELECT * INTO STRICT d FROM public.estimate_drafts WHERE id=target;
 INSERT INTO public.audit_logs(user_id,action,table_name,record_id,old_values,new_values)
 VALUES(b.actor_id,'test.calculator_draft.create','estimate_drafts',target,NULL,to_jsonb(d));
 RETURN jsonb_build_object('draft',to_jsonb(d),'pid',pg_backend_pid(),'txid',txid_current()::text,'session',session_user,'owner',current_user);
END $$;
REVOKE ALL ON FUNCTION financial_boundary_probe.write_draft(uuid) FROM PUBLIC;
ALTER FUNCTION financial_boundary_probe.write_draft(uuid) OWNER TO structr_calculator_write_owner_v1;
GRANT EXECUTE ON FUNCTION financial_boundary_probe.write_draft(uuid) TO structr_calculator_login_v1;
REVOKE CREATE ON SCHEMA financial_boundary_probe FROM structr_calculator_write_owner_v1;

-- Test-only initial mode control; production login intentionally lacks public USAGE.
GRANT CREATE ON SCHEMA financial_boundary_probe TO structr_calculator_write_owner_v1;
CREATE FUNCTION financial_boundary_probe.initial_mode(immediate boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN IF immediate THEN SET CONSTRAINTS public.a1_draft_final IMMEDIATE; ELSE SET CONSTRAINTS public.a1_draft_final DEFERRED; END IF; END $$;
REVOKE ALL ON FUNCTION financial_boundary_probe.initial_mode(boolean) FROM PUBLIC;
ALTER FUNCTION financial_boundary_probe.initial_mode(boolean) OWNER TO structr_calculator_write_owner_v1;
GRANT EXECUTE ON FUNCTION financial_boundary_probe.initial_mode(boolean) TO structr_calculator_login_v1;
REVOKE CREATE ON SCHEMA financial_boundary_probe FROM structr_calculator_write_owner_v1;
