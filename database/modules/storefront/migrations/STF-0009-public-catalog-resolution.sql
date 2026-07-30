BEGIN;

CREATE OR REPLACE FUNCTION storefront.format_public_quantity(
  p_amount numeric,
  p_scale integer
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog AS $$
DECLARE
  v_digits text;
  v_padded text;
  v_whole text;
  v_fraction text;
BEGIN
  IF p_amount < 0 OR trunc(p_amount) <> p_amount OR p_scale < 0 OR p_scale > 18 THEN
    RAISE EXCEPTION 'invalid public quantity' USING ERRCODE = '22023';
  END IF;
  v_digits := trunc(p_amount)::text;
  IF p_scale = 0 THEN
    RETURN v_digits;
  END IF;
  v_padded := lpad(v_digits, p_scale + 1, '0');
  v_whole := left(v_padded, char_length(v_padded) - p_scale);
  v_fraction := rtrim(right(v_padded, p_scale), '0');
  RETURN CASE WHEN v_fraction = '' THEN v_whole ELSE v_whole || '.' || v_fraction END;
END $$;

CREATE OR REPLACE FUNCTION storefront.compose_public_product_documents(
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_sales_channel_id uuid,
  p_locale text,
  p_currency text
) RETURNS TABLE(
  product_id uuid,
  public_slug text,
  product_document jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform, catalog, pricing, inventory
SET row_security = off AS $$
  WITH channel_context AS (
    SELECT
      sc.tenant_id,
      sc.storefront_id,
      sc.id AS sales_channel_id,
      sc.price_list_id,
      sc.inventory_scope,
      sc.backorder_policy,
      sf.legal_entity_id,
      sf.primary_store_id,
      pl.currency::text AS currency,
      pl.money_scale,
      pl.active_version
    FROM storefront.sales_channels sc
    JOIN storefront.storefronts sf
      ON sf.tenant_id = sc.tenant_id
     AND sf.id = sc.storefront_id
     AND sf.status = 'active'
    JOIN pricing.price_lists pl
      ON pl.tenant_id = sc.tenant_id
     AND pl.id = sc.price_list_id
     AND pl.status = 'active'
     AND pl.active_version IS NOT NULL
    WHERE sc.tenant_id = p_tenant_id
      AND sc.storefront_id = p_storefront_id
      AND sc.id = p_sales_channel_id
      AND sc.status = 'active'
      AND pl.currency::text = upper(p_currency)
      AND pl.money_scale BETWEEN 0 AND 6
  ),
  active_price_version AS (
    SELECT
      plv.tenant_id,
      plv.id AS price_list_version_id,
      plv.price_list_id,
      plv.version
    FROM pricing.price_list_versions plv
    JOIN channel_context cc
      ON cc.tenant_id = plv.tenant_id
     AND cc.price_list_id = plv.price_list_id
     AND cc.active_version = plv.version
    WHERE plv.status = 'active'
      AND plv.effective_from <= statement_timestamp()
      AND (plv.effective_until IS NULL OR plv.effective_until > statement_timestamp())
      AND (plv.legal_entity_id IS NULL OR plv.legal_entity_id = cc.legal_entity_id)
      AND (plv.store_id IS NULL OR plv.store_id = cc.primary_store_id)
      AND (plv.channel IS NULL OR plv.channel = 'web')
    ORDER BY plv.priority DESC, plv.version DESC, plv.id
    LIMIT 1
  ),
  raw_warehouse_scope AS (
    SELECT jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(cc.inventory_scope -> 'warehouseIds') = 'array'
          THEN cc.inventory_scope -> 'warehouseIds'
        ELSE '[]'::jsonb
      END
    ) AS warehouse_id_text
    FROM channel_context cc
  ),
  warehouse_scope AS (
    SELECT DISTINCT w.id AS warehouse_id
    FROM raw_warehouse_scope raw
    JOIN platform.warehouses w
      ON raw.warehouse_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     AND w.id = raw.warehouse_id_text::uuid
     AND w.tenant_id = p_tenant_id
     AND w.status = 'active'
  ),
  publication_candidates AS (
    SELECT
      pp.tenant_id,
      pp.storefront_id,
      pp.sales_channel_id,
      pp.product_id,
      pp.public_slug,
      pp.metadata AS publication_metadata,
      p.code,
      p.kind,
      p.default_locale,
      COALESCE(
        NULLIF(trim(localized.display_name), ''),
        NULLIF(trim(fallback_localized.display_name), ''),
        NULLIF(trim(p.code), ''),
        'Product'
      ) AS display_name,
      COALESCE(localized.description, fallback_localized.description) AS description
    FROM storefront.product_publications pp
    JOIN catalog.products p
      ON p.tenant_id = pp.tenant_id
     AND p.id = pp.product_id
     AND p.status = 'active'
    LEFT JOIN catalog.product_localizations localized
      ON localized.tenant_id = p.tenant_id
     AND localized.product_id = p.id
     AND lower(localized.locale) = lower(p_locale)
    LEFT JOIN catalog.product_localizations fallback_localized
      ON fallback_localized.tenant_id = p.tenant_id
     AND fallback_localized.product_id = p.id
     AND lower(fallback_localized.locale) = lower(p.default_locale)
    WHERE pp.tenant_id = p_tenant_id
      AND pp.storefront_id = p_storefront_id
      AND pp.sales_channel_id = p_sales_channel_id
      AND pp.publication_state = 'published'
  ),
  variant_dimensions AS (
    SELECT
      pc.*,
      v.id AS variant_id,
      v.sku,
      COALESCE(NULLIF(trim(v.title), ''), pc.display_name) AS variant_title,
      v.unit_code,
      u.decimal_scale AS quantity_scale,
      vp.publication_state AS variant_publication_state
    FROM publication_candidates pc
    JOIN catalog.variants v
      ON v.tenant_id = pc.tenant_id
     AND v.product_id = pc.product_id
     AND v.status = 'active'
     AND v.unit_code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$'
    JOIN catalog.units u
      ON u.tenant_id = v.tenant_id
     AND u.code = v.unit_code
     AND u.status = 'active'
    LEFT JOIN storefront.variant_publications vp
      ON vp.tenant_id = pc.tenant_id
     AND vp.storefront_id = pc.storefront_id
     AND vp.sales_channel_id = pc.sales_channel_id
     AND vp.product_id = pc.product_id
     AND vp.variant_id = v.id
    WHERE COALESCE(vp.publication_state, 'published') = 'published'
  ),
  priced_variants AS (
    SELECT
      vd.*,
      cc.money_scale,
      cc.currency,
      cc.backorder_policy,
      price_rule.id AS price_rule_id,
      price_rule.unit_price_minor,
      price_rule.compare_at_price_minor,
      COALESCE(stock_state.on_hand, 0::numeric) AS on_hand,
      COALESCE(reservation_state.reserved, 0::numeric) AS reserved,
      COALESCE(stock_state.as_of, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS inventory_as_of,
      COALESCE(stock_state.version, 0::bigint) AS inventory_version,
      (SELECT count(*) FROM warehouse_scope) AS warehouse_count
    FROM variant_dimensions vd
    JOIN channel_context cc
      ON cc.tenant_id = vd.tenant_id
     AND cc.storefront_id = vd.storefront_id
     AND cc.sales_channel_id = vd.sales_channel_id
    JOIN active_price_version apv
      ON apv.tenant_id = vd.tenant_id
    JOIN LATERAL (
      SELECT
        pr.id,
        pr.unit_price_minor,
        pr.compare_at_price_minor
      FROM pricing.price_rules pr
      WHERE pr.tenant_id = vd.tenant_id
        AND pr.price_list_version_id = apv.price_list_version_id
        AND pr.variant_id = vd.variant_id
        AND pr.unit_code = vd.unit_code
        AND pr.quantity_scale = vd.quantity_scale
        AND pr.minimum_quantity_minor <= power(10::numeric, vd.quantity_scale)
        AND (pr.effective_from IS NULL OR pr.effective_from <= statement_timestamp())
        AND (pr.effective_until IS NULL OR pr.effective_until > statement_timestamp())
      ORDER BY
        pr.minimum_quantity_minor DESC,
        pr.priority DESC,
        pr.rule_version DESC,
        pr.id
      LIMIT 1
    ) price_rule ON true
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(sum(sb.quantity_amount), 0::numeric) AS on_hand,
        max(sb.updated_at) AS as_of,
        max(sb.version) AS version
      FROM inventory.stock_balances sb
      JOIN warehouse_scope ws ON ws.warehouse_id = sb.warehouse_id
      WHERE sb.tenant_id = vd.tenant_id
        AND sb.variant_id = vd.variant_id
        AND sb.stock_status = 'sellable'
        AND sb.unit_code = vd.unit_code
        AND sb.quantity_scale = vd.quantity_scale
    ) stock_state ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        sum(srl.reserved_quantity - srl.consumed_quantity - srl.released_quantity),
        0::numeric
      ) AS reserved
      FROM inventory.stock_reservation_lines srl
      JOIN inventory.stock_reservations sr
        ON sr.tenant_id = srl.tenant_id
       AND sr.id = srl.reservation_id
       AND sr.state IN ('fully_reserved','partially_reserved','partially_consumed')
      JOIN warehouse_scope ws ON ws.warehouse_id = srl.warehouse_id
      WHERE srl.tenant_id = vd.tenant_id
        AND srl.variant_id = vd.variant_id
        AND srl.unit_code = vd.unit_code
        AND srl.quantity_scale = vd.quantity_scale
    ) reservation_state ON true
  ),
  variant_documents AS (
    SELECT
      pv.*,
      GREATEST(pv.on_hand - pv.reserved, 0::numeric) AS available_quantity,
      CASE
        WHEN pv.kind IN ('service','non_stock') THEN 'available'
        WHEN pv.warehouse_count = 0 THEN 'unknown'
        WHEN pv.on_hand - pv.reserved > 0 THEN 'available'
        WHEN pv.backorder_policy IN ('allow','preorder_only') THEN 'preorder'
        ELSE 'unavailable'
      END AS availability,
      jsonb_build_object(
        'variantId', pv.variant_id::text,
        'sku', left(COALESCE(NULLIF(trim(pv.sku), ''), pv.variant_id::text), 160),
        'title', left(pv.variant_title, 240),
        'unitCode', pv.unit_code,
        'availability', CASE
          WHEN pv.kind IN ('service','non_stock') THEN 'available'
          WHEN pv.warehouse_count = 0 THEN 'unknown'
          WHEN pv.on_hand - pv.reserved > 0 THEN 'available'
          WHEN pv.backorder_policy IN ('allow','preorder_only') THEN 'preorder'
          ELSE 'unavailable'
        END,
        'price', jsonb_build_object(
          'currency', pv.currency,
          'minor', pv.unit_price_minor::text,
          'scale', pv.money_scale
        ),
        'compareAtPrice', CASE
          WHEN pv.compare_at_price_minor IS NULL THEN NULL
          ELSE jsonb_build_object(
            'currency', pv.currency,
            'minor', pv.compare_at_price_minor::text,
            'scale', pv.money_scale
          )
        END,
        'quantity', CASE
          WHEN pv.kind IN ('service','non_stock') OR pv.warehouse_count = 0 THEN NULL
          ELSE jsonb_build_object(
            'amount', storefront.format_public_quantity(
              GREATEST(pv.on_hand - pv.reserved, 0::numeric),
              pv.quantity_scale
            ),
            'unit', pv.unit_code,
            'scale', pv.quantity_scale,
            'asOf', to_char(pv.inventory_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'version', pv.inventory_version::text
          )
        END
      ) AS variant_document
    FROM priced_variants pv
  ),
  product_documents AS (
    SELECT
      vd.product_id,
      min(vd.public_slug) AS public_slug,
      jsonb_build_object(
        'summary', jsonb_build_object(
          'contractVersion', 'storefront-product-card.v1',
          'productId', vd.product_id::text,
          'variantId', (array_agg(vd.variant_id ORDER BY vd.unit_price_minor, vd.variant_id))[1]::text,
          'slug', min(vd.public_slug),
          'name', left(min(vd.display_name), 240),
          'publicationState', 'published',
          'availability', CASE
            WHEN bool_or(vd.availability = 'available') THEN 'available'
            WHEN bool_or(vd.availability = 'preorder') THEN 'preorder'
            WHEN bool_and(vd.availability = 'unavailable') THEN 'unavailable'
            ELSE 'unknown'
          END,
          'pricePrefix', CASE
            WHEN count(DISTINCT vd.unit_price_minor) > 1 THEN 'from'
            ELSE 'none'
          END,
          'price', jsonb_build_object(
            'currency', min(vd.currency),
            'minor', min(vd.unit_price_minor)::text,
            'scale', min(vd.money_scale)
          ),
          'compareAtPrice', CASE
            WHEN (array_agg(vd.compare_at_price_minor ORDER BY vd.unit_price_minor, vd.variant_id))[1] IS NULL
              THEN NULL
            ELSE jsonb_build_object(
              'currency', min(vd.currency),
              'minor', (array_agg(vd.compare_at_price_minor ORDER BY vd.unit_price_minor, vd.variant_id))[1]::text,
              'scale', min(vd.money_scale)
            )
          END,
          'media', NULL,
          'badge', CASE
            WHEN char_length(trim(min(vd.publication_metadata ->> 'badge'))) BETWEEN 1 AND 80
             AND trim(min(vd.publication_metadata ->> 'badge')) !~ '[[:cntrl:]]'
              THEN trim(min(vd.publication_metadata ->> 'badge'))
            ELSE NULL
          END
        ),
        'code', left(min(vd.code), 160),
        'description', CASE
          WHEN min(vd.description) IS NULL THEN NULL
          ELSE left(min(vd.description), 5000)
        END,
        'kind', min(vd.kind),
        'pricingNotice', 'tax_calculated_at_checkout',
        'variants', jsonb_agg(vd.variant_document ORDER BY vd.unit_price_minor, vd.variant_id)
      ) AS product_document
    FROM variant_documents vd
    GROUP BY vd.product_id
  )
  SELECT pd.product_id, pd.public_slug, pd.product_document
  FROM product_documents pd
  ORDER BY pd.product_id;
$$;

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
SET search_path = pg_catalog, storefront, platform, catalog, pricing, inventory
SET row_security = off AS $$
  WITH host AS (
    SELECT * FROM storefront.resolve_public_host(p_hostname)
  ),
  bounded AS (
    SELECT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48) AS item_limit
  ),
  candidates AS (
    SELECT document.*
    FROM host h
    CROSS JOIN LATERAL storefront.compose_public_product_documents(
      h.tenant_id,
      h.storefront_id,
      h.sales_channel_id,
      h.locale,
      h.currency
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
      (SELECT max(page.product_id) FROM page) AS page_cursor
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
    s.documents,
    CASE WHEN s.has_more THEN s.page_cursor ELSE NULL END,
    s.has_more
  FROM host h
  CROSS JOIN summary s;
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
SET search_path = pg_catalog, storefront, platform, catalog, pricing, inventory
SET row_security = off AS $$
  WITH host AS (
    SELECT * FROM storefront.resolve_public_host(p_hostname)
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
    document.product_document
  FROM host h
  CROSS JOIN LATERAL storefront.compose_public_product_documents(
    h.tenant_id,
    h.storefront_id,
    h.sales_channel_id,
    h.locale,
    h.currency
  ) document
  WHERE document.public_slug = lower(trim(p_public_slug))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION storefront.format_public_quantity(numeric,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.compose_public_product_documents(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.resolve_public_catalog(text,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION storefront.resolve_public_product(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storefront.resolve_public_catalog(text,integer,uuid) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION storefront.resolve_public_product(text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0009','MOD-H-STOREFRONT','manifest:STF-0009-public-catalog-resolution.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
