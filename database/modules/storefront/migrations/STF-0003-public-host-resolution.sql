BEGIN;

CREATE TABLE IF NOT EXISTS storefront.domain_sales_channel_bindings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  domain_id uuid NOT NULL,
  storefront_id uuid NOT NULL,
  sales_channel_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, domain_id),
  FOREIGN KEY (tenant_id, domain_id) REFERENCES storefront.domains(tenant_id, id),
  FOREIGN KEY (tenant_id, storefront_id) REFERENCES storefront.storefronts(tenant_id, id),
  FOREIGN KEY (tenant_id, sales_channel_id) REFERENCES storefront.sales_channels(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS storefront_domain_channel_binding_lookup_idx
  ON storefront.domain_sales_channel_bindings(tenant_id, domain_id, status, sales_channel_id);

ALTER TABLE storefront.domain_sales_channel_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE storefront.domain_sales_channel_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON storefront.domain_sales_channel_bindings
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE OR REPLACE FUNCTION storefront.bind_domain_sales_channel(
  p_binding_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_domain_id uuid,
  p_sales_channel_id uuid,
  p_status text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(binding_id uuid, status text, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_domain_storefront_id uuid;
  v_channel_storefront_id uuid;
  v_existing storefront.domain_sales_channel_bindings%ROWTYPE;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.domain.bind_channel', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'bindingId')::uuid,
      v_replay ->> 'status',
      true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_tenant_id::text, p_domain_id::text, 'sales-channel-binding'), 0
  ));
  SELECT d.storefront_id INTO v_domain_storefront_id
  FROM storefront.domains d
  WHERE d.tenant_id = p_tenant_id
    AND d.id = p_domain_id
    AND d.status <> 'deleted'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'domain not found' USING ERRCODE = 'P0002'; END IF;

  SELECT sc.storefront_id INTO v_channel_storefront_id
  FROM storefront.sales_channels sc
  WHERE sc.tenant_id = p_tenant_id
    AND sc.id = p_sales_channel_id
    AND sc.status <> 'archived'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sales channel not found' USING ERRCODE = 'P0002'; END IF;
  IF v_domain_storefront_id IS DISTINCT FROM v_channel_storefront_id THEN
    RAISE EXCEPTION 'domain and sales channel belong to different storefronts'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM storefront.domain_sales_channel_bindings
  WHERE tenant_id = p_tenant_id AND domain_id = p_domain_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.status = 'archived' AND p_status <> 'archived' THEN
      RAISE EXCEPTION 'archived domain binding cannot be reactivated' USING ERRCODE = '22023';
    END IF;
    UPDATE storefront.domain_sales_channel_bindings
    SET sales_channel_id = p_sales_channel_id,
        status = p_status,
        updated_by = p_actor_id,
        updated_at = now(),
        version = version + 1
    WHERE tenant_id = p_tenant_id AND id = v_existing.id;
    p_binding_id := v_existing.id;
  ELSE
    INSERT INTO storefront.domain_sales_channel_bindings(
      id, tenant_id, domain_id, storefront_id, sales_channel_id,
      status, created_by, updated_by
    ) VALUES (
      p_binding_id, p_tenant_id, p_domain_id, v_domain_storefront_id,
      p_sales_channel_id, p_status, p_actor_id, p_actor_id
    );
  END IF;

  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.domain.bind_channel', p_idempotency_key,
    p_request_hash,
    jsonb_build_object('bindingId', p_binding_id, 'status', p_status),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_binding_id, p_status, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.publish_binding_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_event_type text := CASE
    WHEN TG_OP = 'INSERT' THEN 'storefront.domain.sales_channel_bound.v1'
    ELSE 'storefront.domain.sales_channel_binding_changed.v1'
  END;
  v_request_id text := COALESCE(platform.current_request_id(), v_event_type || ':' || NEW.id::text);
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_payload jsonb;
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'storefront binding evidence tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  v_payload := jsonb_build_object(
    'bindingId', NEW.id,
    'domainId', NEW.domain_id,
    'storefrontId', NEW.storefront_id,
    'salesChannelId', NEW.sales_channel_id,
    'status', NEW.status,
    'version', NEW.version
  );
  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), NEW.tenant_id, v_event_type, 'storefront.domain.bind_channel',
    'success', NEW.updated_by, 'storefront.domain_sales_channel_binding', NEW.id::text,
    v_request_id, v_trace_id,
    jsonb_build_object('schemaVersion', '1.0', 'eventPayload', v_payload),
    now(), v_business_date, 'mod-h-v1'
  );
  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), NEW.tenant_id, v_event_type,
    'storefront.domain_sales_channel_binding', NEW.id::text, '1.0', v_payload,
    jsonb_build_object('requestId', v_request_id, 'traceId', v_trace_id, 'source', 'mod-h'),
    v_request_id, now(), v_business_date
  );
  RETURN NEW;
