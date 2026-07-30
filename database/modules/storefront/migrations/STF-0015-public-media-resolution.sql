BEGIN;

CREATE OR REPLACE FUNCTION storefront.resolve_public_product_media(
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
  product_id uuid,
  public_slug text,
  media_revision text,
  media_documents jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform, catalog
SET row_security = off AS $$
  WITH host AS (
    SELECT resolved.*
    FROM storefront.resolve_public_host(p_hostname) resolved
    LIMIT 1
  ),
  published_product AS (
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
      publication.product_id,
      publication.public_slug
    FROM host
    JOIN storefront.product_publications publication
      ON publication.tenant_id = host.tenant_id
     AND publication.storefront_id = host.storefront_id
     AND publication.sales_channel_id = host.sales_channel_id
     AND publication.public_slug = lower(trim(p_public_slug))
     AND publication.publication_state = 'published'
    JOIN catalog.products product
      ON product.tenant_id = publication.tenant_id
     AND product.id = publication.product_id
     AND product.status = 'active'
  )
  SELECT
    product.tenant_id,
    product.storefront_id,
    product.sales_channel_id,
    product.request_hostname,
    product.canonical_hostname,
    product.locale,
    product.currency,
    product.price_list_revision,
    product.publication_generation,
    product.product_id,
    product.public_slug,
    COALESCE(media.media_revision, md5('empty')) AS media_revision,
    COALESCE(media.media_documents, '[]'::jsonb) AS media_documents
  FROM published_product product
  LEFT JOIN LATERAL (
    SELECT
      md5(string_agg(
        concat_ws(
          ':',
          visible.id::text,
          visible.url,
          visible.alt_text,
          visible.sort_order::text,
          COALESCE(visible.variant_id::text, ''),
          to_char(visible.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        ),
        '|' ORDER BY visible.sort_order, visible.id
      )) AS media_revision,
      jsonb_agg(
        jsonb_build_object(
          'mediaId', visible.id::text,
          'variantId', CASE WHEN visible.variant_id IS NULL THEN NULL ELSE visible.variant_id::text END,
          'src', visible.url,
          'alt', visible.alt_text,
          'sortOrder', visible.sort_order,
          'createdAt', to_char(
            visible.created_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )
        ) ORDER BY visible.sort_order, visible.id
      ) AS media_documents
    FROM (
      SELECT
        media.id,
        media.variant_id,
        trim(media.url) AS url,
        left(trim(media.alt_text), 300) AS alt_text,
        media.sort_order,
        media.created_at
      FROM catalog.product_media media
      WHERE media.tenant_id = product.tenant_id
        AND media.product_id = product.product_id
        AND char_length(trim(media.url)) BETWEEN 1 AND 2048
        AND char_length(trim(media.alt_text)) BETWEEN 1 AND 300
        AND trim(media.alt_text) !~ '[[:cntrl:]]'
        AND (
          (
            trim(media.url) LIKE '/%'
            AND trim(media.url) NOT LIKE '//%'
            AND position(E'\\' IN trim(media.url)) = 0
            AND position('#' IN trim(media.url)) = 0
          )
          OR trim(media.url) ~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:/[^[:space:]#\\]*)?(?:\?[^[:space:]#\\]*)?$'
        )
        AND (
          media.variant_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM catalog.variants variant
            LEFT JOIN storefront.variant_publications variant_publication
              ON variant_publication.tenant_id = product.tenant_id
             AND variant_publication.storefront_id = product.storefront_id
             AND variant_publication.sales_channel_id = product.sales_channel_id
             AND variant_publication.product_id = product.product_id
             AND variant_publication.variant_id = variant.id
            WHERE variant.tenant_id = product.tenant_id
              AND variant.product_id = product.product_id
              AND variant.id = media.variant_id
              AND variant.status = 'active'
              AND COALESCE(variant_publication.publication_state, 'published') = 'published'
          )
        )
      ORDER BY media.sort_order, media.id
      LIMIT 24
    ) visible
  ) media ON true;
$$;

REVOKE ALL ON FUNCTION storefront.resolve_public_product_media(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storefront.resolve_public_product_media(text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0015','MOD-H-STOREFRONT','manifest:STF-0015-public-media-resolution.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
