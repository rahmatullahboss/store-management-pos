BEGIN;

CREATE OR REPLACE FUNCTION storefront.resolve_public_category(
  p_hostname text,
  p_public_slug text,
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
  category_document jsonb,
  product_documents jsonb,
  next_cursor uuid,
  has_more boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, storefront, catalog
SET row_security = off AS $$
  WITH RECURSIVE host AS (
    SELECT * FROM storefront.resolve_public_host(p_hostname)
  ),
  current_category AS (
    SELECT
      host.*,
      publication.category_id,
      publication.parent_category_id,
      publication.public_slug,
      publication.sort_order,
      category.display_name,
      category.description
    FROM host
    JOIN storefront.category_publications publication
      ON publication.tenant_id = host.tenant_id
     AND publication.storefront_id = host.storefront_id
     AND publication.sales_channel_id = host.sales_channel_id
     AND publication.publication_state = 'published'
     AND publication.public_slug = lower(trim(p_public_slug))
    JOIN catalog.categories category
      ON category.tenant_id = publication.tenant_id
     AND category.id = publication.category_id
     AND category.status = 'active'
  ),
  category_path AS (
    SELECT
      current_category.tenant_id,
      current_category.storefront_id,
      current_category.sales_channel_id,
      current_category.category_id,
      current_category.parent_category_id,
      current_category.public_slug,
      current_category.display_name,
      ARRAY[current_category.category_id]::uuid[] AS visited,
      0 AS depth
    FROM current_category
    UNION ALL
    SELECT
      parent.tenant_id,
      parent.storefront_id,
      parent.sales_channel_id,
      parent.category_id,
      parent.parent_category_id,
      parent.public_slug,
      category.display_name,
      path.visited || parent.category_id,
      path.depth + 1
    FROM category_path path
    JOIN storefront.category_publications parent
      ON parent.tenant_id = path.tenant_id
     AND parent.storefront_id = path.storefront_id
     AND parent.sales_channel_id = path.sales_channel_id
     AND parent.category_id = path.parent_category_id
     AND parent.publication_state = 'published'
    JOIN catalog.categories category
      ON category.tenant_id = parent.tenant_id
     AND category.id = parent.category_id
     AND category.status = 'active'
    WHERE path.depth < 15
      AND NOT parent.category_id = ANY(path.visited)
  ),
  category_metadata AS (
    SELECT
      current_category.*,
      parent.public_slug AS parent_slug,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'categoryId', path.category_id::text,
              'slug', path.public_slug,
              'title', left(path.display_name, 240)
            )
            ORDER BY path.depth DESC
          )
          FROM category_path path
        ),
        '[]'::jsonb
      ) AS breadcrumbs,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'categoryId', child.category_id::text,
              'slug', child.public_slug,
              'title', left(category.display_name, 240)
            )
            ORDER BY child.sort_order, category.display_name, child.category_id
          )
          FROM storefront.category_publications child
          JOIN catalog.categories category
            ON category.tenant_id = child.tenant_id
           AND category.id = child.category_id
           AND category.status = 'active'
          WHERE child.tenant_id = current_category.tenant_id
            AND child.storefront_id = current_category.storefront_id
            AND child.sales_channel_id = current_category.sales_channel_id
            AND child.parent_category_id = current_category.category_id
            AND child.publication_state = 'published'
        ),
        '[]'::jsonb
      ) AS children
    FROM current_category
    LEFT JOIN storefront.category_publications parent
      ON parent.tenant_id = current_category.tenant_id
     AND parent.storefront_id = current_category.storefront_id
     AND parent.sales_channel_id = current_category.sales_channel_id
     AND parent.category_id = current_category.parent_category_id
     AND parent.publication_state = 'published'
  ),
  bounded AS (
    SELECT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48) AS item_limit
  ),
  candidates AS (
    SELECT document.*
    FROM category_metadata metadata
    CROSS JOIN LATERAL storefront.compose_public_product_documents(
      metadata.tenant_id,
      metadata.storefront_id,
      metadata.sales_channel_id,
      metadata.locale,
      metadata.currency
    ) document
    JOIN catalog.product_categories assignment
      ON assignment.tenant_id = metadata.tenant_id
     AND assignment.product_id = document.product_id
     AND assignment.category_id = metadata.category_id
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
    metadata.tenant_id,
    metadata.storefront_id,
    metadata.sales_channel_id,
    metadata.request_hostname,
    metadata.canonical_hostname,
    metadata.locale,
    metadata.currency,
    metadata.price_list_revision,
    metadata.publication_generation,
    jsonb_build_object(
      'categoryId', metadata.category_id::text,
      'slug', metadata.public_slug,
      'title', left(metadata.display_name, 240),
      'description', CASE
        WHEN metadata.description IS NULL THEN NULL
        ELSE left(metadata.description, 4000)
      END,
      'parentCategoryId', metadata.parent_category_id::text,
      'parentSlug', metadata.parent_slug,
      'breadcrumbs', metadata.breadcrumbs,
      'children', metadata.children
    ),
    page_summary.documents,
    CASE WHEN page_summary.has_more THEN page_summary.page_cursor ELSE NULL END,
    page_summary.has_more
  FROM category_metadata metadata
  CROSS JOIN page_summary;
$$;

CREATE OR REPLACE FUNCTION storefront.resolve_public_collection(
  p_hostname text,
  p_public_slug text,
  p_limit integer DEFAULT 24,
  p_after_member_id uuid DEFAULT NULL
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
  collection_document jsonb,
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
  published_collection AS (
    SELECT
      host.*,
      collection.id AS collection_id,
      collection.code,
      collection.public_slug,
      collection.title,
      collection.description,
      collection.version
    FROM host
    JOIN storefront.collections collection
      ON collection.tenant_id = host.tenant_id
     AND collection.storefront_id = host.storefront_id
     AND collection.sales_channel_id = host.sales_channel_id
     AND collection.publication_state = 'published'
     AND collection.public_slug = lower(trim(p_public_slug))
  ),
  cursor_member AS (
    SELECT member.collection_id, member.sort_order, member.id
    FROM published_collection collection
    JOIN storefront.collection_members member
      ON member.tenant_id = collection.tenant_id
     AND member.collection_id = collection.collection_id
     AND member.id = p_after_member_id
  ),
  bounded AS (
    SELECT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48) AS item_limit
  ),
  selected_members AS (
    SELECT DISTINCT ON (member.product_id)
      member.id AS member_id,
      member.product_id,
      member.variant_id,
      member.sort_order,
      document.product_document
    FROM published_collection collection
    JOIN storefront.collection_members member
      ON member.tenant_id = collection.tenant_id
     AND member.collection_id = collection.collection_id
    CROSS JOIN LATERAL storefront.compose_public_product_documents(
      collection.tenant_id,
      collection.storefront_id,
      collection.sales_channel_id,
      collection.locale,
      collection.currency
    ) document
    WHERE document.product_id = member.product_id
      AND (
        member.variant_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(document.product_document -> 'variants') variant
          WHERE variant ->> 'variantId' = member.variant_id::text
        )
      )
    ORDER BY member.product_id, member.sort_order, member.id
  ),
  ordered_members AS (
    SELECT selected.*
    FROM selected_members selected
    LEFT JOIN cursor_member cursor
      ON cursor.collection_id = (
        SELECT collection_id FROM published_collection LIMIT 1
      )
    WHERE p_after_member_id IS NULL
       OR (
         cursor.id IS NOT NULL
         AND (selected.sort_order, selected.member_id) > (cursor.sort_order, cursor.id)
       )
    ORDER BY selected.sort_order, selected.member_id
    LIMIT (SELECT item_limit + 1 FROM bounded)
  ),
  page AS (
    SELECT member.*
    FROM ordered_members member
    ORDER BY member.sort_order, member.member_id
    LIMIT (SELECT item_limit FROM bounded)
  ),
  page_summary AS (
    SELECT
      COALESCE(
        (
          SELECT jsonb_agg(page.product_document ORDER BY page.sort_order, page.member_id)
          FROM page
        ),
        '[]'::jsonb
      ) AS documents,
      (SELECT count(*) FROM ordered_members) > (SELECT item_limit FROM bounded) AS has_more,
      (
        SELECT page.member_id
        FROM page
        ORDER BY page.sort_order DESC, page.member_id DESC
        LIMIT 1
      ) AS page_cursor
  )
  SELECT
    collection.tenant_id,
    collection.storefront_id,
    collection.sales_channel_id,
    collection.request_hostname,
    collection.canonical_hostname,
    collection.locale,
    collection.currency,
    collection.price_list_revision,
    collection.publication_generation,
    jsonb_build_object(
      'collectionId', collection.collection_id::text,
      'code', collection.code,
      'slug', collection.public_slug,
      'title', left(collection.title, 240),
      'description', CASE
        WHEN collection.description IS NULL THEN NULL
        ELSE left(collection.description, 4000)
      END,
      'version', collection.version::text
    ),
    page_summary.documents,
    CASE WHEN page_summary.has_more THEN page_summary.page_cursor ELSE NULL END,
    page_summary.has_more
  FROM published_collection collection
  CROSS JOIN page_summary
  WHERE p_after_member_id IS NULL OR EXISTS (SELECT 1 FROM cursor_member);
$$;

REVOKE ALL ON FUNCTION storefront.resolve_public_category(text,text,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.resolve_public_collection(text,text,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storefront.resolve_public_category(text,text,integer,uuid) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.resolve_public_collection(text,text,integer,uuid) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0011','MOD-H-STOREFRONT','manifest:STF-0011-public-category-collection-resolution.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
