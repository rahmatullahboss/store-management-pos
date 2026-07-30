\set ON_ERROR_STOP on

BEGIN;
SET ROLE store_app_runtime;
SELECT platform.set_request_context(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000020',
  NULL, NULL, DATE '2026-07-30', 'storefront-publishing-rehearsal', 'trace-storefront-publishing'
);

DO $test$
DECLARE
  v_id uuid;
  v_state text;
  v_status text;
  v_replayed boolean;
  v_generation bigint;
  v_prior_generation bigint := 2;
  v_revision bigint;
  v_member_count integer;
  v_count bigint;
BEGIN
  SELECT publication_id, publication_state, cache_generation, replayed
    INTO v_id, v_state, v_generation, v_replayed
  FROM storefront.set_variant_publication(
    '10000000-0000-4000-8000-000000000141',
    '10000000-0000-4000-8000-000000000171',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    '10000000-0000-4000-8000-000000000110',
    '10000000-0000-4000-8000-000000000140',
    '10000000-0000-4000-8000-000000000142',
    'published', 'blue-large', '{"featured":true}'::jsonb,
    '30000000-0000-4000-8000-000000000001',
    'publish-variant-a', repeat('a', 64),
    'publish-variant-a', 'trace-storefront-publishing', DATE '2026-07-30'
  );
  IF v_id <> '10000000-0000-4000-8000-000000000141'
     OR v_state <> 'published' OR v_replayed OR v_generation <= v_prior_generation THEN
    RAISE EXCEPTION 'variant publication result is invalid';
  END IF;
  v_prior_generation := v_generation;

  SELECT publication_id, publication_state, cache_generation, replayed
    INTO v_id, v_state, v_generation, v_replayed
  FROM storefront.set_variant_publication(
    '10000000-0000-4000-8000-000000000141',
    '10000000-0000-4000-8000-000000000172',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    '10000000-0000-4000-8000-000000000110',
    '10000000-0000-4000-8000-000000000140',
    '10000000-0000-4000-8000-000000000142',
    'published', 'blue-large', '{"featured":true}'::jsonb,
    '30000000-0000-4000-8000-000000000001',
    'publish-variant-a', repeat('a', 64),
    'publish-variant-a-replay', 'trace-storefront-publishing', DATE '2026-07-30'
  );
  IF NOT v_replayed OR v_generation <> v_prior_generation THEN
    RAISE EXCEPTION 'variant publication replay is invalid';
  END IF;

  BEGIN
    PERFORM * FROM storefront.set_variant_publication(
      '10000000-0000-4000-8000-000000000141',
      '10000000-0000-4000-8000-000000000173',
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000100',
      '10000000-0000-4000-8000-000000000110',
      '10000000-0000-4000-8000-000000000140',
      '10000000-0000-4000-8000-000000000142',
      'hidden', 'blue-large', '{}'::jsonb,
      '30000000-0000-4000-8000-000000000001',
      'publish-variant-a', repeat('b', 64),
      'publish-variant-a-conflict', 'trace-storefront-publishing', DATE '2026-07-30'
    );
    RAISE EXCEPTION 'variant idempotency conflict unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  SELECT publication_id, publication_state, cache_generation, replayed
    INTO v_id, v_state, v_generation, v_replayed
  FROM storefront.set_category_publication(
    '10000000-0000-4000-8000-000000000180',
    '10000000-0000-4000-8000-000000000181',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    '10000000-0000-4000-8000-000000000110',
    '10000000-0000-4000-8000-000000000182',
    NULL, 'shirts', 10, 'published', NULL,
    '30000000-0000-4000-8000-000000000001',
    'publish-category-a', repeat('c', 64),
    'publish-category-a', 'trace-storefront-publishing', DATE '2026-07-30'
  );
  IF v_state <> 'published' OR v_replayed OR v_generation <= v_prior_generation THEN
    RAISE EXCEPTION 'category publication result is invalid';
  END IF;
  v_prior_generation := v_generation;

  SELECT collection_id, publication_state, cache_generation, replayed
    INTO v_id, v_state, v_generation, v_replayed
  FROM storefront.set_collection(
    '10000000-0000-4000-8000-000000000190',
    '10000000-0000-4000-8000-000000000191',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    '10000000-0000-4000-8000-000000000110',
    'featured', 'featured', 'Featured', 'Featured products',
    'published', NULL,
    '30000000-0000-4000-8000-000000000001',
    'publish-collection-a', repeat('d', 64),
    'publish-collection-a', 'trace-storefront-publishing', DATE '2026-07-30'
  );
  IF v_id <> '10000000-0000-4000-8000-000000000190'
     OR v_state <> 'published' OR v_replayed OR v_generation <= v_prior_generation THEN
    RAISE EXCEPTION 'collection publication result is invalid';
  END IF;
  v_prior_generation := v_generation;

  SELECT collection_id, member_count, cache_generation, replayed
    INTO v_id, v_member_count, v_generation, v_replayed
  FROM storefront.replace_collection_members(
    '10000000-0000-4000-8000-000000000192',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000190',
    jsonb_build_array(jsonb_build_object(
      'memberId', '10000000-0000-4000-8000-000000000193',
      'productId', '10000000-0000-4000-8000-000000000140',
      'variantId', '10000000-0000-4000-8000-000000000142',
      'sortOrder', 1
    )),
    '30000000-0000-4000-8000-000000000001',
    'replace-collection-members-a', repeat('e', 64),
    'replace-collection-members-a', 'trace-storefront-publishing', DATE '2026-07-30'
  );
  IF v_member_count <> 1 OR v_replayed OR v_generation <= v_prior_generation THEN
    RAISE EXCEPTION 'collection member replacement result is invalid';
  END IF;
  v_prior_generation := v_generation;

  SELECT navigation_id, revision, cache_generation, replayed
    INTO v_id, v_revision, v_generation, v_replayed
  FROM storefront.publish_navigation_revision(
    '10000000-0000-4000-8000-000000000200',
    '10000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    'header', '{"items":[{"label":"Home","href":"/"}]}'::jsonb, repeat('f', 64),
    '30000000-0000-4000-8000-000000000001',
    'publish-navigation-a', repeat('1', 64),
    'publish-navigation-a', 'trace-storefront-publishing', DATE '2026-07-30'
  );
  IF v_revision <> 1 OR v_replayed OR v_generation <= v_prior_generation THEN
    RAISE EXCEPTION 'navigation publication result is invalid';
  END IF;
  v_prior_generation := v_generation;

  SELECT content_page_id, revision, status, cache_generation, replayed
    INTO v_id, v_revision, v_status, v_generation, v_replayed
  FROM storefront.publish_content_page_revision(
    '10000000-0000-4000-8000-000000000210',
    '10000000-0000-4000-8000-000000000211',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    'shipping', 'Shipping', 'published',
    '{"blocks":[{"type":"text","value":"Delivery details"}]}'::jsonb,
    '{"title":"Shipping"}'::jsonb, repeat('2', 64), NULL,
    '30000000-0000-4000-8000-000000000001',
    'publish-content-page-a', repeat('3', 64),
    'publish-content-page-a', 'trace-storefront-publishing', DATE '2026-07-30'
  );
  IF v_revision <> 1 OR v_status <> 'published' OR v_replayed
     OR v_generation <= v_prior_generation THEN
    RAISE EXCEPTION 'content page publication result is invalid';
  END IF;
  v_prior_generation := v_generation;

  SELECT homepage_id, revision, status, cache_generation, replayed
    INTO v_id, v_revision, v_status, v_generation, v_replayed
  FROM storefront.publish_homepage_revision(
    '10000000-0000-4000-8000-000000000220',
    '10000000-0000-4000-8000-000000000221',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    'published', '{"blocks":[{"type":"hero","title":"Store"}]}'::jsonb,
    '{"title":"Store"}'::jsonb, repeat('4', 64), NULL,
    '30000000-0000-4000-8000-000000000001',
    'publish-homepage-a', repeat('5', 64),
    'publish-homepage-a', 'trace-storefront-publishing', DATE '2026-07-30'
  );
  IF v_revision <> 1 OR v_status <> 'published' OR v_replayed
     OR v_generation <= v_prior_generation THEN
    RAISE EXCEPTION 'homepage publication result is invalid';
  END IF;

  SELECT publication_id, publication_state, cache_generation, replayed
    INTO v_id, v_state, v_generation, v_replayed
  FROM storefront.set_variant_publication(
    '10000000-0000-4000-8000-000000000141',
    '10000000-0000-4000-8000-000000000230',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    '10000000-0000-4000-8000-000000000110',
    '10000000-0000-4000-8000-000000000140',
    '10000000-0000-4000-8000-000000000142',
    'archived', 'blue-large', '{}'::jsonb,
    '30000000-0000-4000-8000-000000000001',
    'archive-variant-a', repeat('6', 64),
    'archive-variant-a', 'trace-storefront-publishing', DATE '2026-07-30'
  );
  IF v_state <> 'archived' OR v_replayed THEN
    RAISE EXCEPTION 'variant archive result is invalid';
  END IF;

  BEGIN
    PERFORM * FROM storefront.set_variant_publication(
      '10000000-0000-4000-8000-000000000141',
      '10000000-0000-4000-8000-000000000231',
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000100',
      '10000000-0000-4000-8000-000000000110',
      '10000000-0000-4000-8000-000000000140',
      '10000000-0000-4000-8000-000000000142',
      'published', 'blue-large', '{}'::jsonb,
      '30000000-0000-4000-8000-000000000001',
      'reopen-variant-a', repeat('7', 64),
      'reopen-variant-a', 'trace-storefront-publishing', DATE '2026-07-30'
    );
    RAISE EXCEPTION 'archived variant publication unexpectedly reopened';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  SELECT count(*) INTO v_count
  FROM storefront.command_receipts
  WHERE tenant_id = '10000000-0000-4000-8000-000000000001'
    AND command_scope IN (
      'storefront.variant_publication.set',
      'storefront.category_publication.set',
      'storefront.collection.set',
      'storefront.collection_members.replace',
      'storefront.navigation.publish',
      'storefront.content_page.publish',
      'storefront.homepage.publish'
    );
  IF v_count <> 8 THEN
    RAISE EXCEPTION 'unexpected STF-0005 command receipt count: %', v_count;
  END IF;
