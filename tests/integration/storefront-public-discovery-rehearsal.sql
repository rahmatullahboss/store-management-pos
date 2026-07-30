\set ON_ERROR_STOP on

BEGIN;
SELECT platform.set_request_context(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000020',
  '10000000-0000-4000-8000-000000000146',
  NULL, DATE '2026-07-30', 'storefront-public-discovery-seed', 'trace-storefront-public-discovery'
);

INSERT INTO catalog.categories(
  id, tenant_id, parent_id, code, normalized_code, display_name,
  description, status, sort_order, metadata, created_by, updated_by
) VALUES
(
  '10000000-0000-4000-8000-000000000310',
  '10000000-0000-4000-8000-000000000001',
  NULL, 'CLOTHING', 'clothing', 'Clothing',
  'Published clothing departments.', 'active', 10, '{}'::jsonb,
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
),
(
  '10000000-0000-4000-8000-000000000311',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000310',
  'SHIRTS', 'shirts', 'Shirts',
  'Published shirts.', 'active', 20, '{}'::jsonb,
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
),
(
  '10000000-0000-4000-8000-000000000312',
  '10000000-0000-4000-8000-000000000001',
  NULL, 'ARCHIVED-DISCOVERY', 'archived-discovery', 'Archived Discovery',
  'Must remain hidden even when an online publication row exists.',
  'inactive', 30, '{}'::jsonb,
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);

INSERT INTO catalog.product_categories(tenant_id, product_id, category_id) VALUES
(
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000140',
  '10000000-0000-4000-8000-000000000311'
),
(
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000140',
  '10000000-0000-4000-8000-000000000312'
),
(
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000240',
  '10000000-0000-4000-8000-000000000311'
);

INSERT INTO storefront.category_publications(
  id, tenant_id, storefront_id, sales_channel_id, category_id,
  parent_category_id, publication_state, public_slug, sort_order,
  published_at, created_by, updated_by
) VALUES
(
  '10000000-0000-4000-8000-000000000320',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000100',
  '10000000-0000-4000-8000-000000000110',
  '10000000-0000-4000-8000-000000000310',
  NULL, 'published', 'clothing', 10, now(),
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
),
(
  '10000000-0000-4000-8000-000000000321',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000100',
  '10000000-0000-4000-8000-000000000110',
  '10000000-0000-4000-8000-000000000311',
  '10000000-0000-4000-8000-000000000310',
  'published', 'shirts', 20, now(),
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
),
(
  '10000000-0000-4000-8000-000000000322',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000100',
  '10000000-0000-4000-8000-000000000110',
  '10000000-0000-4000-8000-000000000312',
  NULL, 'published', 'archived-discovery', 30, now(),
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);

INSERT INTO storefront.collections(
  id, tenant_id, storefront_id, sales_channel_id, code, public_slug,
  title, description, publication_state, published_at, created_by, updated_by
) VALUES
(
  '10000000-0000-4000-8000-000000000330',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000100',
  '10000000-0000-4000-8000-000000000110',
  'summer-edit', 'summer-edit', 'Summer Edit',
  'A deterministic published collection.', 'published', now(),
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
),
(
  '10000000-0000-4000-8000-000000000331',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000100',
  '10000000-0000-4000-8000-000000000110',
  'hidden-edit', 'hidden-edit', 'Hidden Edit',
  'Must not resolve publicly.', 'hidden', NULL,
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);

INSERT INTO storefront.collection_members(
  id, tenant_id, collection_id, product_id, variant_id,
  sort_order, created_by
) VALUES
(
  '10000000-0000-4000-8000-000000000340',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000330',
  '10000000-0000-4000-8000-000000000140',
  '10000000-0000-4000-8000-000000000143',
  10, '30000000-0000-4000-8000-000000000001'
),
(
  '10000000-0000-4000-8000-000000000341',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000330',
  '10000000-0000-4000-8000-000000000240',
  '10000000-0000-4000-8000-000000000242',
  20, '30000000-0000-4000-8000-000000000001'
),
(
  '10000000-0000-4000-8000-000000000342',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000331',
  '10000000-0000-4000-8000-000000000140',
  NULL, 10, '30000000-0000-4000-8000-000000000001'
);

COMMIT;

RESET ALL;
SET ROLE store_app_runtime;

DO $test$
DECLARE
  v_category record;
  v_collection record;
  v_search record;
  v_count bigint;
  v_document jsonb;
