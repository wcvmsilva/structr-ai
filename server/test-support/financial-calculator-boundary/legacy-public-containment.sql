-- TEST-ONLY prerequisite for the independently approved ADR-002 boundary.
-- Exact legacy business names; no ALL FUNCTIONS/TABLES sweep and no drift repair.
-- The harness first proves the uncontained legacy installation is refused.
DO $containment$
DECLARE item record; names text[] := ARRAY[
    'a1_export_authority_null_required_v1','a1_export_client_null_required_v1',
    'a1_export_csv_exclusive_code_v1','a1_export_exact_amount_minor_v1','a1_export_exact_two_decimal_v1',
    'a1_export_issue_class_rank_v1','a1_export_issue_order_valid_v1','a1_export_issue_reconciliation_state_v1',
    'a1_export_issue_status_class_v1','a1_export_issue_totals_class_v1','a1_export_issue_validation_state_v1',
    'historical_estimate_check_import_set','historical_estimate_check_source_set',
    'historical_estimate_reject_mutation','historical_estimate_valid_reconciliation',
    'internal_approval_channel_v1','internal_approval_check_final_v1','internal_approval_check_lineage_v1',
    'internal_approval_draft_matches_v1','internal_approval_evaluation_shape_v1',
    'internal_approval_historical_project_witness_v1','internal_approval_historical_recorded_lineage_v1',
    'internal_approval_legacy_number_v1','internal_approval_lookup_key_v1','internal_approval_matches_v1',
    'internal_approval_membership_parent_version_v1','internal_approval_policy_parent_version_v1',
    'internal_approval_pricing_channel_v1','internal_approval_reject_mutation_v1',
    'internal_approval_snapshot_shape_v1','internal_approval_trim_v1','internal_approval_valid_snapshot_v1',
    'internal_estimate_export_valid_manifest_v1','jobtread_export_a1_check_final_v1',
    'jobtread_export_a1_immutability_guard_v1','jobtread_export_a1_insert_guard_v1',
    'project_reopen_child_certify_v1','project_reopen_provenance_guard_v1','structr_guard_actual_immutable',
    'structr_guard_approved_estimate','structr_guard_audit_log_append_only',
    'structr_guard_calibration_event_actioned','structr_guard_closeout_closed','structr_guard_field_task_terminal',
    'structr_guard_mandatory_feature_flags','structr_guard_price_adjustment_transition','structr_touch_updated_at'];
BEGIN
  IF (SELECT count(DISTINCT p.proname) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(names))<>47 THEN
    RAISE EXCEPTION 'LAB_LEGACY_INVENTORY_MISMATCH';
  END IF;
  FOR item IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(names) LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', item.signature);
  END LOOP;
END $containment$;
REVOKE USAGE ON SCHEMA public FROM PUBLIC;

-- Exact pgcrypto overloads installed by migration 0005, separately contained.
REVOKE EXECUTE ON FUNCTION public.armor(bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.armor(bytea,text[],text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crypt(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dearmor(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrypt(bytea,bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrypt_iv(bytea,bytea,bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.digest(bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.digest(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.encrypt(bytea,bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.encrypt_iv(bytea,bytea,bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gen_random_bytes(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gen_salt(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gen_salt(text,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hmac(bytea,bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hmac(text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_armor_headers(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_key_id(bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_pub_decrypt(bytea,bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_pub_decrypt(bytea,bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_pub_decrypt(bytea,bytea,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_pub_decrypt_bytea(bytea,bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_pub_decrypt_bytea(bytea,bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_pub_decrypt_bytea(bytea,bytea,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_pub_encrypt(text,bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_pub_encrypt(text,bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_pub_encrypt_bytea(bytea,bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_pub_encrypt_bytea(bytea,bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_sym_decrypt(bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_sym_decrypt(bytea,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_sym_decrypt_bytea(bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_sym_decrypt_bytea(bytea,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_sym_encrypt(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_sym_encrypt(text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_sym_encrypt_bytea(bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgp_sym_encrypt_bytea(bytea,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gen_random_uuid() FROM PUBLIC;

-- Explicit database prerequisite: new SQL login must not inherit temporary-table creation.
REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC;