END $test$;
COMMIT;

BEGIN;
SELECT platform.set_request_context(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000020',
  NULL, NULL, DATE '2026-07-30', 'storefront-publishing-owner-check', 'trace-storefront-publishing'
);
DO $test$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM platform.audit_events
  WHERE tenant_id = '10000000-0000-4000-8000-000000000001'
    AND event_type IN (
      'storefront.variant.publication_changed.v1',
      'storefront.category.publication_changed.v1',
      'storefront.collection.created.v1',
      'storefront.collection.updated.v1',
      'storefront.navigation.published.v1',
      'storefront.content_page.revision_created.v1',
      'storefront.homepage.revision_created.v1'
    );
  IF v_count < 8 THEN
    RAISE EXCEPTION 'STF-0005 audit evidence is incomplete: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM platform.outbox_events
  WHERE tenant_id = '10000000-0000-4000-8000-000000000001'
    AND event_type IN (
      'storefront.variant.publication_changed.v1',
      'storefront.category.publication_changed.v1',
      'storefront.collection.created.v1',
      'storefront.collection.updated.v1',
      'storefront.navigation.published.v1',
      'storefront.content_page.revision_created.v1',
      'storefront.homepage.revision_created.v1'
    );
  IF v_count < 8 THEN
    RAISE EXCEPTION 'STF-0005 outbox evidence is incomplete: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.cache_generations
  WHERE tenant_id = '10000000-0000-4000-8000-000000000001'
    AND storefront_id = '10000000-0000-4000-8000-000000000100'
    AND sales_channel_id = '10000000-0000-4000-8000-000000000110';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'storefront cache generation scope is invalid: %', v_count;
  END IF;
END $test$;
COMMIT;

BEGIN;
SET ROLE store_app_runtime;
SELECT platform.set_request_context(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000010',
  '20000000-0000-4000-8000-000000000020',
  NULL, NULL, DATE '2026-07-30', 'storefront-publishing-tenant-b', 'trace-storefront-publishing-b'
);
DO $test$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM storefront.variant_publications;
  IF v_count <> 0 THEN RAISE EXCEPTION 'tenant B can see tenant A variant publications'; END IF;
  SELECT count(*) INTO v_count FROM storefront.collections;
  IF v_count <> 0 THEN RAISE EXCEPTION 'tenant B can see tenant A collections'; END IF;
  SELECT count(*) INTO v_count FROM storefront.content_pages;
  IF v_count <> 0 THEN RAISE EXCEPTION 'tenant B can see tenant A content pages'; END IF;
END $test$;
RESET ROLE;
COMMIT;

SELECT 'storefront STF-0005 publication rehearsal passed' AS result;
