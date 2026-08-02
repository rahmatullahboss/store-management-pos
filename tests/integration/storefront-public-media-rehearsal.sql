\set ON_ERROR_STOP on

BEGIN;
SELECT platform.set_request_context(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000020',
  NULL, NULL, DATE '2026-07-30', 'storefront-public-media-seed', 'trace-storefront-public-media'
);

INSERT INTO catalog.product_media(
  id, tenant_id, product_id, variant_id, url, alt_text, sort_order, created_at
) VALUES
(
  '10000000-0000-4000-8000-000000000350',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000140',
  NULL,
  '/media/linen-front.webp',
  'Linen shirt front',
  0,
  TIMESTAMPTZ '2026-07-30 10:00:00+00'
),
(
  '10000000-0000-4000-8000-000000000351',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000140',
  '10000000-0000-4000-8000-000000000143',
  'https://cdn.example.test/linen-side.webp?version=2',
  'Linen shirt side',
  1,
  TIMESTAMPTZ '2026-07-30 10:01:00+00'
),
(
  '10000000-0000-4000-8000-000000000352',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000140',
  '10000000-0000-4000-8000-000000000142',
  '/media/archived-variant.webp',
  'Archived variant must remain private',
  2,
  TIMESTAMPTZ '2026-07-30 10:02:00+00'
),
(
  '10000000-0000-4000-8000-000000000353',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000140',
  NULL,
  'http://unsafe.example.test/linen.webp',
  'Unsafe HTTP media must remain private',
  3,
  TIMESTAMPTZ '2026-07-30 10:03:00+00'
),
(
  '10000000-0000-4000-8000-000000000354',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000140',
  NULL,
  '//protocol-relative.example.test/linen.webp',
  'Protocol-relative media must remain private',
  4,
  TIMESTAMPTZ '2026-07-30 10:04:00+00'
);

COMMIT;

RESET ALL;
SET ROLE store_app_runtime;

DO $test$
DECLARE
  v_media record;
  v_count bigint;
  v_first jsonb;
  v_second jsonb;
BEGIN
  SELECT * INTO v_media
  FROM storefront.resolve_public_product_media(
    'shop.example.test',
    'linen-shirt'
  );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'public product media did not resolve';
  END IF;
  IF v_media.tenant_id <> '10000000-0000-4000-8000-000000000001'
     OR v_media.storefront_id <> '10000000-0000-4000-8000-000000000100'
     OR v_media.sales_channel_id <> '10000000-0000-4000-8000-000000000110'
     OR v_media.product_id <> '10000000-0000-4000-8000-000000000140'
     OR v_media.public_slug <> 'linen-shirt' THEN
    RAISE EXCEPTION 'public media scope is invalid';
  END IF;
  IF v_media.media_revision !~ '^[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'public media revision is invalid: %', v_media.media_revision;
  END IF;
  IF jsonb_array_length(v_media.media_documents) <> 2 THEN
    RAISE EXCEPTION 'public media item count is invalid: %', v_media.media_documents;
  END IF;

  v_first := v_media.media_documents -> 0;
  v_second := v_media.media_documents -> 1;
  IF v_first ->> 'mediaId' <> '10000000-0000-4000-8000-000000000350'
     OR v_first ->> 'src' <> '/media/linen-front.webp'
     OR v_first ->> 'variantId' IS NOT NULL
     OR v_second ->> 'mediaId' <> '10000000-0000-4000-8000-000000000351'
     OR v_second ->> 'variantId' <> '10000000-0000-4000-8000-000000000143'
     OR v_second ->> 'src' <> 'https://cdn.example.test/linen-side.webp?version=2' THEN
    RAISE EXCEPTION 'public media deterministic order or shape is invalid: %', v_media.media_documents;
  END IF;
  IF v_media.media_documents::text LIKE '%000000000352%'
     OR v_media.media_documents::text LIKE '%000000000353%'
     OR v_media.media_documents::text LIKE '%000000000354%'
     OR v_media.media_documents::text LIKE '%archived-variant%'
     OR v_media.media_documents::text LIKE '%http://unsafe%'
     OR v_media.media_documents::text LIKE '%protocol-relative%' THEN
    RAISE EXCEPTION 'private or unsafe media leaked into public media: %', v_media.media_documents;
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.resolve_public_product_media('missing.example.test', 'linen-shirt');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unknown host unexpectedly resolved public media';
  END IF;

  SELECT count(*) INTO v_count
  FROM storefront.resolve_public_product_media('shop.example.test', 'unpriced');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unpriced product unexpectedly resolved public media';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))
    ) function_acl
    WHERE procedure_row.oid = 'storefront.resolve_public_product_media(text,text)'::regprocedure
      AND function_acl.grantee = 0
      AND function_acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can execute public media resolver';
  END IF;
  IF NOT has_function_privilege(
    'store_app_runtime',
    'storefront.resolve_public_product_media(text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime cannot execute public media resolver';
  END IF;
END $test$;

RESET ROLE;

SELECT 'storefront public media rehearsal passed' AS result;