BEGIN
  SELECT * INTO v_category
  FROM storefront.resolve_public_category('shop.example.test', 'shirts', 24, NULL);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'published category did not resolve';
  END IF;
  IF v_category.category_document #>> '{categoryId}' <>
       '10000000-0000-4000-8000-000000000311'
     OR v_category.category_document #>> '{parentCategoryId}' <>
       '10000000-0000-4000-8000-000000000310'
     OR v_category.category_document #>> '{parentSlug}' <> 'clothing'
     OR v_category.category_document #>> '{breadcrumbs,0,slug}' <> 'clothing'
     OR v_category.category_document #>> '{breadcrumbs,1,slug}' <> 'shirts' THEN
    RAISE EXCEPTION 'public category hierarchy is invalid: %', v_category.category_document;
  END IF;
  IF jsonb_array_length(v_category.product_documents) <> 1
     OR v_category.product_documents #>> '{0,summary,productId}' <>
        '10000000-0000-4000-8000-000000000140'
     OR v_category.product_documents::text LIKE '%Unpriced Product%' THEN
    RAISE EXCEPTION 'public category product filtering is invalid: %', v_category.product_documents;
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.resolve_public_category(
    'shop.example.test', 'archived-discovery', 24, NULL
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'inactive authoritative category unexpectedly resolved';
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.resolve_public_category('missing.example.test', 'shirts', 24, NULL);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unknown host unexpectedly resolved a category';
  END IF;

  SELECT * INTO v_collection
  FROM storefront.resolve_public_collection('shop.example.test', 'summer-edit', 24, NULL);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'published collection did not resolve';
  END IF;
  IF v_collection.collection_document #>> '{collectionId}' <>
       '10000000-0000-4000-8000-000000000330'
     OR jsonb_array_length(v_collection.product_documents) <> 1
     OR v_collection.product_documents #>> '{0,summary,productId}' <>
       '10000000-0000-4000-8000-000000000140'
     OR v_collection.product_documents::text LIKE '%Unpriced Product%' THEN
    RAISE EXCEPTION 'public collection filtering/order is invalid: %', v_collection.product_documents;
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.resolve_public_collection('shop.example.test', 'hidden-edit', 24, NULL);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'hidden collection unexpectedly resolved';
  END IF;

  SELECT * INTO v_search
  FROM storefront.resolve_public_search('shop.example.test', 'linen shirt', 24, NULL);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounded public search did not resolve';
  END IF;
  IF v_search.normalized_query <> 'linen shirt'
     OR jsonb_array_length(v_search.product_documents) <> 1
     OR v_search.product_documents #>> '{0,summary,productId}' <>
        '10000000-0000-4000-8000-000000000140'
     OR v_search.product_documents::text LIKE '%Unpriced Product%'
     OR jsonb_array_length(v_search.facets_document -> 'categories') <> 1
     OR v_search.facets_document #>> '{categories,0,slug}' <> 'shirts'
     OR v_search.facets_document #>> '{availability,0,value}' <> 'available' THEN
    RAISE EXCEPTION 'public search result/facets are invalid: % / %',
      v_search.product_documents, v_search.facets_document;
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.resolve_public_search('shop.example.test', '%%', 24, NULL);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'literal wildcard search did not return a bounded response row';
  END IF;
  SELECT product_documents INTO v_document
  FROM storefront.resolve_public_search('shop.example.test', '%%', 24, NULL);
  IF jsonb_array_length(v_document) <> 0 THEN
    RAISE EXCEPTION 'percent wildcard unexpectedly matched the public catalog';
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.resolve_public_search('shop.example.test', '__', 24, NULL);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'literal underscore search did not return a bounded response row';
  END IF;
  SELECT product_documents INTO v_document
  FROM storefront.resolve_public_search('shop.example.test', '__', 24, NULL);
  IF jsonb_array_length(v_document) <> 0 THEN
    RAISE EXCEPTION 'underscore wildcard unexpectedly matched the public catalog';
  END IF;

  IF NOT has_function_privilege(
    'store_app_runtime',
    'storefront.resolve_public_category(text,text,integer,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'store_app_runtime',
    'storefront.resolve_public_collection(text,text,integer,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'store_app_runtime',
    'storefront.resolve_public_search(text,text,integer,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime cannot execute public discovery resolvers';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc procedure
  CROSS JOIN LATERAL aclexplode(
    COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
  ) acl
  WHERE procedure.oid IN (
    'storefront.resolve_public_category(text,text,integer,uuid)'::regprocedure,
    'storefront.resolve_public_collection(text,text,integer,uuid)'::regprocedure,
    'storefront.resolve_public_search(text,text,integer,uuid)'::regprocedure
  )
    AND acl.grantee = 0
    AND acl.privilege_type = 'EXECUTE';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'PUBLIC can execute a public discovery resolver';
  END IF;
END $test$;

RESET ROLE;

SELECT 'storefront public discovery rehearsal passed' AS result;
