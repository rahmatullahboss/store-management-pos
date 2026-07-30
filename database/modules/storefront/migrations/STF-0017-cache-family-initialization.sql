BEGIN;

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

  INSERT INTO storefront.cache_generation_families(
    tenant_id, storefront_id, sales_channel_id, locale, currency, family,
    generation, generation_reason, updated_by,
    request_id, trace_id, business_date
  )
  SELECT
    p_tenant_id,
    p_storefront_id,
    p_sales_channel_id,
    v_locale,
    v_currency,
    supported_family.family_name,
    1,
    left('initialize:' || trim(p_reason), 160),
    p_actor_id,
    p_request_id,
    p_trace_id,
    p_business_date
  FROM unnest(ARRAY[
    'bootstrap','content','catalog','product','category',
    'collection','search','sitemap','media'
  ]::text[]) AS supported_family(family_name)
  ON CONFLICT (
    tenant_id, storefront_id, sales_channel_id, locale, currency, family
  ) DO NOTHING;

  FOR v_family IN
    SELECT DISTINCT requested_family.family_name
    FROM unnest(p_families) AS requested_family(family_name)
    ORDER BY requested_family.family_name
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

REVOKE ALL ON FUNCTION storefront.advance_cache_generation_families_internal(
  uuid,uuid,uuid,text[],text,uuid,text,text,date
) FROM PUBLIC;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0017','MOD-H-STOREFRONT','manifest:STF-0017-cache-family-initialization.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
