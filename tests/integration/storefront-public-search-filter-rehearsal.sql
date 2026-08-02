\set ON_ERROR_STOP on

SET ROLE store_app_runtime;

DO $test$
DECLARE
  v_search record;
  v_count bigint;
BEGIN
  SELECT * INTO v_search
  FROM storefront.resolve_public_search(
    'shop.example.test',
    'linen shirt',
    'shirts',
    NULL,
    24,
    NULL
  );
  IF NOT FOUND
     OR jsonb_array_length(v_search.product_documents) <> 1
     OR v_search.product_documents #>> '{0,summary,productId}' <>
        '10000000-0000-4000-8000-000000000140' THEN
    RAISE EXCEPTION 'published category filter did not retain the matching product: %',
      v_search.product_documents;
  END IF;

  SELECT * INTO v_search
  FROM storefront.resolve_public_search(
    'shop.example.test',
    'linen shirt',
    'archived-discovery',
    NULL,
    24,
    NULL
  );
  IF NOT FOUND OR jsonb_array_length(v_search.product_documents) <> 0 THEN
    RAISE EXCEPTION 'inactive category filter leaked a product: %',
      v_search.product_documents;
  END IF;

  SELECT * INTO v_search
  FROM storefront.resolve_public_search(
    'shop.example.test',
    'linen shirt',
    NULL,
    'available',
    24,
    NULL
  );
  IF NOT FOUND OR jsonb_array_length(v_search.product_documents) <> 1 THEN
    RAISE EXCEPTION 'available filter did not retain the matching product';
  END IF;

  SELECT * INTO v_search
  FROM storefront.resolve_public_search(
    'shop.example.test',
    'linen shirt',
    NULL,
    'unavailable',
    24,
    NULL
  );
  IF NOT FOUND OR jsonb_array_length(v_search.product_documents) <> 0 THEN
    RAISE EXCEPTION 'unavailable filter unexpectedly retained a product: %',
      v_search.product_documents;
  END IF;

  SELECT * INTO v_search
  FROM storefront.resolve_public_search(
    'shop.example.test',
    'linen shirt',
    'shirts',
    'available',
    24,
    NULL
  );
  IF NOT FOUND
     OR jsonb_array_length(v_search.product_documents) <> 1
     OR jsonb_array_length(v_search.facets_document -> 'categories') <> 1
     OR v_search.facets_document #>> '{categories,0,slug}' <> 'shirts'
     OR v_search.facets_document #>> '{availability,0,value}' <> 'available' THEN
    RAISE EXCEPTION 'combined filters or stable facets are invalid: % / %',
      v_search.product_documents,
      v_search.facets_document;
  END IF;

  SELECT * INTO v_search
  FROM storefront.resolve_public_search(
    'shop.example.test',
    'linen shirt',
    '__invalid__',
    '__invalid__',
    24,
    NULL
  );
  IF NOT FOUND OR jsonb_array_length(v_search.product_documents) <> 0 THEN
    RAISE EXCEPTION 'invalid direct SQL filters did not fail closed';
  END IF;

  IF NOT has_function_privilege(
    'store_app_runtime',
    'storefront.resolve_public_search(text,text,text,text,integer,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime cannot execute the filtered search resolver';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc procedure
  CROSS JOIN LATERAL aclexplode(
    COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
  ) acl
  WHERE procedure.oid =
        'storefront.resolve_public_search(text,text,text,text,integer,uuid)'::regprocedure
    AND acl.grantee = 0
    AND acl.privilege_type = 'EXECUTE';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'PUBLIC can execute the filtered search resolver';
  END IF;
END $test$;

RESET ROLE;

SELECT 'storefront public search filter rehearsal passed' AS result;
