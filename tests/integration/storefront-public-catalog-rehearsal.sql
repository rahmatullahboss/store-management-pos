\set ON_ERROR_STOP on

BEGIN;
SELECT platform.set_request_context(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000020',
  '10000000-0000-4000-8000-000000000146',
  NULL, DATE '2026-07-30', 'storefront-public-catalog-seed', 'trace-storefront-public-catalog'
);

INSERT INTO platform.warehouses(
  id, tenant_id, legal_entity_id, store_id, code, display_name, status
) VALUES (
  '10000000-0000-4000-8000-000000000146',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000020',
  'WEB-A', 'Web Warehouse A', 'active'
);

INSERT INTO catalog.units(
  id, tenant_id, code, display_name, dimension, decimal_scale,
  is_base_unit, status, created_by
) VALUES (
  '10000000-0000-4000-8000-000000000144',
  '10000000-0000-4000-8000-000000000001',
  'EA', 'Each', 'count', 0, true, 'active',
  '30000000-0000-4000-8000-000000000001'
);

INSERT INTO catalog.products(
  id, tenant_id, code, normalized_code, kind, status, default_locale,
  tax_code, metadata, created_by, updated_by, published_at
) VALUES
(
  '10000000-0000-4000-8000-000000000140',
  '10000000-0000-4000-8000-000000000001',
  'LINEN-SHIRT', 'linen-shirt', 'stock', 'active', 'en-GB',
  'STANDARD', '{}'::jsonb,
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  TIMESTAMPTZ '2026-07-30 00:00:00+00'
),
(
  '10000000-0000-4000-8000-000000000240',
  '10000000-0000-4000-8000-000000000001',
  'UNPRICED', 'unpriced', 'stock', 'active', 'en-GB',
  'STANDARD', '{}'::jsonb,
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  TIMESTAMPTZ '2026-07-30 00:00:00+00'
);

INSERT INTO catalog.product_localizations(
  tenant_id, product_id, locale, display_name, description, search_keywords
) VALUES
(
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000140',
  'en-GB', 'Linen Shirt', 'A breathable linen shirt.', ARRAY['linen','shirt']
),
(
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000240',
  'en-GB', 'Unpriced Product', 'Must not be public without a price.', ARRAY['hidden']
);

INSERT INTO catalog.variants(
  id, tenant_id, product_id, sku, normalized_sku, title, combination_key,
  unit_code, tracking_mode, status, metadata
) VALUES
(
  '10000000-0000-4000-8000-000000000142',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000140',
  'LINEN-BLUE-L', 'linen-blue-l', 'Blue / Large', 'blue-large',
  'EA', 'none', 'active', '{}'::jsonb
),
(
  '10000000-0000-4000-8000-000000000143',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000140',
  'LINEN-NATURAL-M', 'linen-natural-m', 'Natural / Medium', 'natural-medium',
  'EA', 'none', 'active', '{}'::jsonb
),
(
  '10000000-0000-4000-8000-000000000242',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000240',
  'UNPRICED-ONE', 'unpriced-one', 'Default', 'default',
  'EA', 'none', 'active', '{}'::jsonb
);

INSERT INTO pricing.price_rules(
  id, tenant_id, price_list_version_id, variant_id, unit_code,
  minimum_quantity_minor, quantity_scale, unit_price_minor,
  compare_at_price_minor, priority, rule_version, metadata
) VALUES
(
  '10000000-0000-4000-8000-000000000145',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000121',
  '10000000-0000-4000-8000-000000000142',
  'EA', 1, 0, 2499, 2999, 0, 1, '{}'::jsonb
),
(
  '10000000-0000-4000-8000-000000000149',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000121',
  '10000000-0000-4000-8000-000000000143',
  'EA', 1, 0, 2599, 3099, 0, 1, '{}'::jsonb
);

INSERT INTO storefront.product_publications(
  id, tenant_id, storefront_id, sales_channel_id, product_id,
  publication_state, public_slug, published_at, metadata,
  created_by, updated_by
) VALUES (
  '10000000-0000-4000-8000-000000000241',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000100',
  '10000000-0000-4000-8000-000000000110',
  '10000000-0000-4000-8000-000000000240',
  'published', 'unpriced', now(), '{}'::jsonb,
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);

UPDATE storefront.sales_channels
SET inventory_scope = jsonb_build_object(
      'warehouseIds',
      jsonb_build_array('10000000-0000-4000-8000-000000000146')
    ),
    updated_by = '30000000-0000-4000-8000-000000000001',
    updated_at = now(),
    version = version + 1
WHERE tenant_id = '10000000-0000-4000-8000-000000000001'
  AND id = '10000000-0000-4000-8000-000000000110';

