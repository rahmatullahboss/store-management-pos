BEGIN;

CREATE OR REPLACE FUNCTION storefront.resolve_public_catalog(
  p_hostname text,
  p_limit integer DEFAULT 24,
  p_after_product_id uuid DEFAULT NULL
) RETURNS TABLE(
  tenant_id uuid,
  storefront_id uuid,
  sales_channel_id uuid,
  request_hostname text,
  canonical_hostname text,
  locale text,
  currency text,
  price_list_revision text,
  publication_generation text,
  product_documents jsonb,
  next_cursor uuid,
  has_more boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, storefront
SET row_security = off AS $$
  WITH host AS (
    SELECT * FROM storefront.resolve_public_host(p_hostname)
  ),
  bounded AS (
    SELECT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48) AS item_limit
  ),
  candidates AS (
    SELECT document.*
    FROM host
    CROSS JOIN LATERAL storefront.compose_public_product_documents(
      host.tenant_id,
      host.storefront_id,
      host.sales_channel_id,
      host.locale,
      host.currency
    ) document
    WHERE p_after_product_id IS NULL OR document.product_id > p_after_product_id
    ORDER BY document.product_id
    LIMIT (SELECT item_limit + 1 FROM bounded)
  ),
  page AS (
    SELECT candidate.*
    FROM candidates candidate
    ORDER BY candidate.product_id
    LIMIT (SELECT item_limit FROM bounded)
  ),
  summary AS (
    SELECT
      COALESCE(
        (SELECT jsonb_agg(page.product_document ORDER BY page.product_id) FROM page),
        '[]'::jsonb
      ) AS documents,
      (SELECT count(*) FROM candidates) > (SELECT item_limit FROM bounded) AS has_more,
      (
        SELECT page.product_id
        FROM page
        ORDER BY page.product_id DESC
        LIMIT 1
      ) AS page_cursor
  )
  SELECT
    host.tenant_id,
    host.storefront_id,
    host.sales_channel_id,
    host.request_hostname,
    host.canonical_hostname,
    host.locale,
    host.currency,
    host.price_list_revision,
    host.publication_generation,
    summary.documents,
    CASE WHEN summary.has_more THEN summary.page_cursor ELSE NULL END,
    summary.has_more
  FROM host
  CROSS JOIN summary;
$$;

CREATE OR REPLACE FUNCTION storefront.resolve_public_product(
  p_hostname text,
  p_public_slug text
) RETURNS TABLE(
  tenant_id uuid,
  storefront_id uuid,
  sales_channel_id uuid,
  request_hostname text,
  canonical_hostname text,
  locale text,
  currency text,
  price_list_revision text,
  publication_generation text,
  product_document jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, storefront
SET row_security = off AS $$
  WITH host AS (
    SELECT * FROM storefront.resolve_public_host(p_hostname)
  )
  SELECT
    host.tenant_id,
    host.storefront_id,
    host.sales_channel_id,
    host.request_hostname,
    host.canonical_hostname,
    host.locale,
    host.currency,
    host.price_list_revision,
    host.publication_generation,
    document.product_document
  FROM host
  CROSS JOIN LATERAL storefront.compose_public_product_documents(
    host.tenant_id,
    host.storefront_id,
    host.sales_channel_id,
    host.locale,
    host.currency
  ) document
  WHERE document.public_slug = lower(trim(p_public_slug))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION storefront.resolve_public_catalog(text,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.resolve_public_product(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storefront.resolve_public_catalog(text,integer,uuid) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.resolve_public_product(text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0010','MOD-H-STOREFRONT','manifest:STF-0010-public-catalog-endpoints.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
