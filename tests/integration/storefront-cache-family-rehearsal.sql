\set ON_ERROR_STOP on

BEGIN;
SET ROLE store_app_runtime;
SELECT platform.set_request_context(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000020',
  NULL, NULL, DATE '2026-07-30', 'storefront-cache-family-rehearsal', 'trace-storefront-cache-family'
);

DO $test$
DECLARE
  v_bundle record;
  v_family text;
  v_generation bigint;
  v_replayed boolean;
  v_media_before bigint;
  v_catalog_before bigint;
  v_media_after bigint;
  v_catalog_after bigint;
  v_count bigint;
BEGIN
  SELECT * INTO v_bundle
  FROM storefront.resolve_public_cache_generations('shop.example.test');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'public cache generation bundle did not resolve';
  END IF;
  IF v_bundle.tenant_id <> '10000000-0000-4000-8000-000000000001'
     OR v_bundle.storefront_id <> '10000000-0000-4000-8000-000000000100'
     OR v_bundle.sales_channel_id <> '10000000-0000-4000-8000-000000000110'
     OR v_bundle.request_hostname <> 'shop.example.test'
     OR v_bundle.canonical_hostname <> 'shop.example.test' THEN
    RAISE EXCEPTION 'public cache generation scope is invalid';
  END IF;
  SELECT count(*) INTO v_count
  FROM jsonb_object_keys(v_bundle.generation_documents);
  IF v_count <> 9 THEN
    RAISE EXCEPTION 'cache generation family count is invalid: %', v_bundle.generation_documents;
  END IF;
  FOREACH v_family IN ARRAY ARRAY[
    'bootstrap','content','catalog','product','category',
    'collection','search','sitemap','media'
  ] LOOP
    IF NOT v_bundle.generation_documents ? v_family
       OR (v_bundle.generation_documents ->> v_family) !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'cache generation family is missing or invalid: %', v_family;
    END IF;
  END LOOP;

  v_media_before := (v_bundle.generation_documents ->> 'media')::bigint;
  v_catalog_before := (v_bundle.generation_documents ->> 'catalog')::bigint;

  SELECT family, generation, replayed
    INTO v_family, v_generation, v_replayed
  FROM storefront.advance_cache_family_generation(
    '10000000-0000-4000-8000-000000000360',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    '10000000-0000-4000-8000-000000000110',
    'media',
    'media_asset_refresh',
    '30000000-0000-4000-8000-000000000001',
    'cache-family-media-a',
    repeat('9', 64),
    'cache-family-media-a',
    'trace-storefront-cache-family',
    DATE '2026-07-30'
  );
  IF v_family <> 'media'
     OR v_generation <> v_media_before + 1
     OR v_replayed THEN
    RAISE EXCEPTION 'targeted media cache generation result is invalid';
  END IF;

  SELECT family, generation, replayed
    INTO v_family, v_generation, v_replayed
  FROM storefront.advance_cache_family_generation(
    '10000000-0000-4000-8000-000000000361',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    '10000000-0000-4000-8000-000000000110',
    'media',
    'media_asset_refresh',
    '30000000-0000-4000-8000-000000000001',
    'cache-family-media-a',
    repeat('9', 64),
    'cache-family-media-a-replay',
    'trace-storefront-cache-family',
    DATE '2026-07-30'
  );
  IF v_family <> 'media'
     OR v_generation <> v_media_before + 1
     OR NOT v_replayed THEN
    RAISE EXCEPTION 'targeted media cache generation replay is invalid';
  END IF;

  BEGIN
    PERFORM * FROM storefront.advance_cache_family_generation(
      '10000000-0000-4000-8000-000000000362',
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000100',
      '10000000-0000-4000-8000-000000000110',
      'media',
      'media_asset_refresh',
      '30000000-0000-4000-8000-000000000001',
      'cache-family-media-a',
      repeat('8', 64),
      'cache-family-media-a-conflict',
      'trace-storefront-cache-family',
      DATE '2026-07-30'
    );
    RAISE EXCEPTION 'cache-family idempotency conflict unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  SELECT * INTO v_bundle
  FROM storefront.resolve_public_cache_generations('shop.example.test');
  v_media_after := (v_bundle.generation_documents ->> 'media')::bigint;
  v_catalog_after := (v_bundle.generation_documents ->> 'catalog')::bigint;
  IF v_media_after <> v_media_before + 1 THEN
    RAISE EXCEPTION 'media cache generation did not advance exactly once';
  END IF;
  IF v_catalog_after <> v_catalog_before THEN
    RAISE EXCEPTION 'targeted media invalidation changed catalog generation';
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.resolve_public_cache_generations('missing.example.test');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unknown host unexpectedly resolved cache generations';
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.command_receipts
  WHERE tenant_id = '10000000-0000-4000-8000-000000000001'
    AND command_type = 'storefront.cache_family.advance'
    AND idempotency_key = 'cache-family-media-a';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'cache-family command receipt evidence is invalid';
  END IF;

  SELECT count(*) INTO v_count
  FROM platform.audit_events
  WHERE tenant_id = '10000000-0000-4000-8000-000000000001'
    AND event_type = 'storefront.cache.family_generation_advanced.v1'
    AND request_id = 'cache-family-media-a';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'cache-family audit evidence is invalid';
  END IF;

  SELECT count(*) INTO v_count
  FROM platform.outbox_events
  WHERE tenant_id = '10000000-0000-4000-8000-000000000001'
    AND event_type = 'storefront.cache.family_generation_advanced.v1'
    AND correlation_id = 'cache-family-media-a';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'cache-family outbox evidence is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))
    ) function_acl
    WHERE procedure_row.oid = 'storefront.resolve_public_cache_generations(text)'::regprocedure
      AND function_acl.grantee = 0
      AND function_acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can execute cache generation resolver';
  END IF;
  IF NOT has_function_privilege(
    'store_app_runtime',
    'storefront.resolve_public_cache_generations(text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'store_app_runtime',
    'storefront.advance_cache_family_generation(uuid,uuid,uuid,uuid,text,text,uuid,text,text,text,text,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime cache generation privileges are incomplete';
  END IF;
END $test$;

COMMIT;
RESET ROLE;

DO $policy$
BEGIN
  IF storefront.cache_families_for_reason('theme_publish') <>
     ARRAY['content','sitemap']::text[] THEN
    RAISE EXCEPTION 'theme invalidation family policy is invalid';
  END IF;
  IF storefront.cache_families_for_reason('category_publication:published') <>
     ARRAY['catalog','category','search','sitemap']::text[] THEN
    RAISE EXCEPTION 'category invalidation family policy is invalid';
  END IF;
  IF storefront.cache_families_for_reason('collection_publish') <>
     ARRAY['catalog','collection','search','sitemap']::text[] THEN
    RAISE EXCEPTION 'collection invalidation family policy is invalid';
  END IF;
  IF storefront.cache_families_for_reason('product_publication:published') <>
     ARRAY['catalog','product','category','collection','search','sitemap','media']::text[] THEN
    RAISE EXCEPTION 'product invalidation family policy is invalid';
  END IF;
  IF storefront.cache_families_for_reason('unknown_policy_reason') <>
     ARRAY[
       'bootstrap','content','catalog','product','category',
       'collection','search','sitemap','media'
     ]::text[] THEN
    RAISE EXCEPTION 'unknown invalidation reason must conservatively advance all families';
  END IF;
  IF has_function_privilege(
    'store_app_runtime',
    'storefront.cache_families_for_reason(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime can execute internal cache invalidation policy function';
  END IF;
END $policy$;

SELECT 'storefront cache family rehearsal passed' AS result;