INSERT INTO inventory.stock_balances(
  tenant_id, warehouse_id, variant_id, stock_status,
  quantity_amount, quantity_scale, unit_code, value_minor,
  currency, source_cursor, version
) VALUES
(
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000146',
  '10000000-0000-4000-8000-000000000143',
  'sellable', 10, 0, 'EA', 12000, 'GBP', 1, 4
),
(
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000146',
  '10000000-0000-4000-8000-000000000142',
  'sellable', 50, 0, 'EA', 50000, 'GBP', 2, 5
);

INSERT INTO inventory.stock_reservations(
  id, tenant_id, source_type, source_id, state, fulfillment_policy,
  created_by, expires_at
) VALUES (
  '10000000-0000-4000-8000-000000000147',
  '10000000-0000-4000-8000-000000000001',
  'storefront_test', 'catalog-availability',
  'fully_reserved', 'all_or_nothing',
  '30000000-0000-4000-8000-000000000001',
  TIMESTAMPTZ '2026-07-31 00:00:00+00'
);

INSERT INTO inventory.stock_reservation_lines(
  id, tenant_id, reservation_id, variant_id, warehouse_id,
  unit_code, quantity_scale, requested_quantity, reserved_quantity,
  consumed_quantity, released_quantity
) VALUES (
  '10000000-0000-4000-8000-000000000148',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000147',
  '10000000-0000-4000-8000-000000000143',
  '10000000-0000-4000-8000-000000000146',
  'EA', 0, 3, 3, 0, 0
);

COMMIT;

RESET ALL;
SET ROLE store_app_runtime;

DO $test$
DECLARE
  v_catalog record;
  v_product record;
  v_count bigint;
  v_document jsonb;
BEGIN
  SELECT * INTO v_catalog
  FROM storefront.resolve_public_catalog('shop.example.test', 1, NULL);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'public catalog did not resolve';
  END IF;
  IF v_catalog.tenant_id <> '10000000-0000-4000-8000-000000000001'
     OR v_catalog.storefront_id <> '10000000-0000-4000-8000-000000000100'
     OR v_catalog.sales_channel_id <> '10000000-0000-4000-8000-000000000110' THEN
    RAISE EXCEPTION 'public catalog scope is invalid';
  END IF;
  IF jsonb_array_length(v_catalog.product_documents) <> 1
     OR v_catalog.has_more
     OR v_catalog.next_cursor IS NOT NULL THEN
    RAISE EXCEPTION 'public catalog page shape is invalid';
  END IF;

  v_document := v_catalog.product_documents -> 0;
  IF v_document #>> '{summary,productId}' <> '10000000-0000-4000-8000-000000000140'
     OR v_document #>> '{summary,variantId}' <> '10000000-0000-4000-8000-000000000143'
     OR v_document #>> '{summary,price,minor}' <> '2599'
     OR v_document #>> '{summary,compareAtPrice,minor}' <> '3099'
     OR v_document #>> '{summary,availability}' <> 'available'
     OR v_document #>> '{variants,0,quantity,amount}' <> '7'
     OR v_document #>> '{variants,0,quantity,version}' <> '4'
     OR jsonb_array_length(v_document -> 'variants') <> 1 THEN
    RAISE EXCEPTION 'authoritative public catalog composition is invalid: %', v_document;
  END IF;
  IF v_document::text LIKE '%10000000-0000-4000-8000-000000000142%' THEN
    RAISE EXCEPTION 'archived variant publication leaked into public catalog';
  END IF;
  IF v_document::text LIKE '%Unpriced Product%' THEN
    RAISE EXCEPTION 'unpriced product leaked into public catalog';
  END IF;

  SELECT * INTO v_product
  FROM storefront.resolve_public_product('shop.example.test', 'linen-shirt');
  IF NOT FOUND
     OR v_product.product_document #>> '{summary,productId}' <>
        '10000000-0000-4000-8000-000000000140'
     OR v_product.product_document #>> '{variants,0,availability}' <> 'available' THEN
    RAISE EXCEPTION 'public product detail is invalid';
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.resolve_public_product('shop.example.test', 'unpriced');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unpriced product detail unexpectedly resolved';
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.resolve_public_catalog('missing.example.test', 24, NULL);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unknown hostname unexpectedly resolved a catalog';
  END IF;

  SELECT count(*) INTO v_count
  FROM aclexplode(
    COALESCE(
      (
        SELECT proacl
        FROM pg_proc
        WHERE oid = 'storefront.resolve_public_catalog(text,integer,uuid)'::regprocedure
      ),
      acldefault('f', (
        SELECT proowner
        FROM pg_proc
        WHERE oid = 'storefront.resolve_public_catalog(text,integer,uuid)'::regprocedure
      ))
    )
  ) acl
  WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'PUBLIC can execute public catalog resolver';
  END IF;

  IF NOT has_function_privilege(
    'store_app_runtime',
    'storefront.resolve_public_catalog(text,integer,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'store_app_runtime',
    'storefront.resolve_public_product(text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime cannot execute public catalog resolvers';
  END IF;
END $test$;

RESET ROLE;

SELECT 'storefront public catalog rehearsal passed' AS result;
