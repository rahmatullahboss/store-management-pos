BEGIN;

CREATE OR REPLACE FUNCTION storefront.advance_storefront_cache_generations_internal(
  p_tenant_id uuid,
  p_storefront_id uuid,
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
  v_channel record;
  v_generation bigint := 0;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  FOR v_channel IN
    SELECT id
    FROM storefront.sales_channels
    WHERE tenant_id = p_tenant_id
      AND storefront_id = p_storefront_id
      AND status = 'active'
    ORDER BY id
  LOOP
    v_generation := GREATEST(
      v_generation,
      storefront.advance_cache_generation_internal(
        p_tenant_id,
        p_storefront_id,
        v_channel.id,
        p_reason,
        p_actor_id,
        p_request_id,
        p_trace_id,
        p_business_date
      )
    );
  END LOOP;
  RETURN v_generation;
END $$;

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
  SELECT publication_state INTO v_product_state
  FROM storefront.product_publications
  WHERE tenant_id = p_tenant_id
    AND storefront_id = p_storefront_id
    AND sales_channel_id = p_sales_channel_id
    AND product_id = p_product_id
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

CREATE OR REPLACE FUNCTION storefront.set_category_publication(
  p_publication_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_sales_channel_id uuid,
  p_category_id uuid,
  p_parent_category_id uuid,
  p_public_slug text,
  p_sort_order integer,
  p_new_state text,
  p_scheduled_for timestamptz,
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
  v_existing storefront.category_publications%ROWTYPE;
  v_storefront_status text;
  v_channel_status text;
  v_generation bigint;
  v_allowed boolean;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  IF p_new_state NOT IN ('draft','scheduled','published','hidden','archived') THEN
    RAISE EXCEPTION 'invalid category publication state' USING ERRCODE = '22023';
  END IF;
  IF p_new_state = 'scheduled' AND p_scheduled_for IS NULL THEN
    RAISE EXCEPTION 'scheduled category publication requires scheduled_for' USING ERRCODE = '22023';
  END IF;
  IF p_parent_category_id IS NOT NULL AND p_parent_category_id = p_category_id THEN
    RAISE EXCEPTION 'category cannot be its own parent' USING ERRCODE = '22023';
  END IF;
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.category_publication.set', p_idempotency_key, p_request_hash
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
    concat_ws(':', p_tenant_id::text, p_sales_channel_id::text, p_category_id::text), 0
  ));
  SELECT sf.status, sc.status INTO v_storefront_status, v_channel_status
  FROM storefront.storefronts sf
  JOIN storefront.sales_channels sc
    ON sc.tenant_id = sf.tenant_id AND sc.storefront_id = sf.id
  WHERE sf.tenant_id = p_tenant_id
    AND sf.id = p_storefront_id
    AND sc.id = p_sales_channel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'storefront sales channel not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_new_state = 'published' AND (v_storefront_status <> 'active' OR v_channel_status <> 'active') THEN
    RAISE EXCEPTION 'publishing requires an active storefront and sales channel' USING ERRCODE = '42501';
  END IF;
  IF p_parent_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM storefront.category_publications
    WHERE tenant_id = p_tenant_id
      AND sales_channel_id = p_sales_channel_id
      AND category_id = p_parent_category_id
      AND publication_state <> 'archived'
  ) THEN
    RAISE EXCEPTION 'parent category publication not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_existing
  FROM storefront.category_publications
  WHERE tenant_id = p_tenant_id
    AND sales_channel_id = p_sales_channel_id
    AND category_id = p_category_id
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
      RAISE EXCEPTION 'invalid category-publication transition: % -> %',
        v_existing.publication_state, p_new_state USING ERRCODE = '22023';
    END IF;
    UPDATE storefront.category_publications
    SET parent_category_id = p_parent_category_id,
        public_slug = lower(p_public_slug),
        sort_order = p_sort_order,
        publication_state = p_new_state,
        scheduled_for = CASE WHEN p_new_state = 'scheduled' THEN p_scheduled_for ELSE NULL END,
        published_at = CASE WHEN p_new_state = 'published' THEN COALESCE(published_at, now()) ELSE published_at END,
        updated_by = p_actor_id,
        updated_at = now(),
        version = version + 1
    WHERE tenant_id = p_tenant_id AND id = v_existing.id;
    p_publication_id := v_existing.id;
  ELSE
    INSERT INTO storefront.category_publications(
      id, tenant_id, storefront_id, sales_channel_id, category_id,
      parent_category_id, publication_state, public_slug, sort_order,
      scheduled_for, published_at, created_by, updated_by
    ) VALUES (
      p_publication_id, p_tenant_id, p_storefront_id, p_sales_channel_id,
      p_category_id, p_parent_category_id, p_new_state, lower(p_public_slug), p_sort_order,
      CASE WHEN p_new_state = 'scheduled' THEN p_scheduled_for ELSE NULL END,
      CASE WHEN p_new_state = 'published' THEN now() ELSE NULL END,
      p_actor_id, p_actor_id
    );
  END IF;

  v_generation := storefront.advance_cache_generation_internal(
    p_tenant_id, p_storefront_id, p_sales_channel_id,
    'category_publication:' || p_category_id::text,
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.category_publication.set',
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

CREATE OR REPLACE FUNCTION storefront.set_collection(
  p_collection_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_sales_channel_id uuid,
  p_code text,
  p_public_slug text,
  p_title text,
  p_description text,
  p_new_state text,
  p_scheduled_for timestamptz,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(collection_id uuid, publication_state text, cache_generation bigint, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_existing storefront.collections%ROWTYPE;
  v_storefront_status text;
  v_channel_status text;
  v_generation bigint;
  v_allowed boolean;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  IF p_new_state NOT IN ('draft','scheduled','published','hidden','archived') THEN
    RAISE EXCEPTION 'invalid collection publication state' USING ERRCODE = '22023';
  END IF;
  IF p_new_state = 'scheduled' AND p_scheduled_for IS NULL THEN
    RAISE EXCEPTION 'scheduled collection requires scheduled_for' USING ERRCODE = '22023';
  END IF;
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.collection.set', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'collectionId')::uuid,
      v_replay ->> 'publicationState',
      (v_replay ->> 'cacheGeneration')::bigint,
      true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_tenant_id::text, p_sales_channel_id::text, 'collection', lower(p_code)), 0
  ));
  SELECT sf.status, sc.status INTO v_storefront_status, v_channel_status
  FROM storefront.storefronts sf
  JOIN storefront.sales_channels sc
    ON sc.tenant_id = sf.tenant_id AND sc.storefront_id = sf.id
  WHERE sf.tenant_id = p_tenant_id
    AND sf.id = p_storefront_id
    AND sc.id = p_sales_channel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'storefront sales channel not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_new_state = 'published' AND (v_storefront_status <> 'active' OR v_channel_status <> 'active') THEN
    RAISE EXCEPTION 'publishing requires an active storefront and sales channel' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM storefront.collections
  WHERE tenant_id = p_tenant_id
    AND sales_channel_id = p_sales_channel_id
    AND code = lower(p_code)
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
      RAISE EXCEPTION 'invalid collection transition: % -> %',
        v_existing.publication_state, p_new_state USING ERRCODE = '22023';
    END IF;
    UPDATE storefront.collections
    SET public_slug = lower(p_public_slug),
        title = p_title,
        description = p_description,
        publication_state = p_new_state,
        scheduled_for = CASE WHEN p_new_state = 'scheduled' THEN p_scheduled_for ELSE NULL END,
        published_at = CASE WHEN p_new_state = 'published' THEN COALESCE(published_at, now()) ELSE published_at END,
        updated_by = p_actor_id,
        updated_at = now(),
        version = version + 1
    WHERE tenant_id = p_tenant_id AND id = v_existing.id;
    p_collection_id := v_existing.id;
  ELSE
    INSERT INTO storefront.collections(
      id, tenant_id, storefront_id, sales_channel_id, code, public_slug,
      title, description, publication_state, scheduled_for, published_at,
      created_by, updated_by
    ) VALUES (
      p_collection_id, p_tenant_id, p_storefront_id, p_sales_channel_id,
      lower(p_code), lower(p_public_slug), p_title, p_description, p_new_state,
      CASE WHEN p_new_state = 'scheduled' THEN p_scheduled_for ELSE NULL END,
      CASE WHEN p_new_state = 'published' THEN now() ELSE NULL END,
      p_actor_id, p_actor_id
    );
  END IF;

  v_generation := storefront.advance_cache_generation_internal(
    p_tenant_id, p_storefront_id, p_sales_channel_id,
    'collection:' || p_collection_id::text,
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.collection.set',
    p_idempotency_key, p_request_hash,
    jsonb_build_object(
      'collectionId', p_collection_id,
      'publicationState', p_new_state,
      'cacheGeneration', v_generation
    ),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_collection_id, p_new_state, v_generation, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.replace_collection_members(
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_collection_id uuid,
  p_members jsonb,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(collection_id uuid, member_count integer, cache_generation bigint, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_collection storefront.collections%ROWTYPE;
  v_generation bigint;
  v_member_count integer;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  IF jsonb_typeof(COALESCE(p_members, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'collection members must be an array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(COALESCE(p_members, '[]'::jsonb)) > 500 THEN
    RAISE EXCEPTION 'collection member limit exceeded' USING ERRCODE = '22023';
  END IF;
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.collection_members.replace', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'collectionId')::uuid,
      (v_replay ->> 'memberCount')::integer,
      (v_replay ->> 'cacheGeneration')::bigint,
      true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_tenant_id::text, p_collection_id::text, 'members'), 0
  ));
  SELECT * INTO v_collection
  FROM storefront.collections
  WHERE tenant_id = p_tenant_id AND id = p_collection_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'collection not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_collection.publication_state = 'archived' THEN
    RAISE EXCEPTION 'archived collection members cannot change' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE storefront_member_input(
    member_id uuid NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid NULL,
    sort_order integer NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO storefront_member_input(member_id, product_id, variant_id, sort_order)
  SELECT
    NULLIF(value ->> 'memberId', '')::uuid,
    NULLIF(value ->> 'productId', '')::uuid,
    NULLIF(value ->> 'variantId', '')::uuid,
    COALESCE(NULLIF(value ->> 'sortOrder', '')::integer, 0)
  FROM jsonb_array_elements(COALESCE(p_members, '[]'::jsonb));

  IF EXISTS (
    SELECT 1 FROM storefront_member_input
    WHERE member_id IS NULL OR product_id IS NULL OR sort_order NOT BETWEEN -1000000 AND 1000000
  ) THEN
    RAISE EXCEPTION 'collection member document is invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storefront_member_input
    GROUP BY product_id, variant_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'collection member document contains duplicates' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM storefront_member_input input
    LEFT JOIN storefront.product_publications product
      ON product.tenant_id = p_tenant_id
     AND product.sales_channel_id = v_collection.sales_channel_id
     AND product.product_id = input.product_id
    WHERE product.id IS NULL OR product.publication_state = 'archived'
  ) THEN
    RAISE EXCEPTION 'collection member product publication not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM storefront_member_input input
    LEFT JOIN storefront.variant_publications variant
      ON variant.tenant_id = p_tenant_id
     AND variant.sales_channel_id = v_collection.sales_channel_id
     AND variant.variant_id = input.variant_id
    WHERE input.variant_id IS NOT NULL
      AND (variant.id IS NULL OR variant.publication_state = 'archived')
  ) THEN
    RAISE EXCEPTION 'collection member variant publication not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_collection.publication_state = 'published' AND EXISTS (
    SELECT 1
    FROM storefront_member_input input
    JOIN storefront.product_publications product
      ON product.tenant_id = p_tenant_id
     AND product.sales_channel_id = v_collection.sales_channel_id
     AND product.product_id = input.product_id
    LEFT JOIN storefront.variant_publications variant
      ON variant.tenant_id = p_tenant_id
     AND variant.sales_channel_id = v_collection.sales_channel_id
     AND variant.variant_id = input.variant_id
    WHERE product.publication_state <> 'published'
       OR (input.variant_id IS NOT NULL AND variant.publication_state <> 'published')
  ) THEN
    RAISE EXCEPTION 'published collection requires published members' USING ERRCODE = '42501';
  END IF;

  DELETE FROM storefront.collection_members
  WHERE tenant_id = p_tenant_id AND collection_id = p_collection_id;
  INSERT INTO storefront.collection_members(
    id, tenant_id, collection_id, product_id, variant_id, sort_order, created_by
  )
  SELECT member_id, p_tenant_id, p_collection_id, product_id, variant_id, sort_order, p_actor_id
  FROM storefront_member_input
  ORDER BY sort_order, product_id, variant_id NULLS FIRST;
  GET DIAGNOSTICS v_member_count = ROW_COUNT;

  UPDATE storefront.collections
  SET updated_by = p_actor_id, updated_at = now(), version = version + 1
  WHERE tenant_id = p_tenant_id AND id = p_collection_id;

  v_generation := storefront.advance_cache_generation_internal(
    p_tenant_id, v_collection.storefront_id, v_collection.sales_channel_id,
    'collection_members:' || p_collection_id::text,
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.collection_members.replace',
    p_idempotency_key, p_request_hash,
    jsonb_build_object(
      'collectionId', p_collection_id,
      'memberCount', v_member_count,
      'cacheGeneration', v_generation
    ),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_collection_id, v_member_count, v_generation, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.publish_navigation_revision(
  p_navigation_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_placement text,
  p_navigation_document jsonb,
  p_document_hash text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(navigation_id uuid, revision bigint, cache_generation bigint, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_revision bigint;
  v_generation bigint;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  IF p_placement NOT IN ('header','footer','utility') THEN
    RAISE EXCEPTION 'invalid navigation placement' USING ERRCODE = '22023';
  END IF;
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.navigation.publish', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'navigationId')::uuid,
      (v_replay ->> 'revision')::bigint,
      (v_replay ->> 'cacheGeneration')::bigint,
      true;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_tenant_id::text, p_storefront_id::text, 'navigation', p_placement), 0
  ));
  IF NOT EXISTS (
    SELECT 1 FROM storefront.storefronts
    WHERE tenant_id = p_tenant_id AND id = p_storefront_id AND status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(max(revision), 0) + 1 INTO v_revision
  FROM storefront.navigation_documents
  WHERE tenant_id = p_tenant_id AND storefront_id = p_storefront_id AND placement = p_placement;

  INSERT INTO storefront.navigation_documents(
    id, tenant_id, storefront_id, placement, revision, status,
    navigation_document, document_hash, created_by, published_by, published_at,
    request_id, trace_id, business_date
  ) VALUES (
    p_navigation_id, p_tenant_id, p_storefront_id, p_placement, v_revision, 'published',
    p_navigation_document, p_document_hash, p_actor_id, p_actor_id, now(),
    p_request_id, p_trace_id, p_business_date
  );
  v_generation := storefront.advance_storefront_cache_generations_internal(
    p_tenant_id, p_storefront_id, 'navigation_publish:' || p_placement,
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.navigation.publish',
    p_idempotency_key, p_request_hash,
    jsonb_build_object(
      'navigationId', p_navigation_id,
      'revision', v_revision,
      'cacheGeneration', v_generation
    ),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_navigation_id, v_revision, v_generation, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.publish_content_page_revision(
  p_content_page_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_public_slug text,
  p_title text,
  p_new_status text,
  p_content_document jsonb,
  p_seo_document jsonb,
  p_document_hash text,
  p_scheduled_for timestamptz,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(content_page_id uuid, revision bigint, status text, cache_generation bigint, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_revision bigint;
  v_storefront_status text;
  v_generation bigint := 0;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  IF p_new_status NOT IN ('scheduled','published','hidden','archived') THEN
    RAISE EXCEPTION 'invalid content page status' USING ERRCODE = '22023';
  END IF;
  IF p_new_status = 'scheduled' AND p_scheduled_for IS NULL THEN
    RAISE EXCEPTION 'scheduled content page requires scheduled_for' USING ERRCODE = '22023';
  END IF;
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.content_page.publish', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'contentPageId')::uuid,
      (v_replay ->> 'revision')::bigint,
      v_replay ->> 'status',
      (v_replay ->> 'cacheGeneration')::bigint,
      true;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_tenant_id::text, p_storefront_id::text, 'content', lower(p_public_slug)), 0
  ));
  SELECT status INTO v_storefront_status
  FROM storefront.storefronts
  WHERE tenant_id = p_tenant_id AND id = p_storefront_id;
  IF NOT FOUND OR v_storefront_status = 'archived' THEN
    RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_new_status = 'published' AND v_storefront_status <> 'active' THEN
    RAISE EXCEPTION 'publishing content requires an active storefront' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(max(revision), 0) + 1 INTO v_revision
  FROM storefront.content_pages
  WHERE tenant_id = p_tenant_id
    AND storefront_id = p_storefront_id
    AND public_slug = lower(p_public_slug);

  INSERT INTO storefront.content_pages(
    id, tenant_id, storefront_id, public_slug, revision, title, status,
    content_document, seo_document, document_hash, scheduled_for,
    created_by, published_by, published_at, request_id, trace_id, business_date
  ) VALUES (
    p_content_page_id, p_tenant_id, p_storefront_id, lower(p_public_slug), v_revision,
    p_title, p_new_status, p_content_document, COALESCE(p_seo_document, '{}'::jsonb),
    p_document_hash, CASE WHEN p_new_status = 'scheduled' THEN p_scheduled_for ELSE NULL END,
    p_actor_id, CASE WHEN p_new_status = 'published' THEN p_actor_id ELSE NULL END,
    CASE WHEN p_new_status = 'published' THEN now() ELSE NULL END,
    p_request_id, p_trace_id, p_business_date
  );
  IF p_new_status IN ('published','hidden','archived') THEN
    v_generation := storefront.advance_storefront_cache_generations_internal(
      p_tenant_id, p_storefront_id, 'content_page:' || lower(p_public_slug),
      p_actor_id, p_request_id, p_trace_id, p_business_date
    );
  END IF;
  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.content_page.publish',
    p_idempotency_key, p_request_hash,
    jsonb_build_object(
      'contentPageId', p_content_page_id,
      'revision', v_revision,
      'status', p_new_status,
      'cacheGeneration', v_generation
    ),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_content_page_id, v_revision, p_new_status, v_generation, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.publish_homepage_revision(
  p_homepage_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_new_status text,
  p_homepage_document jsonb,
  p_seo_document jsonb,
  p_document_hash text,
  p_scheduled_for timestamptz,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(homepage_id uuid, revision bigint, status text, cache_generation bigint, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_revision bigint;
  v_storefront_status text;
  v_generation bigint := 0;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  IF p_new_status NOT IN ('scheduled','published','archived') THEN
    RAISE EXCEPTION 'invalid homepage status' USING ERRCODE = '22023';
  END IF;
  IF p_new_status = 'scheduled' AND p_scheduled_for IS NULL THEN
    RAISE EXCEPTION 'scheduled homepage requires scheduled_for' USING ERRCODE = '22023';
  END IF;
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.homepage.publish', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'homepageId')::uuid,
      (v_replay ->> 'revision')::bigint,
      v_replay ->> 'status',
      (v_replay ->> 'cacheGeneration')::bigint,
      true;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_tenant_id::text, p_storefront_id::text, 'homepage'), 0
  ));
  SELECT status INTO v_storefront_status
  FROM storefront.storefronts
  WHERE tenant_id = p_tenant_id AND id = p_storefront_id;
  IF NOT FOUND OR v_storefront_status = 'archived' THEN
    RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_new_status = 'published' AND v_storefront_status <> 'active' THEN
    RAISE EXCEPTION 'publishing homepage requires an active storefront' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(max(revision), 0) + 1 INTO v_revision
  FROM storefront.homepage_revisions
  WHERE tenant_id = p_tenant_id AND storefront_id = p_storefront_id;

  INSERT INTO storefront.homepage_revisions(
    id, tenant_id, storefront_id, revision, status, homepage_document,
    seo_document, document_hash, scheduled_for, created_by, published_by,
    published_at, request_id, trace_id, business_date
  ) VALUES (
    p_homepage_id, p_tenant_id, p_storefront_id, v_revision, p_new_status,
    p_homepage_document, COALESCE(p_seo_document, '{}'::jsonb), p_document_hash,
    CASE WHEN p_new_status = 'scheduled' THEN p_scheduled_for ELSE NULL END,
    p_actor_id, CASE WHEN p_new_status = 'published' THEN p_actor_id ELSE NULL END,
    CASE WHEN p_new_status = 'published' THEN now() ELSE NULL END,
    p_request_id, p_trace_id, p_business_date
  );
  IF p_new_status IN ('published','archived') THEN
    v_generation := storefront.advance_storefront_cache_generations_internal(
      p_tenant_id, p_storefront_id, 'homepage:' || p_new_status,
      p_actor_id, p_request_id, p_trace_id, p_business_date
    );
  END IF;
  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.homepage.publish',
    p_idempotency_key, p_request_hash,
    jsonb_build_object(
      'homepageId', p_homepage_id,
      'revision', v_revision,
      'status', p_new_status,
      'cacheGeneration', v_generation
    ),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_homepage_id, v_revision, p_new_status, v_generation, false;
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
    WHEN 'variant_publications' THEN
      v_event_type := 'storefront.variant.publication_changed.v1';
      v_action := 'storefront.variant_publication.set';
      v_aggregate_type := 'storefront.variant_publication';
    WHEN 'category_publications' THEN
      v_event_type := 'storefront.category.publication_changed.v1';
      v_action := 'storefront.category_publication.set';
      v_aggregate_type := 'storefront.category_publication';
    WHEN 'collections' THEN
      v_event_type := CASE WHEN TG_OP = 'INSERT' THEN 'storefront.collection.created.v1' ELSE 'storefront.collection.updated.v1' END;
      v_action := CASE WHEN TG_OP = 'INSERT' THEN 'storefront.collection.create' ELSE 'storefront.collection.update' END;
      v_aggregate_type := 'storefront.collection';
    WHEN 'theme_revisions' THEN
      v_event_type := 'storefront.theme.published.v1';
      v_action := 'storefront.theme.publish';
      v_aggregate_type := 'storefront.theme_revision';
    WHEN 'navigation_documents' THEN
      v_event_type := 'storefront.navigation.published.v1';
      v_action := 'storefront.navigation.publish';
      v_aggregate_type := 'storefront.navigation_revision';
    WHEN 'content_pages' THEN
      v_event_type := 'storefront.content_page.revision_created.v1';
      v_action := 'storefront.content_page.publish';
      v_aggregate_type := 'storefront.content_page';
    WHEN 'homepage_revisions' THEN
      v_event_type := 'storefront.homepage.revision_created.v1';
      v_action := 'storefront.homepage.publish';
      v_aggregate_type := 'storefront.homepage_revision';
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
    'variantId', v_row ->> 'variant_id',
    'categoryId', v_row ->> 'category_id',
    'collectionId', CASE WHEN TG_TABLE_NAME = 'collections' THEN v_row ->> 'id' ELSE v_row ->> 'collection_id' END,
    'domainId', v_row ->> 'domain_id',
    'hostname', v_row ->> 'hostname',
    'publicSlug', v_row ->> 'public_slug',
    'placement', v_row ->> 'placement',
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

