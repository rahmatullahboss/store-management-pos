BEGIN;

CREATE OR REPLACE FUNCTION platform.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION platform.current_actor_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION platform.current_business_date() RETURNS date
LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULLIF(current_setting('app.business_date', true), '')::date $$;
CREATE OR REPLACE FUNCTION platform.current_request_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULLIF(current_setting('app.request_id', true), '') $$;
CREATE OR REPLACE FUNCTION platform.current_trace_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULLIF(current_setting('app.trace_id', true), '') $$;

CREATE OR REPLACE FUNCTION platform.set_request_context(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_legal_entity_id uuid DEFAULT NULL,
  p_store_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_register_id uuid DEFAULT NULL,
  p_business_date date DEFAULT CURRENT_DATE,
  p_request_id text DEFAULT '',
  p_trace_id text DEFAULT ''
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, platform AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_actor_id IS NULL THEN RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  PERFORM set_config('app.actor_id', p_actor_id::text, true);
  PERFORM set_config('app.legal_entity_id', COALESCE(p_legal_entity_id::text, ''), true);
  PERFORM set_config('app.store_id', COALESCE(p_store_id::text, ''), true);
  PERFORM set_config('app.warehouse_id', COALESCE(p_warehouse_id::text, ''), true);
  PERFORM set_config('app.register_id', COALESCE(p_register_id::text, ''), true);
  PERFORM set_config('app.business_date', p_business_date::text, true);
  PERFORM set_config('app.request_id', p_request_id, true);
  PERFORM set_config('app.trace_id', p_trace_id, true);
END $$;

CREATE OR REPLACE FUNCTION platform.reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000'; END $$;

DROP TRIGGER IF EXISTS audit_events_append_only ON platform.audit_events;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON platform.audit_events FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION platform.protect_outbox_payload() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.event_type IS DISTINCT FROM NEW.event_type
     OR OLD.aggregate_type IS DISTINCT FROM NEW.aggregate_type OR OLD.aggregate_id IS DISTINCT FROM NEW.aggregate_id
     OR OLD.schema_version IS DISTINCT FROM NEW.schema_version OR OLD.payload IS DISTINCT FROM NEW.payload
     OR OLD.metadata IS DISTINCT FROM NEW.metadata OR OLD.correlation_id IS DISTINCT FROM NEW.correlation_id
     OR OLD.causation_id IS DISTINCT FROM NEW.causation_id OR OLD.occurred_at IS DISTINCT FROM NEW.occurred_at
     OR OLD.business_date IS DISTINCT FROM NEW.business_date THEN
    RAISE EXCEPTION 'outbox event content is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS outbox_payload_immutable ON platform.outbox_events;
CREATE TRIGGER outbox_payload_immutable BEFORE UPDATE ON platform.outbox_events FOR EACH ROW EXECUTE FUNCTION platform.protect_outbox_payload();
DROP TRIGGER IF EXISTS outbox_delete_forbidden ON platform.outbox_events;
CREATE TRIGGER outbox_delete_forbidden BEFORE DELETE ON platform.outbox_events FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'legal_entities','stores','warehouses','registers','memberships','roles','membership_roles',
    'approval_requests','approval_actions','devices','register_device_bindings','entitlements',
    'support_impersonation_sessions','audit_events','idempotency_records','outbox_events',
    'inbox_receipts','dead_letter_records','workflow_jobs'
  ] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON platform.%I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON platform.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())', table_name);
  END LOOP;
END $rls$;

ALTER TABLE platform.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_tenant_membership ON platform.users;
CREATE POLICY user_tenant_membership ON platform.users
  USING (EXISTS (
    SELECT 1 FROM platform.memberships membership
    WHERE membership.user_id = users.id
      AND membership.tenant_id = platform.current_tenant_id()
  ));

DROP POLICY IF EXISTS tenant_isolation ON platform.roles;
CREATE POLICY tenant_isolation ON platform.roles
  USING (tenant_id IS NULL OR tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.tenants;
CREATE POLICY tenant_isolation ON platform.tenants USING (id = platform.current_tenant_id()) WITH CHECK (id = platform.current_tenant_id());

REVOKE ALL ON FUNCTION platform.set_request_context(uuid,uuid,uuid,uuid,uuid,uuid,date,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.set_request_context(uuid,uuid,uuid,uuid,uuid,uuid,date,text,text) TO store_app_runtime, store_app_reporting;
GRANT EXECUTE ON FUNCTION platform.current_tenant_id(), platform.current_actor_id(), platform.current_business_date(), platform.current_request_id(), platform.current_trace_id() TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum) VALUES ('FND-0002','FOUNDATION','manifest:FND-0002-rls.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
