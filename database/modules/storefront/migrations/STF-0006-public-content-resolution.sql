BEGIN;

CREATE OR REPLACE FUNCTION storefront.resolve_public_content_bundle(
  p_hostname text,
  p_content_slug text DEFAULT NULL
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
  theme_revision text,
  layout_revision text,
  theme_document jsonb,
  navigation_document jsonb,
  homepage_document jsonb,
  homepage_seo_document jsonb,
  content_page_slug text,
  content_page_title text,
  content_page_revision text,
  content_page_document jsonb,
  content_page_seo_document jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform, pricing
SET row_security = off AS $$
  WITH host AS (
    SELECT *
    FROM storefront.resolve_public_host(p_hostname)
  ),
  latest_theme AS (
    SELECT DISTINCT ON (tr.tenant_id, tr.storefront_id)
      tr.tenant_id,
      tr.storefront_id,
      tr.revision,
      tr.theme_document
    FROM storefront.theme_revisions tr
    JOIN host h
      ON h.tenant_id = tr.tenant_id
     AND h.storefront_id = tr.storefront_id
    WHERE tr.status = 'published'
    ORDER BY tr.tenant_id, tr.storefront_id, tr.revision DESC, tr.id DESC
  ),
  latest_navigation AS (
    SELECT
      candidate.tenant_id,
      candidate.storefront_id,
      jsonb_object_agg(candidate.placement, candidate.navigation_document ORDER BY candidate.placement) AS navigation_document
    FROM (
      SELECT DISTINCT ON (nd.tenant_id, nd.storefront_id, nd.placement)
        nd.tenant_id,
        nd.storefront_id,
        nd.placement,
        nd.navigation_document,
        nd.revision,
        nd.id
      FROM storefront.navigation_documents nd
      JOIN host h
        ON h.tenant_id = nd.tenant_id
       AND h.storefront_id = nd.storefront_id
      WHERE nd.status = 'published'
      ORDER BY nd.tenant_id, nd.storefront_id, nd.placement, nd.revision DESC, nd.id DESC
    ) candidate
    GROUP BY candidate.tenant_id, candidate.storefront_id
  ),
  latest_homepage AS (
    SELECT DISTINCT ON (hr.tenant_id, hr.storefront_id)
      hr.tenant_id,
      hr.storefront_id,
      hr.revision,
      hr.homepage_document,
      hr.seo_document
    FROM storefront.homepage_revisions hr
    JOIN host h
      ON h.tenant_id = hr.tenant_id
     AND h.storefront_id = hr.storefront_id
    WHERE hr.status = 'published'
    ORDER BY hr.tenant_id, hr.storefront_id, hr.revision DESC, hr.id DESC
  ),
  latest_content_page AS (
    SELECT DISTINCT ON (cp.tenant_id, cp.storefront_id, cp.public_slug)
      cp.tenant_id,
      cp.storefront_id,
      cp.public_slug,
      cp.title,
      cp.revision,
      cp.content_document,
      cp.seo_document
    FROM storefront.content_pages cp
    JOIN host h
      ON h.tenant_id = cp.tenant_id
     AND h.storefront_id = cp.storefront_id
    WHERE cp.status = 'published'
      AND p_content_slug IS NOT NULL
      AND cp.public_slug = lower(trim(p_content_slug))
    ORDER BY cp.tenant_id, cp.storefront_id, cp.public_slug, cp.revision DESC, cp.id DESC
  )
  SELECT
    h.tenant_id,
    h.storefront_id,
    h.sales_channel_id,
    h.request_hostname,
    h.canonical_hostname,
    h.locale,
    h.currency,
    h.price_list_revision,
    h.publication_generation,
    h.theme_revision,
    h.layout_revision,
    COALESCE(lt.theme_document, '{}'::jsonb),
    COALESCE(ln.navigation_document, '{}'::jsonb),
    COALESCE(lh.homepage_document, '{}'::jsonb),
    COALESCE(lh.seo_document, '{}'::jsonb),
    lcp.public_slug,
    lcp.title,
    CASE WHEN lcp.revision IS NULL THEN NULL ELSE concat('content:', lcp.revision::text) END,
    lcp.content_document,
    lcp.seo_document
  FROM host h
  LEFT JOIN latest_theme lt
    ON lt.tenant_id = h.tenant_id
   AND lt.storefront_id = h.storefront_id
  LEFT JOIN latest_navigation ln
    ON ln.tenant_id = h.tenant_id
   AND ln.storefront_id = h.storefront_id
  LEFT JOIN latest_homepage lh
    ON lh.tenant_id = h.tenant_id
   AND lh.storefront_id = h.storefront_id
  LEFT JOIN latest_content_page lcp
    ON lcp.tenant_id = h.tenant_id
   AND lcp.storefront_id = h.storefront_id;
$$;

REVOKE ALL ON FUNCTION storefront.resolve_public_content_bundle(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storefront.resolve_public_content_bundle(text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0006','MOD-H-STOREFRONT','manifest:STF-0006-public-content-resolution.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
