BEGIN;

CREATE OR REPLACE FUNCTION storefront.resolve_public_search(
  p_hostname text,
  p_query text,
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
  normalized_query text,
  product_documents jsonb,
  facets_document jsonb,
  next_cursor uuid,
  has_more boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, storefront, catalog
SET row_security = off AS $$
  WITH host AS (
    SELECT * FROM storefront.resolve_public_host(p_hostname)
  ),
  search_query AS (
    SELECT trim(p_query) AS value
    WHERE char_length(trim(p_query)) BETWEEN 2 AND 120
      AND trim(p_query) !~ '[[:cntrl:]]'
  ),
  public_documents AS (
    SELECT document.*
    FROM host
    CROSS JOIN LATERAL storefront.compose_public_product_documents(
      host.tenant_id,
      host.storefront_id,
      host.sales_channel_id,
      host.locale,
      host.currency
    ) document
  ),
  matched AS (
    SELECT document.*
    FROM public_documents document
    CROSS JOIN host
    CROSS JOIN search_query query
    WHERE lower(document.product_document #>> '{summary,name}')
            LIKE '%' || lower(query.value) || '%'
       OR lower(document.product_document ->> 'code')
            LIKE '%' || lower(query.value) || '%'
       OR EXISTS (
         SELECT 1
         FROM catalog.product_localizations localization
         WHERE localization.tenant_id = host.tenant_id
           AND localization.product_id = document.product_id
           AND (
             localization.search_vector @@ websearch_to_tsquery('simple', query.value)
             OR lower(localization.display_name) LIKE '%' || lower(query.value) || '%'
             OR lower(COALESCE(localization.description, '')) LIKE '%' || lower(query.value) || '%'
             OR EXISTS (
               SELECT 1
               FROM unnest(localization.search_keywords) keyword
               WHERE lower(keyword) LIKE '%' || lower(query.value) || '%'
             )
           )
       )
       OR EXISTS (
         SELECT 1
         FROM catalog.variant_search_documents search_document
         WHERE search_document.tenant_id = host.tenant_id
           AND search_document.product_id = document.product_id
           AND search_document.status = 'active'
           AND (
             search_document.search_vector @@ websearch_to_tsquery('simple', query.value)
             OR lower(search_document.sku) LIKE '%' || lower(query.value) || '%'
             OR lower(search_document.product_code) LIKE '%' || lower(query.value) || '%'
             OR EXISTS (
               SELECT 1
               FROM unnest(search_document.barcodes) barcode
               WHERE lower(barcode) = lower(query.value)
             )
           )
       )
  ),
  category_facets AS (
    SELECT
      publication.category_id,
      publication.public_slug,
      category.display_name,
      count(DISTINCT matched.product_id)::integer AS product_count
    FROM matched
    CROSS JOIN host
    JOIN catalog.product_categories assignment
      ON assignment.tenant_id = host.tenant_id
     AND assignment.product_id = matched.product_id
    JOIN storefront.category_publications publication
      ON publication.tenant_id = assignment.tenant_id
     AND publication.storefront_id = host.storefront_id
     AND publication.sales_channel_id = host.sales_channel_id
     AND publication.category_id = assignment.category_id
     AND publication.publication_state = 'published'
    JOIN catalog.categories category
      ON category.tenant_id = publication.tenant_id
     AND category.id = publication.category_id
     AND category.status = 'active'
    GROUP BY publication.category_id, publication.public_slug, category.display_name
    ORDER BY product_count DESC, category.display_name, publication.category_id
    LIMIT 100
  ),
  availability_facets AS (
    SELECT
      matched.product_document #>> '{summary,availability}' AS availability,
      count(*)::integer AS product_count
    FROM matched
    GROUP BY matched.product_document #>> '{summary,availability}'
    ORDER BY matched.product_document #>> '{summary,availability}'
  ),
  facets AS (
    SELECT jsonb_build_object(
      'categories', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'categoryId', category_facets.category_id::text,
              'slug', category_facets.public_slug,
              'title', left(category_facets.display_name, 240),
              'count', category_facets.product_count
            )
            ORDER BY category_facets.product_count DESC,
                     category_facets.display_name,
                     category_facets.category_id
          )
          FROM category_facets
        ),
        '[]'::jsonb
      ),
      'availability', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'value', availability_facets.availability,
              'count', availability_facets.product_count
            )
            ORDER BY availability_facets.availability
          )
          FROM availability_facets
        ),
        '[]'::jsonb
      )
    ) AS document
  ),
  bounded AS (
    SELECT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48) AS item_limit
  ),
  candidates AS (
    SELECT matched.*
    FROM matched
    WHERE p_after_product_id IS NULL OR matched.product_id > p_after_product_id
    ORDER BY matched.product_id
    LIMIT (SELECT item_limit + 1 FROM bounded)
  ),
  page AS (
    SELECT candidate.*
    FROM candidates candidate
    ORDER BY candidate.product_id
    LIMIT (SELECT item_limit FROM bounded)
  ),
  page_summary AS (
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
    query.value,
    page_summary.documents,
    facets.document,
    CASE WHEN page_summary.has_more THEN page_summary.page_cursor ELSE NULL END,
    page_summary.has_more
  FROM host
  CROSS JOIN search_query query
  CROSS JOIN facets
  CROSS JOIN page_summary;
$$;

REVOKE ALL ON FUNCTION storefront.resolve_public_search(text,text,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storefront.resolve_public_search(text,text,integer,uuid) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0012','MOD-H-STOREFRONT','manifest:STF-0012-public-search-resolution.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
