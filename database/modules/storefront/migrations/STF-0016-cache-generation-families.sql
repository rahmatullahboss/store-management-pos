BEGIN;

CREATE TABLE IF NOT EXISTS storefront.cache_generation_families (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  storefront_id uuid NOT NULL,
  sales_channel_id uuid NOT NULL,
  locale text NOT NULL CHECK (char_length(locale) BETWEEN 2 AND 35),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  family text NOT NULL CHECK (family IN (
    'bootstrap','content','catalog','product','category',
    'collection','search','sitemap','media'
  )),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  generation_reason text NOT NULL CHECK (char_length(generation_reason) BETWEEN 1 AND 160),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  trace_id text NOT NULL CHECK (char_length(trace_id) BETWEEN 1 AND 200),
  business_date date NOT NULL,
  PRIMARY KEY (
    tenant_id, storefront_id, sales_channel_id, locale, currency, family
  ),
  FOREIGN KEY (tenant_id, storefront_id)
    REFERENCES storefront.storefronts(tenant_id, id),
  FOREIGN KEY (tenant_id, sales_channel_id)
    REFERENCES storefront.sales_channels(tenant_id, id)
);

INSERT INTO storefront.cache_generation_families(
  tenant_id, storefront_id, sales_channel_id, locale, currency, family,
  generation, generation_reason, updated_by, updated_at,
  request_id, trace_id, business_date
)
SELECT
  generation.tenant_id,
  generation.storefront_id,
  generation.sales_channel_id,
  generation.locale,
  generation.currency,
  family.family,
  generation.generation,
  'seed:' || generation.generation_reason,
  generation.updated_by,
  generation.updated_at,
  generation.request_id,
  generation.trace_id,
  generation.business_date
FROM storefront.cache_generations generation
CROSS JOIN unnest(ARRAY[
  'bootstrap','content','catalog','product','category',
  'collection','search','sitemap','media'
]::text[]) family(family)
ON CONFLICT (
  tenant_id, storefront_id, sales_channel_id, locale, currency, family
) DO NOTHING;

ALTER TABLE storefront.cache_generation_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE storefront.cache_generation_families FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON storefront.cache_generation_families
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE OR REPLACE FUNCTION storefront.cache_families_for_reason(p_reason text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p_reason LIKE 'theme%'
      OR p_reason LIKE 'navigation%'
      OR p_reason LIKE 'content_page%'
      OR p_reason LIKE 'homepage%'
      THEN ARRAY['content','sitemap']::text[]
    WHEN p_reason LIKE 'category_publication:%'
      THEN ARRAY['catalog','category','search','sitemap']::text[]
    WHEN p_reason LIKE 'collection%'
      THEN ARRAY['catalog','collection','search','sitemap']::text[]
    WHEN p_reason LIKE 'product_publication:%'
      OR p_reason LIKE 'variant_publication:%'
      THEN ARRAY['catalog','product','category','collection','search','sitemap','media']::text[]
    ELSE ARRAY[
      'bootstrap','content','catalog','product','category',
      'collection','search','sitemap','media'
    ]::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION storefront.advance_cache_generation_families_internal(
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_sales_channel_id uuid,
  p_families text[],
  p_reason text,
  p_actor_id uuid,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_locale text;
  v_currency char(3);
  v_family text;
  v_generation bigint;
  v_result jsonb := '{}'::jsonb;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  IF p_families IS NULL OR cardinality(p_families) = 0 THEN
    RAISE EXCEPTION 'at least one cache family is required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR char_length(trim(p_reason)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'cache invalidation reason is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT storefront_row.default_locale, storefront_row.default_currency
  INTO v_locale, v_currency
  FROM storefront.storefronts storefront_row
  JOIN storefront.sales_channels channel_row
    ON channel_row.tenant_id = storefront_row.tenant_id
   AND channel_row.storefront_id = storefront_row.id
  WHERE storefront_row.tenant_id = p_tenant_id
    AND storefront_row.id = p_storefront_id
    AND channel_row.id = p_sales_channel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'storefront sales channel not found' USING ERRCODE = 'P0002';
  END IF;

  FOR v_family IN
    SELECT DISTINCT family
    FROM unnest(p_families) family
    ORDER BY family
  LOOP
    IF v_family NOT IN (
      'bootstrap','content','catalog','product','category',
      'collection','search','sitemap','media'
    ) THEN
      RAISE EXCEPTION 'unsupported cache family: %', v_family USING ERRCODE = '22023';
    END IF;

    INSERT INTO storefront.cache_generation_families(
      tenant_id, storefront_id, sales_channel_id, locale, currency, family,
      generation, generation_reason, updated_by,
      request_id, trace_id, business_date
    ) VALUES (
      p_tenant_id, p_storefront_id, p_sales_channel_id, v_locale, v_currency,
      v_family, 1, trim(p_reason), p_actor_id,
      p_request_id, p_trace_id, p_business_date
    )
    ON CONFLICT (
      tenant_id, storefront_id, sales_channel_id, locale, currency, family
    ) DO UPDATE SET
      generation = storefront.cache_generation_families.generation + 1,
      generation_reason = EXCLUDED.generation_reason,
      updated_by = EXCLUDED.updated_by,
      updated_at = now(),
      request_id = EXCLUDED.request_id,
      trace_id = EXCLUDED.trace_id,
      business_date = EXCLUDED.business_date
    RETURNING generation INTO v_generation;

    v_result := v_result || jsonb_build_object(v_family, v_generation::text);
  END LOOP;
  RETURN v_result;
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002';
  END IF;

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

  PERFORM storefront.advance_cache_generation_families_internal(
    p_tenant_id,
    p_storefront_id,
    p_sales_channel_id,
    storefront.cache_families_for_reason(p_reason),
    p_reason,
    p_actor_id,
    p_request_id,
    p_trace_id,
    p_business_date
  );
  RETURN v_generation;
END $$;

CREATE OR REPLACE FUNCTION storefront.publish_cache_family_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_aggregate_id text;
  v_payload jsonb;
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'storefront cache-family evidence tenant context mismatch'
      USING ERRCODE = '42501';
  END IF;
  v_aggregate_id := concat_ws(
    ':', NEW.storefront_id::text, NEW.sales_channel_id::text,
    NEW.locale, NEW.currency, NEW.family
  );
  v_payload := jsonb_build_object(
    'storefrontId', NEW.storefront_id,
    'salesChannelId', NEW.sales_channel_id,
    'locale', NEW.locale,
    'currency', NEW.currency,
    'family', NEW.family,
    'generation', NEW.generation::text,
    'reason', NEW.generation_reason
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id,
    target_type, target_id, request_id, trace_id,
    metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), NEW.tenant_id,
    'storefront.cache.family_generation_advanced.v1',
    'storefront.cache.invalidate', 'success', NEW.updated_by,
    'storefront.cache_generation_family', v_aggregate_id,
    NEW.request_id, NEW.trace_id,
    jsonb_build_object('schemaVersion', '1.0', 'eventPayload', v_payload),
    now(), NEW.business_date, 'mod-h-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id,
    schema_version, payload, metadata, correlation_id,
    occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), NEW.tenant_id,
    'storefront.cache.family_generation_advanced.v1',
    'storefront.cache_generation_family', v_aggregate_id,
    '1.0', v_payload,
    jsonb_build_object(
      'requestId', NEW.request_id,
      'traceId', NEW.trace_id,
      'source', 'mod-h'
    ),
    NEW.request_id, now(), NEW.business_date
  );
  RETURN NEW;