CREATE TRIGGER variant_publications_evidence
  AFTER INSERT OR UPDATE ON storefront.variant_publications
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_command_evidence();
CREATE TRIGGER category_publications_evidence
  AFTER INSERT OR UPDATE ON storefront.category_publications
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_command_evidence();
CREATE TRIGGER collections_evidence
  AFTER INSERT OR UPDATE ON storefront.collections
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_command_evidence();
CREATE TRIGGER navigation_documents_evidence
  AFTER INSERT ON storefront.navigation_documents
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_command_evidence();
CREATE TRIGGER content_pages_evidence
  AFTER INSERT ON storefront.content_pages
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_command_evidence();
CREATE TRIGGER homepage_revisions_evidence
  AFTER INSERT ON storefront.homepage_revisions
  FOR EACH ROW EXECUTE FUNCTION storefront.publish_command_evidence();

REVOKE ALL ON FUNCTION storefront.advance_storefront_cache_generations_internal(uuid,uuid,text,uuid,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.set_variant_publication(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.set_category_publication(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,text,timestamptz,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.set_collection(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,timestamptz,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.replace_collection_members(uuid,uuid,uuid,jsonb,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.publish_navigation_revision(uuid,uuid,uuid,uuid,text,jsonb,text,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.publish_content_page_revision(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,timestamptz,uuid,text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.publish_homepage_revision(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,timestamptz,uuid,text,text,text,text,date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION storefront.set_variant_publication(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.set_category_publication(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,text,timestamptz,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.set_collection(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,timestamptz,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.replace_collection_members(uuid,uuid,uuid,jsonb,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.publish_navigation_revision(uuid,uuid,uuid,uuid,text,jsonb,text,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.publish_content_page_revision(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,timestamptz,uuid,text,text,text,text,date) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.publish_homepage_revision(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,timestamptz,uuid,text,text,text,text,date) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0005','MOD-H-STOREFRONT','manifest:STF-0005-publication-content-commands.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
