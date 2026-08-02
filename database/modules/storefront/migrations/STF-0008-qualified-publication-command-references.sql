BEGIN;

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
  SELECT storefront_row.status, channel_row.status
    INTO v_storefront_status, v_channel_status
  FROM storefront.storefronts AS storefront_row
  JOIN storefront.sales_channels AS channel_row
    ON channel_row.tenant_id = storefront_row.tenant_id
   AND channel_row.storefront_id = storefront_row.id
  WHERE storefront_row.tenant_id = p_tenant_id
    AND storefront_row.id = p_storefront_id
    AND channel_row.id = p_sales_channel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'storefront sales channel not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_new_state = 'published' AND (v_storefront_status <> 'active' OR v_channel_status <> 'active') THEN
    RAISE EXCEPTION 'publishing requires an active storefront and sales channel' USING ERRCODE = '42501';
  END IF;
  IF p_parent_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM storefront.category_publications AS parent_publication
    WHERE parent_publication.tenant_id = p_tenant_id
      AND parent_publication.sales_channel_id = p_sales_channel_id
      AND parent_publication.category_id = p_parent_category_id
      AND parent_publication.publication_state <> 'archived'
  ) THEN
    RAISE EXCEPTION 'parent category publication not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT category_publication.* INTO v_existing
  FROM storefront.category_publications AS category_publication
  WHERE category_publication.tenant_id = p_tenant_id
    AND category_publication.sales_channel_id = p_sales_channel_id
    AND category_publication.category_id = p_category_id
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
    UPDATE storefront.category_publications AS category_publication
    SET parent_category_id = p_parent_category_id,
        public_slug = lower(p_public_slug),
        sort_order = p_sort_order,
        publication_state = p_new_state,
        scheduled_for = CASE WHEN p_new_state = 'scheduled' THEN p_scheduled_for ELSE NULL END,
        published_at = CASE
          WHEN p_new_state = 'published'
          THEN COALESCE(category_publication.published_at, now())
          ELSE category_publication.published_at
        END,
        updated_by = p_actor_id,
        updated_at = now(),
        version = category_publication.version + 1
    WHERE category_publication.tenant_id = p_tenant_id
      AND category_publication.id = v_existing.id;
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
  SELECT collection_row.* INTO v_collection
  FROM storefront.collections AS collection_row
  WHERE collection_row.tenant_id = p_tenant_id
    AND collection_row.id = p_collection_id
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
    NULLIF(member_document.value ->> 'memberId', '')::uuid,
    NULLIF(member_document.value ->> 'productId', '')::uuid,
    NULLIF(member_document.value ->> 'variantId', '')::uuid,
    COALESCE(NULLIF(member_document.value ->> 'sortOrder', '')::integer, 0)
  FROM jsonb_array_elements(COALESCE(p_members, '[]'::jsonb)) AS member_document(value);

  IF EXISTS (
    SELECT 1
    FROM storefront_member_input AS member_input
    WHERE member_input.member_id IS NULL
       OR member_input.product_id IS NULL
       OR member_input.sort_order NOT BETWEEN -1000000 AND 1000000
  ) THEN
    RAISE EXCEPTION 'collection member document is invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM storefront_member_input AS member_input
    GROUP BY member_input.product_id, member_input.variant_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'collection member document contains duplicates' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM storefront_member_input AS member_input
    LEFT JOIN storefront.product_publications AS product_publication
      ON product_publication.tenant_id = p_tenant_id
     AND product_publication.sales_channel_id = v_collection.sales_channel_id
     AND product_publication.product_id = member_input.product_id
    WHERE product_publication.id IS NULL
       OR product_publication.publication_state = 'archived'
  ) THEN
    RAISE EXCEPTION 'collection member product publication not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM storefront_member_input AS member_input
    LEFT JOIN storefront.variant_publications AS variant_publication
      ON variant_publication.tenant_id = p_tenant_id
     AND variant_publication.sales_channel_id = v_collection.sales_channel_id
     AND variant_publication.variant_id = member_input.variant_id
    WHERE member_input.variant_id IS NOT NULL
      AND (
        variant_publication.id IS NULL
        OR variant_publication.publication_state = 'archived'
      )
  ) THEN
    RAISE EXCEPTION 'collection member variant publication not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_collection.publication_state = 'published' AND EXISTS (
    SELECT 1
    FROM storefront_member_input AS member_input
    JOIN storefront.product_publications AS product_publication
      ON product_publication.tenant_id = p_tenant_id
     AND product_publication.sales_channel_id = v_collection.sales_channel_id
     AND product_publication.product_id = member_input.product_id
    LEFT JOIN storefront.variant_publications AS variant_publication
      ON variant_publication.tenant_id = p_tenant_id
     AND variant_publication.sales_channel_id = v_collection.sales_channel_id
     AND variant_publication.variant_id = member_input.variant_id
    WHERE product_publication.publication_state <> 'published'
       OR (
         member_input.variant_id IS NOT NULL
         AND variant_publication.publication_state <> 'published'
       )
  ) THEN
    RAISE EXCEPTION 'published collection requires published members' USING ERRCODE = '42501';
  END IF;

  DELETE FROM storefront.collection_members AS collection_member
  WHERE collection_member.tenant_id = p_tenant_id
    AND collection_member.collection_id = p_collection_id;
  INSERT INTO storefront.collection_members(
    id, tenant_id, collection_id, product_id, variant_id, sort_order, created_by
  )
  SELECT
    member_input.member_id,
    p_tenant_id,
    p_collection_id,
    member_input.product_id,
    member_input.variant_id,
    member_input.sort_order,
    p_actor_id
  FROM storefront_member_input AS member_input
  ORDER BY
    member_input.sort_order,
    member_input.product_id,
    member_input.variant_id NULLS FIRST;
  GET DIAGNOSTICS v_member_count = ROW_COUNT;

  UPDATE storefront.collections AS collection_row
  SET updated_by = p_actor_id,
      updated_at = now(),
      version = collection_row.version + 1
  WHERE collection_row.tenant_id = p_tenant_id
    AND collection_row.id = p_collection_id;

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
    SELECT 1
    FROM storefront.storefronts AS storefront_row
    WHERE storefront_row.tenant_id = p_tenant_id
      AND storefront_row.id = p_storefront_id
      AND storefront_row.status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(max(navigation_row.revision), 0) + 1 INTO v_revision
  FROM storefront.navigation_documents AS navigation_row
  WHERE navigation_row.tenant_id = p_tenant_id
    AND navigation_row.storefront_id = p_storefront_id
    AND navigation_row.placement = p_placement;

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
  SELECT storefront_row.status INTO v_storefront_status
  FROM storefront.storefronts AS storefront_row
  WHERE storefront_row.tenant_id = p_tenant_id
    AND storefront_row.id = p_storefront_id;
  IF NOT FOUND OR v_storefront_status = 'archived' THEN
    RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_new_status = 'published' AND v_storefront_status <> 'active' THEN
    RAISE EXCEPTION 'publishing content requires an active storefront' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(max(content_page.revision), 0) + 1 INTO v_revision
  FROM storefront.content_pages AS content_page
  WHERE content_page.tenant_id = p_tenant_id
    AND content_page.storefront_id = p_storefront_id
    AND content_page.public_slug = lower(p_public_slug);

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
  SELECT storefront_row.status INTO v_storefront_status
  FROM storefront.storefronts AS storefront_row
  WHERE storefront_row.tenant_id = p_tenant_id
    AND storefront_row.id = p_storefront_id;
  IF NOT FOUND OR v_storefront_status = 'archived' THEN
    RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_new_status = 'published' AND v_storefront_status <> 'active' THEN
    RAISE EXCEPTION 'publishing homepage requires an active storefront' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(max(homepage_row.revision), 0) + 1 INTO v_revision
  FROM storefront.homepage_revisions AS homepage_row
  WHERE homepage_row.tenant_id = p_tenant_id
    AND homepage_row.storefront_id = p_storefront_id;

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

REVOKE ALL ON FUNCTION storefront.set_category_publication(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,text,timestamptz,uuid,text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.replace_collection_members(
  uuid,uuid,uuid,jsonb,uuid,text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.publish_navigation_revision(
  uuid,uuid,uuid,uuid,text,jsonb,text,uuid,text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.publish_content_page_revision(
  uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,timestamptz,uuid,text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.publish_homepage_revision(
  uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,timestamptz,uuid,text,text,text,text,date
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION storefront.set_category_publication(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,text,timestamptz,uuid,text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.replace_collection_members(
  uuid,uuid,uuid,jsonb,uuid,text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.publish_navigation_revision(
  uuid,uuid,uuid,uuid,text,jsonb,text,uuid,text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.publish_content_page_revision(
  uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,timestamptz,uuid,text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.publish_homepage_revision(
  uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,timestamptz,uuid,text,text,text,text,date
) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0008','MOD-H-STOREFRONT','manifest:STF-0008-qualified-publication-command-references.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