END $$;

CREATE TRIGGER cache_generation_families_evidence
  AFTER INSERT OR UPDATE ON storefront.cache_generation_families
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_cache_family_evidence();

CREATE OR REPLACE FUNCTION storefront.advance_cache_family_generation(
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_sales_channel_id uuid,
  p_family text,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(family text, generation bigint, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_generations jsonb;
  v_generation bigint;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  v_replay := storefront.command_replay(
    p_tenant_id,
    'storefront.cache_family.advance',
    p_idempotency_key,
    p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      v_replay ->> 'family',
      (v_replay ->> 'generation')::bigint,
      true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(
    ':', p_tenant_id::text, p_storefront_id::text,
    p_sales_channel_id::text, p_family
  ), 0));

  v_generations := storefront.advance_cache_generation_families_internal(
    p_tenant_id,
    p_storefront_id,
    p_sales_channel_id,
    ARRAY[lower(trim(p_family))],
    p_reason,
    p_actor_id,
    p_request_id,
    p_trace_id,
    p_business_date
  );
  v_generation := (v_generations ->> lower(trim(p_family)))::bigint;

  PERFORM storefront.store_command_receipt(
    p_receipt_id,
    p_tenant_id,
    'storefront.cache_family.advance',
    p_idempotency_key,
    p_request_hash,
    jsonb_build_object(
      'family', lower(trim(p_family)),
      'generation', v_generation::text
    ),
    p_actor_id,
    p_request_id,
    p_trace_id,
    p_business_date
  );
  RETURN QUERY SELECT lower(trim(p_family)), v_generation, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.resolve_public_cache_generations(
  p_hostname text
) RETURNS TABLE(
  tenant_id uuid,
  storefront_id uuid,
  sales_channel_id uuid,
  request_hostname text,
  canonical_hostname text,
  locale text,
  currency text,
  price_list_revision text,
  publication_generation text,
  generation_documents jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform
SET row_security = off AS $$
  WITH host AS (
    SELECT resolved.*
    FROM storefront.resolve_public_host(p_hostname) resolved
    LIMIT 1
  )
  SELECT
    host.tenant_id,
    host.storefront_id,
    host.sales_channel_id,
    host.request_hostname,
    host.canonical_hostname,
    host.locale,
    host.currency,
    host.price_list_revision,
    host.publication_generation,
    family.generations
  FROM host
  JOIN LATERAL (
    SELECT jsonb_object_agg(
      generation.family,
      generation.generation::text
      ORDER BY generation.family
    ) AS generations
    FROM storefront.cache_generation_families generation
    WHERE generation.tenant_id = host.tenant_id
      AND generation.storefront_id = host.storefront_id
      AND generation.sales_channel_id = host.sales_channel_id
      AND generation.locale = host.locale
      AND generation.currency = host.currency
    HAVING count(*) = 9
  ) family ON true;
$$;

GRANT SELECT ON storefront.cache_generation_families
  TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON storefront.cache_generation_families
  FROM store_app_runtime;

REVOKE ALL ON FUNCTION storefront.cache_families_for_reason(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.advance_cache_generation_families_internal(uuid,uuid,uuid,text[],text,uuid,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.advance_cache_generation_internal(uuid,uuid,uuid,text,uuid,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.publish_cache_family_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.advance_cache_family_generation(uuid,uuid,uuid,uuid,text,text,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.resolve_public_cache_generations(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION storefront.advance_cache_family_generation(uuid,uuid,uuid,uuid,text,text,uuid,text,text,text,text,date)
  TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.resolve_public_cache_generations(text)
  TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0016','MOD-H-STOREFRONT','manifest:STF-0016-cache-generation-families.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
