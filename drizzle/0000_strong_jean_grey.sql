CREATE TABLE "assemblies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"default_unit_id" uuid,
	"base_unit_qty" numeric DEFAULT '1.00',
	"waste_factor" numeric DEFAULT '0.10',
	"region" text DEFAULT 'charleston_sc' NOT NULL,
	"code" text,
	"trade" text,
	"finish_level" text,
	"coastal_modifier" numeric,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assembly_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"cost_type_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"description" text,
	"default_qty_per_unit" numeric DEFAULT '1.0' NOT NULL,
	"waste_factor" numeric,
	"price_book_item" uuid,
	"component_type" text,
	"unit_cost_override" numeric,
	"is_optional" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assembly_performance_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_id" uuid NOT NULL,
	"project_count" integer DEFAULT 0 NOT NULL,
	"avg_actual_cost" numeric,
	"avg_estimated_cost" numeric,
	"cost_variance_percent" numeric,
	"assembly_name" text,
	"avg_variance_pct" numeric,
	"overrun_count" integer DEFAULT 0,
	"underrun_count" integer DEFAULT 0,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid,
	"old_values" jsonb,
	"new_values" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "boq_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"sku_vendor" text,
	"vendor" text DEFAULT 'other',
	"uom" text DEFAULT 'EA',
	"qty" double precision NOT NULL,
	"unit_cost" numeric,
	"unit_price" numeric,
	"waste_pct" numeric,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bundle_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bundle_id" uuid NOT NULL,
	"assembly_id" uuid NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"override_qty" numeric,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"bundle_discount" numeric DEFAULT '0.08' NOT NULL,
	"region" text DEFAULT 'Charleston, SC' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_customizable" boolean DEFAULT true NOT NULL,
	"min_items" integer DEFAULT 2,
	"max_items" integer DEFAULT 20,
	"valid_from" date,
	"valid_until" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cost_code_id" uuid,
	"issue_name" text NOT NULL,
	"current_value" numeric,
	"suggested_value" numeric,
	"reasoning" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_multipliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"multiplier" numeric NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"company" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_code_pricing_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"unit_id" uuid,
	"unit_cost" numeric NOT NULL,
	"unit_price" numeric,
	"source" text DEFAULT 'manual',
	"notes" text,
	"effective_date" date NOT NULL,
	"expiration_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"unit_cost_material" numeric,
	"unit_cost_labor" numeric,
	"taxable" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "cost_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"is_parent" boolean DEFAULT false NOT NULL,
	"default_cost_type_id" uuid,
	"default_unit_id" uuid,
	"jobtread_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nahb_code" text,
	"irc_reference" text,
	"coastal_notes" text,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "cost_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"default_margin" numeric DEFAULT '0.30' NOT NULL,
	"is_taxable" boolean DEFAULT false NOT NULL,
	"is_time_trackable" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"jobtread_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taxable" boolean DEFAULT false,
	"time_trackable" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "crew_velocity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"crew_size" integer DEFAULT 2 NOT NULL,
	"unit_id" uuid NOT NULL,
	"output_per_hour" numeric NOT NULL,
	"output_per_day" numeric,
	"conditions" text DEFAULT 'standard',
	"difficulty_factor" numeric DEFAULT '1.00',
	"region" text DEFAULT 'charleston_sc' NOT NULL,
	"season" text DEFAULT 'all',
	"source" text DEFAULT 'field_data',
	"notes" text,
	"recorded_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"activity_type" text NOT NULL,
	"description" text,
	"performed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"previous_stage" text,
	"new_stage" text NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"name" text NOT NULL,
	"stage" text DEFAULT 'discovery' NOT NULL,
	"value" numeric,
	"closure_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimate_id" uuid,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text,
	"draft_data" jsonb,
	"bundle_name" text,
	"zone" text,
	"finish_level" text,
	"trade" text,
	"pricing_schema_version" text,
	"channel" text,
	"region" text,
	"created_by" uuid,
	"coastal_modifier" numeric,
	"subtotal_price" numeric,
	"subtotal_cost" numeric,
	"final_total_price" numeric,
	"discount_applied" boolean DEFAULT false,
	"discount_amount" numeric,
	"gross_profit" numeric,
	"gross_profit_pct" numeric,
	"profit_shield_passed" boolean,
	"profit_shield_min_pct" numeric,
	"assembly_selections" jsonb,
	"line_items" jsonb,
	"intake_form_id" uuid,
	"warnings_json" jsonb,
	"scope_draft_id" uuid,
	"notes" text,
	"metadata" jsonb,
	"bundle_id" uuid,
	"client_id" uuid,
	"assembly_count" integer,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"cost_type_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"assembly_id" uuid,
	"description" text,
	"quantity" numeric DEFAULT '0' NOT NULL,
	"unit_cost" numeric DEFAULT '0' NOT NULL,
	"unit_price" numeric DEFAULT '0' NOT NULL,
	"waste_pct" numeric,
	"margin_pct" numeric,
	"is_taxable" boolean DEFAULT false NOT NULL,
	"actual_cost" numeric,
	"actual_qty" numeric,
	"variance_cost" numeric,
	"variance_qty" numeric,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_variance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"estimate_item_id" uuid,
	"cost_code_id" uuid,
	"event_type" text NOT NULL,
	"estimated_value" numeric,
	"actual_value" numeric,
	"variance_pct" numeric,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"subtotal" numeric,
	"tax" numeric,
	"discount" numeric,
	"total" numeric,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_feedback_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"feedback_type" text NOT NULL,
	"issue_category" text,
	"description" text NOT NULL,
	"attachments" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finish_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" text NOT NULL,
	"trade" text,
	"multiplier" numeric DEFAULT '1.0' NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geo_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"boundary_geojson" jsonb,
	"cost_multiplier" numeric DEFAULT '1.0' NOT NULL,
	"zone_name" text,
	"county" text,
	"zip_codes" text[],
	"center_lat" double precision,
	"center_lng" double precision,
	"radius_miles" numeric,
	"coastal_exposure_level" text,
	"labor_modifier" numeric,
	"material_modifier" numeric,
	"logistics_modifier" numeric,
	"logistics_complexity" text,
	"contingency_pct" numeric,
	"min_profit_shield_pct" numeric,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geographic_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid,
	"assembly_id" uuid,
	"cost_code_id" uuid,
	"override_type" text NOT NULL,
	"override_value" numeric,
	"reason" text,
	"zone" text,
	"trade" text,
	"finish_level" text,
	"reason_template" text,
	"original_assembly_id" uuid,
	"replacement_assembly_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"project_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"form_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"activity_type" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"subtotal" numeric,
	"tax" numeric,
	"discount" numeric,
	"total" numeric,
	"terms" text,
	"options_json" jsonb DEFAULT '[]',
	"signature_url" text,
	"status" text DEFAULT 'draft',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'web',
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"service" text DEFAULT 'roof',
	"urgency" text DEFAULT 'medium',
	"lead_score" integer DEFAULT 0,
	"status" text DEFAULT 'new',
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tags" text[],
	"latitude" numeric,
	"longitude" numeric,
	"city" text,
	"state" text,
	"zip" text,
	"service_type" text DEFAULT 'general',
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "newcon_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"scope_json" jsonb,
	"default_finish_level" text DEFAULT 'standard',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parametric_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"model_type" text NOT NULL,
	"formula" jsonb,
	"variables" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_partial_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_draft_id" uuid,
	"pipeline_step" text,
	"partial_data" jsonb,
	"error_message" text,
	"error_code" text,
	"retry_count" integer DEFAULT 0,
	"max_retries" integer DEFAULT 3,
	"user_id" uuid,
	"recovered_estimate_id" uuid,
	"recovered_at" timestamp with time zone,
	"status" text DEFAULT 'partial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"company_name" text,
	"role" text DEFAULT 'user',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_actuals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"estimate_item_id" uuid,
	"actual_quantity" numeric,
	"actual_cost" numeric,
	"actual_labor_hours" numeric,
	"cost_code_id" uuid,
	"variance_pct" numeric,
	"is_high_variance" boolean DEFAULT false,
	"notes" text,
	"recorded_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text,
	"storage_path" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"client_name" text,
	"client_email" text,
	"address" text,
	"city" text DEFAULT 'Goose Creek',
	"state" text DEFAULT 'SC',
	"zip" text,
	"project_type" text NOT NULL,
	"channel" text DEFAULT 'premium',
	"status" text DEFAULT 'estimate' NOT NULL,
	"lead_id" uuid,
	"jobtread_id" text,
	"estimated_total" numeric,
	"actual_total" numeric,
	"variance_pct" numeric,
	"start_date" date,
	"end_date" date,
	"notes" text,
	"county" text,
	"zone" text,
	"region" text,
	"finish_level" text,
	"pricing_schema_version" text,
	"zone_modifier_snapshot" jsonb,
	"geocode_confidence" text,
	"geocode_source" text,
	"geocoded_address" text,
	"geocoded_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"sqft" integer,
	"bedrooms" integer,
	"bathrooms" numeric,
	"property_type" text,
	"year_built" integer,
	"lot_size" integer,
	"estimated_value" numeric,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"action" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now(),
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_name" text,
	"client_email" text,
	"filename" text,
	"storage_path" text NOT NULL,
	"signed_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regional_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region" text NOT NULL,
	"category" text NOT NULL,
	"multiplier" numeric NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regional_risk_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"region" text DEFAULT 'charleston_sc' NOT NULL,
	"risk_multiplier" numeric DEFAULT '1.00' NOT NULL,
	"description" text,
	"code_reference" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remodel_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"scope_json" jsonb,
	"default_finish_level" text DEFAULT 'standard',
	"service_type" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimate_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"action" text NOT NULL,
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "roof_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"polygon_geojson" jsonb NOT NULL,
	"area_projected_ft2" double precision,
	"pitch_rise_per_12" integer DEFAULT 6,
	"tilt_deg" double precision,
	"azimuth_deg" double precision,
	"source" text DEFAULT 'manual',
	"quality" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_draft_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_draft_id" uuid NOT NULL,
	"cost_code_id" uuid,
	"assembly_id" uuid,
	"assembly_name" text,
	"quantity" numeric,
	"unit" text,
	"reason" text,
	"confidence" numeric,
	"override_type" text,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" jsonb,
	"zone" text,
	"finish_level" text,
	"service_type" text,
	"channel" text,
	"confidence" numeric,
	"reason" text,
	"intake_form_id" uuid,
	"created_by" uuid,
	"retry_count" integer DEFAULT 0,
	"warnings_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_override_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_draft_id" uuid NOT NULL,
	"override_id" uuid,
	"original_assembly_id" uuid,
	"replacement_assembly_id" uuid,
	"override_type" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_review_deltas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_draft_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"delta_type" text NOT NULL,
	"action_type" text,
	"assembly_id" uuid,
	"cost_code_id" uuid,
	"field" text,
	"old_value" text,
	"new_value" text,
	"new_quantity" numeric,
	"previous_quantity" numeric,
	"reason" text,
	"operator_reason" text,
	"created_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_review_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_draft_id" uuid NOT NULL,
	"snapshot_data" jsonb,
	"approved_items" jsonb,
	"bundle_id" uuid,
	"delta_changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rule_definition" jsonb,
	"rule_code" text,
	"assembly_id" uuid,
	"channel" text,
	"finish_level" text,
	"zone" text,
	"service_type" text,
	"project_type" text,
	"reason_template" text,
	"quantity_formula" jsonb,
	"condition_json" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" text NOT NULL,
	"exception_type" text NOT NULL,
	"justification" text NOT NULL,
	"risk_level" text DEFAULT 'none',
	"created_at" timestamp with time zone DEFAULT now(),
	"reviewed_by" text,
	"approved_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "security_review_final" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_date" timestamp with time zone DEFAULT now(),
	"status" text DEFAULT 'COMPLETED',
	"summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "system_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_type" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}',
	"resolved" boolean DEFAULT false,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "system_issue_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"metadata" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setting_key" text NOT NULL,
	"setting_value" jsonb,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_setting_key_unique" UNIQUE("setting_key")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"abbreviation" text,
	"jobtread_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_perm_resource" ON "permissions" USING btree ("resource");--> statement-breakpoint
CREATE INDEX "idx_rp_role" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_rp_perm" ON "role_permissions" USING btree ("permission_id");