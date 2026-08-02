\set ON_ERROR_STOP on

RESET ALL;
SET ROLE store_app_runtime;

DO $test$
DECLARE
  v_seo record;
  v_count bigint;
  v_paths text;
BEGIN
  SELECT * INTO v_seo
  FROM storefront.resolve_public_seo('shop.example.test');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'public SEO bundle did not resolve';
  END IF;
  IF v_seo.tenant_id <> '10000000-0000-4000-8000-000000000001'
     OR v_seo.storefront_id <> '10000000-0000-4000-8000-000000000100'
     OR v_seo.sales_channel_id <> '10000000-0000-4000-8000-000000000110'
     OR v_seo.canonical_hostname <> 'shop.example.test' THEN
    RAISE EXCEPTION 'public SEO scope is invalid';
  END IF;
  IF NOT v_seo.indexable
     OR v_seo.sitemap_path <> '/sitemap.xml'
     OR NOT v_seo.disallow_paths @> ARRAY['/account','/checkout','/api']::text[] THEN
    RAISE EXCEPTION 'public SEO policy is invalid';
  END IF;
  IF jsonb_array_length(v_seo.entry_documents) < 6 THEN
    RAISE EXCEPTION 'public SEO entries are incomplete: %', v_seo.entry_documents;
  END IF;

  SELECT string_agg(entry ->> 'path', ',' ORDER BY entry ->> 'path') INTO v_paths
  FROM jsonb_array_elements(v_seo.entry_documents) entry;

  FOREACH v_paths IN ARRAY ARRAY[
    '/',
    '/products/linen-shirt',
    '/categories/clothing',
    '/categories/shirts',
    '/collections/summer-edit',
    '/pages/shipping'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_seo.entry_documents) entry
      WHERE entry ->> 'path' = v_paths
    ) THEN
      RAISE EXCEPTION 'expected public SEO path is missing: %', v_paths;
    END IF;
  END LOOP;

  IF v_seo.entry_documents::text LIKE '%/products/unpriced%'
     OR v_seo.entry_documents::text LIKE '%/categories/archived-discovery%'
     OR v_seo.entry_documents::text LIKE '%/collections/hidden-edit%'
     OR v_seo.entry_documents::text LIKE '%/pages/private-draft%'
     OR v_seo.entry_documents::text LIKE '%/checkout%' THEN
    RAISE EXCEPTION 'non-public path leaked into SEO entries: %', v_seo.entry_documents;
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.resolve_public_seo('missing.example.test');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unknown host unexpectedly resolved public SEO';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))
    ) function_acl
    WHERE procedure_row.oid = 'storefront.resolve_public_seo(text)'::regprocedure
      AND function_acl.grantee = 0
      AND function_acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can execute public SEO resolver';
  END IF;
  IF NOT has_function_privilege(
    'store_app_runtime',
    'storefront.resolve_public_seo(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime cannot execute public SEO resolver';
  END IF;
END $test$;

RESET ROLE;

SELECT 'storefront public SEO rehearsal passed' AS result;
