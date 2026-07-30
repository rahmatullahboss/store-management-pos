BEGIN;

CREATE OR REPLACE FUNCTION storefront.set_variant_publication(
  p_publication_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_sales_channel_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_new_state text,
  p_public_slug_suffix text,
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
  v_existing storefront.variant_publications%ROWTYPE;
  v_product_state text;
  v_generation bigint;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  IF p_new_state NOT IN ('published','hidden','archived') THEN
    RAISE EXCEPTION 'invalid variant publication state' USING ERRCODE = '22023';
  END IF;
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.variant_publication.set', p_idempotency_key, p_request_hash
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
    concat_ws(':', p_tenant_id::text, p_sales_channel_id::text, p_variant_id::text), 0
  ));
  SELECT product_publication.publication_state INTO v_product_state
  FROM storefront.product_publications AS product_publication
  WHERE product_publication.tenant_id = p_tenant_id
    AND product_publication.storefront_id = p_storefront_id
    AND product_publication.sales_channel_id = p_sales_channel_id
    AND product_publication.product_id = p_product_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product publication not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_new_state = 'published' AND v_product_state <> 'published' THEN
    RAISE EXCEPTION 'published variant requires a published product' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM storefront.variant_publications
  WHERE tenant_id = p_tenant_id
    AND sales_channel_id = p_sales_channel_id
    AND variant_id = p_variant_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.publication_state = 'archived' AND p_new_state <> 'archived' THEN
      RAISE EXCEPTION 'archived variant publication cannot be reopened' USING ERRCODE = '22023';
    END IF;
    UPDATE storefront.variant_publications
    SET product_id = p_product_id,
        publication_state = p_new_state,
        public_slug_suffix = NULLIF(lower(p_public_slug_suffix), ''),
        metadata = COALESCE(p_metadata, '{}'::jsonb),
        updated_by = p_actor_id,
        updated_at = now(),
        version = version + 1
    WHERE tenant_id = p_tenant_id AND id = v_existing.id;
    p_publication_id := v_existing.id;
  ELSE
    INSERT INTO storefront.variant_publications(
      id, tenant_id, storefront_id, sales_channel_id, product_id, variant_id,
      publication_state, public_slug_suffix, metadata, created_by, updated_by
    ) VALUES (
      p_publication_id, p_tenant_id, p_storefront_id, p_sales_channel_id,
      p_product_id, p_variant_id, p_new_state,
      NULLIF(lower(p_public_slug_suffix), ''), COALESCE(p_metadata, '{}'::jsonb),
      p_actor_id, p_actor_id
    );
  END IF;

  v_generation := storefront.advance_cache_generation_internal(
    p_tenant_id, p_storefront_id, p_sales_channel_id,
    'variant_publication:' || p_variant_id::text,
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.variant_publication.set',
    p_idempotency_key, p_request_hash,
    jsonb_build_object(
      'publicationId', p_publication_id,
      'publicationState', p_new_state,
      'cacheGeneration', v_generation
    ),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_publication_id, p_new_state, v_generation, false;
END $$;

REVOKE ALL ON FUNCTION storefront.set_variant_publication(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,text,text,text,date
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storefront.set_variant_publication(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,text,text,text,date
) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0007','MOD-H-STOREFRONT','manifest:STF-0007-qualified-product-publication-reference.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
