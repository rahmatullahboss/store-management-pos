BEGIN;

DROP INDEX IF EXISTS storefront.storefront_one_published_theme_idx;
DROP INDEX IF EXISTS storefront.storefront_one_published_navigation_idx;
DROP INDEX IF EXISTS storefront.storefront_one_published_content_page_idx;
DROP INDEX IF EXISTS storefront.storefront_one_published_homepage_idx;

CREATE TABLE IF NOT EXISTS storefront.command_receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  command_type text NOT NULL CHECK (char_length(command_type) BETWEEN 1 AND 120),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_document jsonb NOT NULL CHECK (jsonb_typeof(response_document) = 'object'),
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  trace_id text NOT NULL CHECK (char_length(trace_id) BETWEEN 1 AND 200),
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, command_type, idempotency_key)
);
ALTER TABLE storefront.command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE storefront.command_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON storefront.command_receipts
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE TRIGGER storefront_command_receipts_append_only
  BEFORE UPDATE OR DELETE ON storefront.command_receipts
  FOR EACH ROW EXECUTE FUNCTION storefront.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION storefront.assert_tenant_context(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'storefront tenant context mismatch' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION storefront.command_replay(
  p_tenant_id uuid,
  p_command_type text,
  p_idempotency_key text,
  p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_receipt storefront.command_receipts%ROWTYPE;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  SELECT * INTO v_receipt
  FROM storefront.command_receipts
  WHERE tenant_id = p_tenant_id
    AND command_type = p_command_type
    AND idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_receipt.request_hash IS DISTINCT FROM p_request_hash THEN
    RAISE EXCEPTION 'storefront command idempotency conflict' USING ERRCODE = '23505';
  END IF;
  RETURN v_receipt.response_document;
END $$;

CREATE OR REPLACE FUNCTION storefront.store_command_receipt(
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_command_type text,
  p_idempotency_key text,
  p_request_hash text,
  p_response_document jsonb,
  p_actor_id uuid,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  INSERT INTO storefront.command_receipts(
    id, tenant_id, command_type, idempotency_key, request_hash,
    response_document, actor_id, request_id, trace_id, business_date
  ) VALUES (
    p_receipt_id, p_tenant_id, p_command_type, p_idempotency_key, p_request_hash,
    p_response_document, p_actor_id, p_request_id, p_trace_id, p_business_date
  );
END $$;

CREATE OR REPLACE FUNCTION storefront.create_storefront(
  p_storefront_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_legal_entity_id uuid,
  p_primary_store_id uuid,
  p_code text,
  p_display_name text,
  p_default_locale text,
  p_default_currency text,
  p_time_zone text,
  p_platform_subdomain text,
  p_settings jsonb,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(storefront_id uuid, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.create', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT (v_replay ->> 'storefrontId')::uuid, true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_tenant_id::text, 'storefront', lower(p_code)), 0
  ));
  IF NOT EXISTS (
    SELECT 1 FROM platform.legal_entities
    WHERE tenant_id = p_tenant_id AND id = p_legal_entity_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'active legal entity not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_primary_store_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM platform.stores
    WHERE tenant_id = p_tenant_id AND id = p_primary_store_id
      AND legal_entity_id = p_legal_entity_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'active primary store not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO storefront.storefronts(
    id, tenant_id, legal_entity_id, primary_store_id, code, display_name,
    default_locale, default_currency, time_zone, platform_subdomain, settings,
    created_by, updated_by
  ) VALUES (
    p_storefront_id, p_tenant_id, p_legal_entity_id, p_primary_store_id,
    lower(p_code), p_display_name, p_default_locale, upper(p_default_currency),
    p_time_zone, NULLIF(lower(p_platform_subdomain), ''), COALESCE(p_settings, '{}'::jsonb),
    p_actor_id, p_actor_id
  );

  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.create', p_idempotency_key,
    p_request_hash, jsonb_build_object('storefrontId', p_storefront_id),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_storefront_id, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.transition_storefront(
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_new_status text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(storefront_id uuid, status text, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_current storefront.storefronts%ROWTYPE;
  v_allowed boolean;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.transition', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'storefrontId')::uuid,
      v_replay ->> 'status',
      true;
    RETURN;
  END IF;

  SELECT * INTO v_current
  FROM storefront.storefronts
  WHERE tenant_id = p_tenant_id AND id = p_storefront_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002'; END IF;
  v_allowed := CASE v_current.status
    WHEN 'draft' THEN p_new_status IN ('draft','active','suspended','archived')
    WHEN 'active' THEN p_new_status IN ('active','suspended','archived')
    WHEN 'suspended' THEN p_new_status IN ('suspended','active','archived')
    WHEN 'archived' THEN p_new_status = 'archived'
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid storefront transition: % -> %', v_current.status, p_new_status
      USING ERRCODE = '22023';
  END IF;
  IF p_new_status = 'active' AND NOT EXISTS (
    SELECT 1 FROM platform.legal_entities
    WHERE tenant_id = p_tenant_id AND id = v_current.legal_entity_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'storefront legal entity is not active' USING ERRCODE = '42501';
  END IF;

  UPDATE storefront.storefronts
  SET status = p_new_status,
      activated_at = CASE WHEN p_new_status = 'active' THEN COALESCE(activated_at, now()) ELSE activated_at END,
      suspended_at = CASE WHEN p_new_status = 'suspended' THEN now() WHEN p_new_status = 'active' THEN NULL ELSE suspended_at END,
      updated_by = p_actor_id,
      updated_at = now(),
      version = version + 1
  WHERE tenant_id = p_tenant_id AND id = p_storefront_id;

  IF p_new_status IN ('suspended','archived') THEN
    UPDATE storefront.sales_channels
    SET status = 'suspended', updated_by = p_actor_id, updated_at = now(), version = version + 1
    WHERE tenant_id = p_tenant_id AND storefront_id = p_storefront_id AND status = 'active';
  END IF;

  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.transition', p_idempotency_key,
    p_request_hash,
    jsonb_build_object('storefrontId', p_storefront_id, 'status', p_new_status),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_storefront_id, p_new_status, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.create_sales_channel(
  p_sales_channel_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_code text,
  p_display_name text,
  p_price_list_id uuid,
  p_inventory_scope jsonb,
  p_allowed_country_codes text[],
  p_guest_checkout_enabled boolean,
  p_customer_accounts_enabled boolean,
  p_backorder_policy text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(sales_channel_id uuid, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.sales_channel.create', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT (v_replay ->> 'salesChannelId')::uuid, true;
    RETURN;
  END IF;
  PERFORM 1 FROM storefront.storefronts
  WHERE tenant_id = p_tenant_id AND id = p_storefront_id AND status <> 'archived'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO storefront.sales_channels(
    id, tenant_id, storefront_id, code, display_name, price_list_id,
    inventory_scope, allowed_country_codes, guest_checkout_enabled,
    customer_accounts_enabled, backorder_policy, created_by, updated_by
  ) VALUES (
    p_sales_channel_id, p_tenant_id, p_storefront_id, lower(p_code), p_display_name,
    p_price_list_id, COALESCE(p_inventory_scope, '{}'::jsonb),
    COALESCE(p_allowed_country_codes, ARRAY[]::text[]),
    p_guest_checkout_enabled, p_customer_accounts_enabled, p_backorder_policy,
    p_actor_id, p_actor_id
  );

  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.sales_channel.create', p_idempotency_key,
    p_request_hash, jsonb_build_object('salesChannelId', p_sales_channel_id),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_sales_channel_id, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.transition_sales_channel(
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_sales_channel_id uuid,
  p_new_status text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(sales_channel_id uuid, status text, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_channel storefront.sales_channels%ROWTYPE;
  v_storefront_status text;
  v_allowed boolean;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.sales_channel.transition', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'salesChannelId')::uuid,
      v_replay ->> 'status',
      true;
    RETURN;
  END IF;

  SELECT * INTO v_channel FROM storefront.sales_channels
  WHERE tenant_id = p_tenant_id AND id = p_sales_channel_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sales channel not found' USING ERRCODE = 'P0002'; END IF;
  SELECT sf.status INTO v_storefront_status FROM storefront.storefronts sf
  WHERE sf.tenant_id = p_tenant_id AND sf.id = v_channel.storefront_id;
  v_allowed := CASE v_channel.status
    WHEN 'draft' THEN p_new_status IN ('draft','active','suspended','archived')
    WHEN 'active' THEN p_new_status IN ('active','suspended','archived')
    WHEN 'suspended' THEN p_new_status IN ('suspended','active','archived')
    WHEN 'archived' THEN p_new_status = 'archived'
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid sales-channel transition: % -> %', v_channel.status, p_new_status
      USING ERRCODE = '22023';
  END IF;
  IF p_new_status = 'active' AND v_storefront_status <> 'active' THEN
    RAISE EXCEPTION 'sales channel requires an active storefront' USING ERRCODE = '42501';
  END IF;

  UPDATE storefront.sales_channels
  SET status = p_new_status,
      activated_at = CASE WHEN p_new_status = 'active' THEN COALESCE(activated_at, now()) ELSE activated_at END,
      updated_by = p_actor_id,
      updated_at = now(),
      version = version + 1
  WHERE tenant_id = p_tenant_id AND id = p_sales_channel_id;

  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.sales_channel.transition', p_idempotency_key,
    p_request_hash,
    jsonb_build_object('salesChannelId', p_sales_channel_id, 'status', p_new_status),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_sales_channel_id, p_new_status, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.advance_cache_generation_internal(
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_sales_channel_id uuid,
  p_reason text,
  p_actor_id uuid,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_locale text;
  v_currency char(3);
  v_generation bigint;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  SELECT default_locale, default_currency INTO v_locale, v_currency
  FROM storefront.storefronts
  WHERE tenant_id = p_tenant_id AND id = p_storefront_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO storefront.cache_generations(
    tenant_id, storefront_id, sales_channel_id, locale, currency,
    generation, generation_reason, updated_by, request_id, trace_id, business_date
  ) VALUES (
    p_tenant_id, p_storefront_id, p_sales_channel_id, v_locale, v_currency,
    1, p_reason, p_actor_id, p_request_id, p_trace_id, p_business_date
  )
  ON CONFLICT (tenant_id, storefront_id, sales_channel_id, locale, currency)
  DO UPDATE SET
    generation = storefront.cache_generations.generation + 1,
    generation_reason = EXCLUDED.generation_reason,
    updated_by = EXCLUDED.updated_by,
    updated_at = now(),
    request_id = EXCLUDED.request_id,
    trace_id = EXCLUDED.trace_id,
    business_date = EXCLUDED.business_date
  RETURNING generation INTO v_generation;
  RETURN v_generation;
END $$;

CREATE OR REPLACE FUNCTION storefront.set_product_publication(
  p_publication_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_sales_channel_id uuid,
  p_product_id uuid,
  p_public_slug text,
  p_new_state text,
  p_scheduled_for timestamptz,
  p_metadata jsonb,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(publication_id uuid, publication_state text, cache_generation bigint, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_existing storefront.product_publications%ROWTYPE;
  v_storefront_status text;
  v_channel_status text;
  v_allowed boolean;
  v_generation bigint;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.product_publication.set', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'publicationId')::uuid,
      v_replay ->> 'publicationState',
      (v_replay ->> 'cacheGeneration')::bigint,
      true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_tenant_id::text, p_sales_channel_id::text, p_product_id::text), 0
  ));
  SELECT sf.status, sc.status INTO v_storefront_status, v_channel_status
  FROM storefront.storefronts sf
  JOIN storefront.sales_channels sc
    ON sc.tenant_id = sf.tenant_id AND sc.storefront_id = sf.id
  WHERE sf.tenant_id = p_tenant_id
    AND sf.id = p_storefront_id
    AND sc.id = p_sales_channel_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'storefront sales channel not found' USING ERRCODE = 'P0002'; END IF;
  IF p_new_state = 'published' AND (v_storefront_status <> 'active' OR v_channel_status <> 'active') THEN
    RAISE EXCEPTION 'publishing requires an active storefront and sales channel' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM storefront.product_publications
  WHERE tenant_id = p_tenant_id AND sales_channel_id = p_sales_channel_id AND product_id = p_product_id
  FOR UPDATE;
  IF FOUND THEN
    v_allowed := CASE v_existing.publication_state
      WHEN 'draft' THEN p_new_state IN ('draft','scheduled','published','hidden','archived')
      WHEN 'scheduled' THEN p_new_state IN ('draft','scheduled','published','hidden','archived')
      WHEN 'published' THEN p_new_state IN ('published','hidden','archived')
      WHEN 'hidden' THEN p_new_state IN ('draft','published','hidden','archived')
      WHEN 'archived' THEN p_new_state = 'archived'
      ELSE false
    END;
    IF NOT v_allowed THEN
      RAISE EXCEPTION 'invalid product-publication transition: % -> %', v_existing.publication_state, p_new_state
        USING ERRCODE = '22023';
    END IF;
    UPDATE storefront.product_publications
    SET public_slug = p_public_slug,
        publication_state = p_new_state,
        scheduled_for = CASE WHEN p_new_state = 'scheduled' THEN p_scheduled_for ELSE NULL END,
        published_at = CASE WHEN p_new_state = 'published' THEN COALESCE(published_at, now()) ELSE published_at END,
        hidden_at = CASE WHEN p_new_state = 'hidden' THEN now() WHEN p_new_state = 'published' THEN NULL ELSE hidden_at END,
        metadata = COALESCE(p_metadata, '{}'::jsonb),
        updated_by = p_actor_id,
        updated_at = now(),
        version = version + 1
    WHERE tenant_id = p_tenant_id AND id = v_existing.id;
    p_publication_id := v_existing.id;
  ELSE
    INSERT INTO storefront.product_publications(
      id, tenant_id, storefront_id, sales_channel_id, product_id, publication_state,
      public_slug, scheduled_for, published_at, hidden_at, metadata, created_by, updated_by
    ) VALUES (
      p_publication_id, p_tenant_id, p_storefront_id, p_sales_channel_id, p_product_id,
      p_new_state, p_public_slug,
      CASE WHEN p_new_state = 'scheduled' THEN p_scheduled_for ELSE NULL END,
      CASE WHEN p_new_state = 'published' THEN now() ELSE NULL END,
      CASE WHEN p_new_state = 'hidden' THEN now() ELSE NULL END,
      COALESCE(p_metadata, '{}'::jsonb), p_actor_id, p_actor_id
    );
  END IF;

  v_generation := storefront.advance_cache_generation_internal(
    p_tenant_id, p_storefront_id, p_sales_channel_id,
    'product_publication:' || p_product_id::text,
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.product_publication.set', p_idempotency_key,
    p_request_hash,
    jsonb_build_object(
      'publicationId', p_publication_id,
      'publicationState', p_new_state,
      'cacheGeneration', v_generation
    ),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_publication_id, p_new_state, v_generation, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.register_domain(
  p_domain_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_hostname text,
  p_domain_kind text,
  p_verification_method text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(domain_id uuid, status text, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.domain.register', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'domainId')::uuid,
      v_replay ->> 'status',
      true;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(lower(p_hostname), 0));
  IF NOT EXISTS (
    SELECT 1 FROM storefront.storefronts
    WHERE tenant_id = p_tenant_id AND id = p_storefront_id AND status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO storefront.domains(
    id, tenant_id, storefront_id, hostname, domain_kind, status,
    verification_method, created_by, updated_by
  ) VALUES (
    p_domain_id, p_tenant_id, p_storefront_id, lower(p_hostname), p_domain_kind,
    CASE WHEN p_domain_kind = 'platform_subdomain' THEN 'certificate_pending' ELSE 'verification_pending' END,
    p_verification_method, p_actor_id, p_actor_id
  );

  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.domain.register', p_idempotency_key,
    p_request_hash,
    jsonb_build_object(
      'domainId', p_domain_id,
      'status', CASE WHEN p_domain_kind = 'platform_subdomain' THEN 'certificate_pending' ELSE 'verification_pending' END
    ),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT
    p_domain_id,
    CASE WHEN p_domain_kind = 'platform_subdomain' THEN 'certificate_pending' ELSE 'verification_pending' END,
    false;
END $$;

CREATE OR REPLACE FUNCTION storefront.record_domain_verification(
  p_verification_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_domain_id uuid,
  p_attempt integer,
  p_challenge_type text,
  p_challenge_name text,
  p_challenge_value_hash text,
  p_result_status text,
  p_provider_reference text,
  p_observed_detail jsonb,
  p_observed_at timestamptz,
  p_expires_at timestamptz,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(domain_id uuid, domain_status text, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_domain storefront.domains%ROWTYPE;
  v_domain_status text;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.domain.verify', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'domainId')::uuid,
      v_replay ->> 'domainStatus',
      true;
    RETURN;
  END IF;

  SELECT * INTO v_domain FROM storefront.domains
  WHERE tenant_id = p_tenant_id AND id = p_domain_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'domain not found' USING ERRCODE = 'P0002'; END IF;
  IF v_domain.status IN ('deleting','deleted') THEN
    RAISE EXCEPTION 'domain cannot be verified in its current state' USING ERRCODE = '22023';
  END IF;

  INSERT INTO storefront.domain_verifications(
    id, tenant_id, domain_id, verification_attempt, challenge_type,
    challenge_name, challenge_value_hash, status, provider_reference,
    observed_detail, requested_by, observed_at, expires_at,
    request_id, trace_id, business_date
  ) VALUES (
    p_verification_id, p_tenant_id, p_domain_id, p_attempt, p_challenge_type,
    p_challenge_name, p_challenge_value_hash, p_result_status, p_provider_reference,
    COALESCE(p_observed_detail, '{}'::jsonb), p_actor_id,
    p_observed_at, p_expires_at, p_request_id, p_trace_id, p_business_date
  );
  v_domain_status := CASE
    WHEN p_result_status = 'verified' THEN 'certificate_pending'
    WHEN p_result_status = 'failed' THEN 'failed'
    ELSE 'verification_pending'
  END;
  UPDATE storefront.domains
  SET status = v_domain_status,
      verified_at = CASE WHEN p_result_status = 'verified' THEN p_observed_at ELSE verified_at END,
      provider_hostname_id = COALESCE(p_provider_reference, provider_hostname_id),
      failure_code = CASE WHEN p_result_status = 'failed' THEN 'verification_failed' ELSE NULL END,
      updated_by = p_actor_id,
      updated_at = now(),
      version = version + 1
  WHERE tenant_id = p_tenant_id AND id = p_domain_id;

  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.domain.verify', p_idempotency_key,
    p_request_hash,
    jsonb_build_object('domainId', p_domain_id, 'domainStatus', v_domain_status),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_domain_id, v_domain_status, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.transition_domain(
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_domain_id uuid,
  p_new_status text,
  p_certificate_status text,
  p_provider_hostname_id text,
  p_failure_code text,
  p_failure_detail text,
  p_is_canonical boolean,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(domain_id uuid, status text, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_domain storefront.domains%ROWTYPE;
  v_allowed boolean;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.domain.transition', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'domainId')::uuid,
      v_replay ->> 'status',
      true;
    RETURN;
  END IF;
  SELECT * INTO v_domain FROM storefront.domains
  WHERE tenant_id = p_tenant_id AND id = p_domain_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'domain not found' USING ERRCODE = 'P0002'; END IF;
  v_allowed := CASE v_domain.status
    WHEN 'pending' THEN p_new_status IN ('verification_pending','certificate_pending','failed','deleting')
    WHEN 'verification_pending' THEN p_new_status IN ('verification_pending','certificate_pending','failed','deleting')
    WHEN 'certificate_pending' THEN p_new_status IN ('certificate_pending','active','failed','deleting')
    WHEN 'active' THEN p_new_status IN ('active','suspended','deleting')
    WHEN 'suspended' THEN p_new_status IN ('suspended','active','deleting')
    WHEN 'failed' THEN p_new_status IN ('verification_pending','certificate_pending','failed','deleting')
    WHEN 'deleting' THEN p_new_status IN ('deleting','deleted')
    WHEN 'deleted' THEN p_new_status = 'deleted'
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid domain transition: % -> %', v_domain.status, p_new_status
      USING ERRCODE = '22023';
  END IF;
  IF p_new_status = 'active' AND (v_domain.verified_at IS NULL OR p_certificate_status <> 'active') THEN
    RAISE EXCEPTION 'active domain requires completed verification and certificate' USING ERRCODE = '42501';
  END IF;
  IF p_is_canonical AND p_new_status <> 'active' THEN
    RAISE EXCEPTION 'canonical domain must be active' USING ERRCODE = '22023';
  END IF;

  IF p_is_canonical THEN
    UPDATE storefront.domains
    SET is_canonical = false, updated_by = p_actor_id, updated_at = now(), version = version + 1
    WHERE tenant_id = p_tenant_id
      AND storefront_id = v_domain.storefront_id
      AND id <> p_domain_id
      AND is_canonical;
  END IF;
  UPDATE storefront.domains
  SET status = p_new_status,
      certificate_status = p_certificate_status,
      provider_hostname_id = COALESCE(p_provider_hostname_id, provider_hostname_id),
      failure_code = p_failure_code,
      failure_detail = p_failure_detail,
      is_canonical = p_is_canonical,
      activated_at = CASE WHEN p_new_status = 'active' THEN COALESCE(activated_at, now()) ELSE activated_at END,
      suspended_at = CASE WHEN p_new_status = 'suspended' THEN now() WHEN p_new_status = 'active' THEN NULL ELSE suspended_at END,
      deleted_at = CASE WHEN p_new_status = 'deleted' THEN now() ELSE deleted_at END,
      updated_by = p_actor_id,
      updated_at = now(),
      version = version + 1
  WHERE tenant_id = p_tenant_id AND id = p_domain_id;

  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.domain.transition', p_idempotency_key,
    p_request_hash,
    jsonb_build_object('domainId', p_domain_id, 'status', p_new_status),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_domain_id, p_new_status, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.publish_theme_revision(
  p_theme_revision_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_theme_document jsonb,
  p_document_hash text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(theme_revision_id uuid, revision bigint, cache_generation bigint, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_revision bigint;
  v_generation bigint := 0;
  v_channel record;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.theme.publish', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'themeRevisionId')::uuid,
      (v_replay ->> 'revision')::bigint,
      (v_replay ->> 'cacheGeneration')::bigint,
      true;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_tenant_id::text, p_storefront_id::text, 'theme'), 0
  ));
  IF NOT EXISTS (
    SELECT 1 FROM storefront.storefronts
    WHERE tenant_id = p_tenant_id AND id = p_storefront_id AND status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(max(tr.revision), 0) + 1 INTO v_revision
  FROM storefront.theme_revisions tr
  WHERE tr.tenant_id = p_tenant_id AND tr.storefront_id = p_storefront_id;

  INSERT INTO storefront.theme_revisions(
    id, tenant_id, storefront_id, revision, status, theme_document,
    document_hash, created_by, published_by, published_at,
    request_id, trace_id, business_date
  ) VALUES (
    p_theme_revision_id, p_tenant_id, p_storefront_id, v_revision, 'published',
    p_theme_document, p_document_hash, p_actor_id, p_actor_id, now(),
    p_request_id, p_trace_id, p_business_date
  );

  FOR v_channel IN
    SELECT sc.id FROM storefront.sales_channels sc
    WHERE sc.tenant_id = p_tenant_id AND sc.storefront_id = p_storefront_id AND sc.status = 'active'
  LOOP
    v_generation := GREATEST(
      v_generation,
      storefront.advance_cache_generation_internal(
        p_tenant_id, p_storefront_id, v_channel.id, 'theme_publish',
        p_actor_id, p_request_id, p_trace_id, p_business_date
      )
    );
  END LOOP;

  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.theme.publish', p_idempotency_key,
    p_request_hash,
    jsonb_build_object(
      'themeRevisionId', p_theme_revision_id,
      'revision', v_revision,
      'cacheGeneration', v_generation
    ),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_theme_revision_id, v_revision, v_generation, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.publish_command_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_tenant_id uuid := NULLIF(v_row ->> 'tenant_id', '')::uuid;
  v_event_type text;
  v_action text;
  v_aggregate_type text;
  v_aggregate_id text := COALESCE(v_row ->> 'id', v_row ->> 'storefront_id');
  v_actor_id uuid;
  v_request_id text;
  v_trace_id text;
  v_business_date date;
  v_payload jsonb;
BEGIN
  IF v_tenant_id IS NULL OR v_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'storefront evidence tenant context mismatch' USING ERRCODE = '42501';
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'storefronts' THEN
      v_event_type := CASE WHEN TG_OP = 'INSERT' THEN 'storefront.storefront.created.v1' ELSE 'storefront.storefront.updated.v1' END;
      v_action := CASE WHEN TG_OP = 'INSERT' THEN 'storefront.storefront.create' ELSE 'storefront.storefront.update' END;
      v_aggregate_type := 'storefront.storefront';
    WHEN 'sales_channels' THEN
      v_event_type := CASE WHEN TG_OP = 'INSERT' THEN 'storefront.sales_channel.created.v1' ELSE 'storefront.sales_channel.updated.v1' END;
      v_action := CASE WHEN TG_OP = 'INSERT' THEN 'storefront.sales_channel.create' ELSE 'storefront.sales_channel.update' END;
      v_aggregate_type := 'storefront.sales_channel';
    WHEN 'domains' THEN
      v_event_type := CASE WHEN TG_OP = 'INSERT' THEN 'storefront.domain.registered.v1' ELSE 'storefront.domain.status_changed.v1' END;
      v_action := CASE WHEN TG_OP = 'INSERT' THEN 'storefront.domain.register' ELSE 'storefront.domain.transition' END;
      v_aggregate_type := 'storefront.domain';
    WHEN 'domain_verifications' THEN
      v_event_type := 'storefront.domain.verification_observed.v1';
      v_action := 'storefront.domain.verify';
      v_aggregate_type := 'storefront.domain';
      v_aggregate_id := v_row ->> 'domain_id';
    WHEN 'product_publications' THEN
      v_event_type := 'storefront.product.publication_changed.v1';
      v_action := 'storefront.product_publication.set';
      v_aggregate_type := 'storefront.product_publication';
    WHEN 'theme_revisions' THEN
      v_event_type := 'storefront.theme.published.v1';
      v_action := 'storefront.theme.publish';
      v_aggregate_type := 'storefront.theme_revision';
    WHEN 'cache_generations' THEN
      v_event_type := 'storefront.cache.generation_advanced.v1';
      v_action := 'storefront.cache.invalidate';
      v_aggregate_type := 'storefront.cache_generation';
      v_aggregate_id := concat_ws(':', v_row ->> 'storefront_id', v_row ->> 'sales_channel_id', v_row ->> 'locale', v_row ->> 'currency');
    ELSE
      RETURN NEW;
  END CASE;

  v_actor_id := COALESCE(
    NULLIF(v_row ->> 'updated_by', '')::uuid,
    NULLIF(v_row ->> 'published_by', '')::uuid,
    NULLIF(v_row ->> 'requested_by', '')::uuid,
    NULLIF(v_row ->> 'created_by', '')::uuid,
    platform.current_actor_id()
  );
  v_request_id := COALESCE(NULLIF(v_row ->> 'request_id', ''), platform.current_request_id(), v_event_type || ':' || v_aggregate_id);
  v_trace_id := COALESCE(NULLIF(v_row ->> 'trace_id', ''), platform.current_trace_id(), v_request_id);
  v_business_date := COALESCE(
    NULLIF(v_row ->> 'business_date', '')::date,
    platform.current_business_date()
  );
  IF v_actor_id IS NULL OR v_business_date IS NULL THEN
    RAISE EXCEPTION 'storefront evidence actor and business date are required' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'id', v_aggregate_id,
    'storefrontId', v_row ->> 'storefront_id',
    'salesChannelId', v_row ->> 'sales_channel_id',
    'productId', v_row ->> 'product_id',
    'domainId', v_row ->> 'domain_id',
    'hostname', v_row ->> 'hostname',
    'priorStatus', COALESCE(v_old ->> 'publication_state', v_old ->> 'status'),
    'status', COALESCE(v_row ->> 'publication_state', v_row ->> 'status'),
    'revision', v_row ->> 'revision',
    'generation', v_row ->> 'generation',
    'reason', v_row ->> 'generation_reason'
  ));

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, v_event_type, v_action, 'success', v_actor_id,
    v_aggregate_type, v_aggregate_id, v_request_id, v_trace_id,
    jsonb_build_object('schemaVersion', '1.0', 'eventPayload', v_payload),
    now(), v_business_date, 'mod-h-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, v_event_type, v_aggregate_type, v_aggregate_id,
    '1.0', v_payload,
    jsonb_build_object('requestId', v_request_id, 'traceId', v_trace_id, 'source', 'mod-h'),
    v_request_id, now(), v_business_date
  );
  RETURN NEW;
END $$;

CREATE TRIGGER storefronts_evidence
  AFTER INSERT OR UPDATE ON storefront.storefronts
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_command_evidence();
CREATE TRIGGER sales_channels_evidence
  AFTER INSERT OR UPDATE ON storefront.sales_channels
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_command_evidence();
CREATE TRIGGER domains_evidence
  AFTER INSERT OR UPDATE ON storefront.domains
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_command_evidence();
CREATE TRIGGER domain_verifications_evidence
  AFTER INSERT ON storefront.domain_verifications
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_command_evidence();
CREATE TRIGGER product_publications_evidence
  AFTER INSERT OR UPDATE ON storefront.product_publications
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_command_evidence();
CREATE TRIGGER theme_revisions_evidence
  AFTER INSERT ON storefront.theme_revisions
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_command_evidence();
CREATE TRIGGER cache_generations_evidence
  AFTER INSERT OR UPDATE ON storefront.cache_generations
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_command_evidence();

REVOKE ALL ON FUNCTION storefront.assert_tenant_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.command_replay(uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.store_command_receipt(uuid,uuid,text,text,text,jsonb,uuid,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.advance_cache_generation_internal(uuid,uuid,uuid,text,uuid,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.publish_command_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.create_storefront(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.transition_storefront(uuid,uuid,uuid,text,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.create_sales_channel(uuid,uuid,uuid,uuid,text,text,uuid,jsonb,text[],boolean,boolean,text,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.transition_sales_channel(uuid,uuid,uuid,text,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.set_product_publication(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,jsonb,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.register_domain(uuid,uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.record_domain_verification(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,jsonb,timestamptz,timestamptz,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.transition_domain(uuid,uuid,uuid,text,text,text,text,text,boolean,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.publish_theme_revision(uuid,uuid,uuid,uuid,jsonb,text,uuid,text,text,text,text,date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION storefront.create_storefront(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.transition_storefront(uuid,uuid,uuid,text,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.create_sales_channel(uuid,uuid,uuid,uuid,text,text,uuid,jsonb,text[],boolean,boolean,text,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.transition_sales_channel(uuid,uuid,uuid,text,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.set_product_publication(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,jsonb,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.register_domain(uuid,uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.record_domain_verification(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,jsonb,timestamptz,timestamptz,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.transition_domain(uuid,uuid,uuid,text,text,text,text,text,boolean,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.publish_theme_revision(uuid,uuid,uuid,uuid,jsonb,text,uuid,text,text,text,text,date) TO store_app_runtime;

GRANT SELECT ON storefront.command_receipts TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON storefront.command_receipts FROM store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0002','MOD-H-STOREFRONT','manifest:STF-0002-storefront-commands.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