END $$;

CREATE TRIGGER domain_sales_channel_bindings_evidence
  AFTER INSERT OR UPDATE ON storefront.domain_sales_channel_bindings
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_binding_evidence();

CREATE OR REPLACE FUNCTION storefront.resolve_public_host(p_hostname text)
RETURNS TABLE(
  tenant_id uuid,
  storefront_id uuid,
  sales_channel_id uuid,
  request_hostname text,
  canonical_hostname text,
  locale text,
  currency text,
  price_list_revision text,
  publication_generation text,
  theme_revision text,
  layout_revision text,
  capabilities text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform, pricing
SET row_security = off AS $$
  WITH resolved AS (
    SELECT
      d.tenant_id,
      d.storefront_id,
      b.sales_channel_id,
      d.hostname AS request_hostname,
      COALESCE(canonical.hostname, d.hostname) AS canonical_hostname,
      sf.default_locale AS locale,
      sf.default_currency::text AS currency,
      sc.price_list_id,
      sc.guest_checkout_enabled,
      sc.customer_accounts_enabled,
      COALESCE(cg.generation, 0) AS generation,
      COALESCE((
        SELECT max(tr.revision)
        FROM storefront.theme_revisions tr
        WHERE tr.tenant_id = d.tenant_id
          AND tr.storefront_id = d.storefront_id
          AND tr.status = 'published'
      ), 0) AS theme_revision_number,
      COALESCE((
        SELECT max(hr.revision)
        FROM storefront.homepage_revisions hr
        WHERE hr.tenant_id = d.tenant_id
          AND hr.storefront_id = d.storefront_id
          AND hr.status = 'published'
      ), 0) AS layout_revision_number
    FROM storefront.domains d
    JOIN storefront.domain_sales_channel_bindings b
      ON b.tenant_id = d.tenant_id
     AND b.domain_id = d.id
     AND b.storefront_id = d.storefront_id
     AND b.status = 'active'
    JOIN storefront.storefronts sf
      ON sf.tenant_id = d.tenant_id
     AND sf.id = d.storefront_id
     AND sf.status = 'active'
    JOIN storefront.sales_channels sc
      ON sc.tenant_id = b.tenant_id
     AND sc.id = b.sales_channel_id
     AND sc.storefront_id = b.storefront_id
     AND sc.status = 'active'
    JOIN pricing.price_lists pl
      ON pl.tenant_id = sc.tenant_id
     AND pl.id = sc.price_list_id
     AND pl.status = 'active'
     AND pl.active_version IS NOT NULL
     AND pl.currency = sf.default_currency
    LEFT JOIN LATERAL (
      SELECT candidate.hostname
      FROM storefront.domains candidate
      WHERE candidate.tenant_id = d.tenant_id
        AND candidate.storefront_id = d.storefront_id
        AND candidate.status = 'active'
        AND candidate.certificate_status = 'active'
        AND candidate.is_canonical
      ORDER BY candidate.activated_at DESC NULLS LAST, candidate.id
      LIMIT 1
    ) canonical ON true
    LEFT JOIN storefront.cache_generations cg
      ON cg.tenant_id = d.tenant_id
     AND cg.storefront_id = d.storefront_id
     AND cg.sales_channel_id = b.sales_channel_id
     AND cg.locale = sf.default_locale
     AND cg.currency = sf.default_currency
    WHERE d.hostname = lower(trim(trailing '.' from p_hostname))
      AND d.status = 'active'
      AND d.certificate_status = 'active'
    LIMIT 1
  )
  SELECT
    r.tenant_id,
    r.storefront_id,
    r.sales_channel_id,
    r.request_hostname,
    r.canonical_hostname,
    r.locale,
    r.currency,
    concat('price-list:', r.price_list_id::text, ':v', pl.active_version::text),
    concat('publication:', r.generation::text),
    concat('theme:', r.theme_revision_number::text),
    concat('layout:', r.layout_revision_number::text),
    ARRAY_REMOVE(ARRAY[
      'catalog.read',
      'checkout.quote',
      CASE WHEN r.guest_checkout_enabled THEN 'checkout.guest' END,
      CASE WHEN r.customer_accounts_enabled THEN 'customer.account' END
    ]::text[], NULL)
  FROM resolved r
  JOIN pricing.price_lists pl
    ON pl.tenant_id = r.tenant_id AND pl.id = r.price_list_id;
$$;

REVOKE ALL ON FUNCTION storefront.bind_domain_sales_channel(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.publish_binding_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.resolve_public_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storefront.bind_domain_sales_channel(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.resolve_public_host(text) TO store_app_runtime;

GRANT SELECT ON storefront.domain_sales_channel_bindings TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON storefront.domain_sales_channel_bindings FROM store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0003','MOD-H-STOREFRONT','manifest:STF-0003-public-host-resolution.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
