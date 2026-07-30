\set ON_ERROR_STOP on

BEGIN;
SET ROLE store_app_runtime;
SELECT platform.set_request_context(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000020',
  NULL, NULL, DATE '2026-07-30', 'storefront-public-content', 'trace-storefront-public-content'
);

SELECT *
FROM storefront.transition_domain(
  '10000000-0000-4000-8000-000000000260',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000150',
  'active', 'active', 'provider-host-a', NULL, NULL, true,
  '30000000-0000-4000-8000-000000000001',
  'reactivate-domain-public-content', repeat('a', 64),
  'reactivate-domain-public-content', 'trace-storefront-public-content', DATE '2026-07-30'
);

SELECT *
FROM storefront.publish_content_page_revision(
  '10000000-0000-4000-8000-000000000240',
  '10000000-0000-4000-8000-000000000241',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000100',
  'private-draft', 'Private draft', 'hidden',
  '{"blocks":[{"type":"text","value":"Must not be public"}]}'::jsonb,
  '{"title":"Private"}'::jsonb, repeat('8', 64), NULL,
  '30000000-0000-4000-8000-000000000001',
  'hide-public-content-a', repeat('9', 64),
  'hide-public-content-a', 'trace-storefront-public-content', DATE '2026-07-30'
);

DO $test$
DECLARE
  v_bundle record;
  v_count bigint;
BEGIN
  SELECT * INTO v_bundle
  FROM storefront.resolve_public_content_bundle('shop.example.test', NULL);
  IF NOT FOUND THEN RAISE EXCEPTION 'public content bundle was not resolved'; END IF;
  IF v_bundle.tenant_id <> '10000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'public content tenant scope is invalid';
  END IF;
  IF v_bundle.storefront_id <> '10000000-0000-4000-8000-000000000100'
     OR v_bundle.sales_channel_id <> '10000000-0000-4000-8000-000000000110' THEN
    RAISE EXCEPTION 'public content storefront scope is invalid';
  END IF;
  IF v_bundle.theme_document ->> 'version' <> 'storefront-theme.v1' THEN
    RAISE EXCEPTION 'published theme was not projected';
  END IF;
  IF v_bundle.navigation_document #>> '{header,items,0,label}' <> 'Home' THEN
    RAISE EXCEPTION 'published navigation was not projected';
  END IF;
  IF v_bundle.homepage_document #>> '{blocks,0,title}' <> 'Store' THEN
    RAISE EXCEPTION 'published homepage was not projected';
  END IF;
  IF v_bundle.content_page_slug IS NOT NULL THEN
    RAISE EXCEPTION 'content page unexpectedly resolved without a slug';
  END IF;

  SELECT * INTO v_bundle
  FROM storefront.resolve_public_content_bundle('shop.example.test', 'shipping');
  IF v_bundle.content_page_slug <> 'shipping'
     OR v_bundle.content_page_title <> 'Shipping'
     OR v_bundle.content_page_revision <> 'content:1'
     OR v_bundle.content_page_document #>> '{blocks,0,value}' <> 'Delivery details' THEN
    RAISE EXCEPTION 'published CMS page projection is invalid';
  END IF;

  SELECT * INTO v_bundle
  FROM storefront.resolve_public_content_bundle('shop.example.test', 'private-draft');
  IF v_bundle.content_page_slug IS NOT NULL
     OR v_bundle.content_page_document IS NOT NULL THEN
    RAISE EXCEPTION 'hidden CMS page leaked into public projection';
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.resolve_public_content_bundle('missing.example.test', NULL);
  IF v_count <> 0 THEN RAISE EXCEPTION 'unknown hostname unexpectedly resolved'; END IF;

  IF has_function_privilege('PUBLIC', 'storefront.resolve_public_content_bundle(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can execute public content resolver';
  END IF;
  IF NOT has_function_privilege('store_app_runtime', 'storefront.resolve_public_content_bundle(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'runtime cannot execute public content resolver';
  END IF;
END $test$;

RESET ROLE;
COMMIT;

SELECT 'storefront public content rehearsal passed' AS result;
