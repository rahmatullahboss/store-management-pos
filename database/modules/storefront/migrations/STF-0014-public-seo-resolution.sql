BEGIN;

CREATE OR REPLACE FUNCTION storefront.resolve_public_seo(
  p_hostname text
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
  indexable boolean,
  sitemap_path text,
  disallow_paths text[],
  entry_documents jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, storefront, catalog
SET row_security = off AS $$
  WITH host AS (
    SELECT * FROM storefront.resolve_public_host(p_hostname)
  ),
  root_entry AS (
    SELECT
      host.tenant_id,
      host.storefront_id,
      host.sales_channel_id,
      '/'::text AS path,
      'home'::text AS kind,
      storefront_row.updated_at AS last_modified,
      'daily'::text AS change_frequency
    FROM host
    JOIN storefront.storefronts storefront_row
      ON storefront_row.tenant_id = host.tenant_id
     AND storefront_row.id = host.storefront_id
     AND storefront_row.status = 'active'
  ),
  product_entries AS (
    SELECT DISTINCT ON (document.product_id)
      host.tenant_id,
      host.storefront_id,
      host.sales_channel_id,
      ('/products/' || (document.product_document #>> '{summary,slug}'))::text AS path,
      'product'::text AS kind,
      publication.updated_at AS last_modified,
      'weekly'::text AS change_frequency
    FROM host
    CROSS JOIN LATERAL storefront.compose_public_product_documents(
      host.tenant_id,
      host.storefront_id,
      host.sales_channel_id,
      host.locale,
      host.currency
    ) document
    JOIN storefront.product_publications publication
      ON publication.tenant_id = host.tenant_id
     AND publication.storefront_id = host.storefront_id
     AND publication.sales_channel_id = host.sales_channel_id
     AND publication.product_id = document.product_id
     AND publication.publication_state = 'published'
    WHERE document.product_document #>> '{summary,slug}' IS NOT NULL
    ORDER BY document.product_id, publication.updated_at DESC
  ),
  category_entries AS (
    SELECT
      host.tenant_id,
      host.storefront_id,
      host.sales_channel_id,
      ('/categories/' || publication.public_slug)::text AS path,
      'category'::text AS kind,
      GREATEST(publication.updated_at, category.updated_at) AS last_modified,
      'weekly'::text AS change_frequency
    FROM host
    JOIN storefront.category_publications publication
      ON publication.tenant_id = host.tenant_id
     AND publication.storefront_id = host.storefront_id
     AND publication.sales_channel_id = host.sales_channel_id
     AND publication.publication_state = 'published'
    JOIN catalog.categories category
      ON category.tenant_id = publication.tenant_id
     AND category.id = publication.category_id
     AND category.status = 'active'
  ),
  collection_entries AS (
    SELECT
      host.tenant_id,
      host.storefront_id,
      host.sales_channel_id,
      ('/collections/' || collection.public_slug)::text AS path,
      'collection'::text AS kind,
      collection.updated_at AS last_modified,
      'weekly'::text AS change_frequency
    FROM host
    JOIN storefront.collections collection
      ON collection.tenant_id = host.tenant_id
     AND collection.storefront_id = host.storefront_id
     AND collection.sales_channel_id = host.sales_channel_id
     AND collection.publication_state = 'published'
  ),
  content_entries AS (
    SELECT
      host.tenant_id,
      host.storefront_id,
      host.sales_channel_id,
      ('/pages/' || content.public_slug)::text AS path,
      'content'::text AS kind,
      COALESCE(content.published_at, content.created_at) AS last_modified,
      'monthly'::text AS change_frequency
    FROM host
    JOIN storefront.content_pages content
      ON content.tenant_id = host.tenant_id
     AND content.storefront_id = host.storefront_id
     AND content.status = 'published'
  ),
  all_entries AS (
    SELECT * FROM root_entry
    UNION ALL
    SELECT * FROM product_entries
    UNION ALL
    SELECT * FROM category_entries
    UNION ALL
    SELECT * FROM collection_entries
    UNION ALL
    SELECT * FROM content_entries
  ),
  bounded_entries AS (
    SELECT entry.*
    FROM all_entries entry
    ORDER BY entry.path, entry.kind
    LIMIT 5000
  ),
  entry_summary AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'kind', entry.kind,
          'path', entry.path,
          'lastModified', to_char(
            entry.last_modified AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'changeFrequency', entry.change_frequency
        )
        ORDER BY entry.path, entry.kind
      ),
      '[]'::jsonb
    ) AS documents
    FROM bounded_entries entry
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
    true,
    '/sitemap.xml'::text,
    ARRAY['/account','/admin','/api','/checkout','/__']::text[],
    entry_summary.documents
  FROM host
  CROSS JOIN entry_summary;
$$;

REVOKE ALL ON FUNCTION storefront.resolve_public_seo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storefront.resolve_public_seo(text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0014','MOD-H-STOREFRONT','manifest:STF-0014-public-seo-resolution.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
