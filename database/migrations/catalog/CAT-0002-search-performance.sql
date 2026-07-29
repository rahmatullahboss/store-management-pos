BEGIN;

CREATE OR REPLACE FUNCTION catalog.search_variant_feed(
  p_locale text,
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_cursor text DEFAULT NULL
) RETURNS TABLE(
  product_id uuid, variant_id uuid, product_code text, sku text, display_name text,
  variant_title text, status text, unit_code text, tax_code text, barcodes text[], version bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, platform, catalog, public AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_query text := upper(btrim(COALESCE(p_query,'')));
  v_limit integer := LEAST(GREATEST(p_limit,1),500);
  v_rows integer;
  v_pattern text;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant context is required' USING ERRCODE='42501';
  END IF;

  IF v_query = '' THEN
    RETURN QUERY
    SELECT d.product_id,d.variant_id,d.product_code,d.sku,
      COALESCE(localized.display_name,d.display_name),d.variant_title,d.status,d.unit_code,d.tax_code,d.barcodes,d.version
    FROM catalog.variant_search_documents d
    LEFT JOIN catalog.product_localizations localized
      ON localized.tenant_id=d.tenant_id AND localized.product_id=d.product_id AND lower(localized.locale)=lower(p_locale)
    WHERE d.tenant_id=v_tenant_id
      AND (p_cursor IS NULL OR d.sku > p_cursor)
    ORDER BY d.sku
    LIMIT v_limit;
    RETURN;
  END IF;

  RETURN QUERY
  WITH exact_matches AS (
    SELECT d.product_id,d.variant_id,d.product_code,d.sku,d.display_name,d.variant_title,d.status,d.unit_code,d.tax_code,d.barcodes,d.version,0 AS match_rank
    FROM catalog.variant_barcodes barcode
    JOIN catalog.variant_search_documents d
      ON d.tenant_id=barcode.tenant_id AND d.variant_id=barcode.variant_id
    WHERE barcode.tenant_id=v_tenant_id
      AND barcode.normalized_value=v_query
      AND (p_cursor IS NULL OR d.sku > p_cursor)
    UNION ALL
    SELECT d.product_id,d.variant_id,d.product_code,d.sku,d.display_name,d.variant_title,d.status,d.unit_code,d.tax_code,d.barcodes,d.version,1 AS match_rank
    FROM catalog.variant_search_documents d
    WHERE d.tenant_id=v_tenant_id
      AND d.sku=v_query
      AND (p_cursor IS NULL OR d.sku > p_cursor)
    UNION ALL
    SELECT d.product_id,d.variant_id,d.product_code,d.sku,d.display_name,d.variant_title,d.status,d.unit_code,d.tax_code,d.barcodes,d.version,2 AS match_rank
    FROM catalog.variant_search_documents d
    WHERE d.tenant_id=v_tenant_id
      AND d.product_code=v_query
      AND (p_cursor IS NULL OR d.sku > p_cursor)
  ), ranked AS (
    SELECT exact_matches.*,
      row_number() OVER (PARTITION BY exact_matches.variant_id ORDER BY exact_matches.match_rank,exact_matches.sku) AS duplicate_rank
    FROM exact_matches
  )
  SELECT ranked.product_id,ranked.variant_id,ranked.product_code,ranked.sku,
    COALESCE(localized.display_name,ranked.display_name),ranked.variant_title,ranked.status,ranked.unit_code,ranked.tax_code,ranked.barcodes,ranked.version
  FROM ranked
  LEFT JOIN catalog.product_localizations localized
    ON localized.tenant_id=v_tenant_id AND localized.product_id=ranked.product_id AND lower(localized.locale)=lower(p_locale)
  WHERE ranked.duplicate_rank=1
  ORDER BY ranked.match_rank,ranked.sku
  LIMIT v_limit;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN RETURN; END IF;

  RETURN QUERY
  SELECT d.product_id,d.variant_id,d.product_code,d.sku,
    COALESCE(localized.display_name,d.display_name),d.variant_title,d.status,d.unit_code,d.tax_code,d.barcodes,d.version
  FROM catalog.variant_search_documents d
  LEFT JOIN catalog.product_localizations localized
    ON localized.tenant_id=d.tenant_id AND localized.product_id=d.product_id AND lower(localized.locale)=lower(p_locale)
  WHERE d.tenant_id=v_tenant_id
    AND (p_cursor IS NULL OR d.sku > p_cursor)
    AND d.search_vector @@ plainto_tsquery('simple'::regconfig,p_query)
  ORDER BY ts_rank_cd(d.search_vector,plainto_tsquery('simple'::regconfig,p_query)) DESC,d.sku
  LIMIT v_limit;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN RETURN; END IF;

  IF char_length(btrim(p_query)) < 3 OR v_query ~ '^[A-Z0-9._/-]+$' THEN RETURN; END IF;

  v_pattern := '%' || replace(replace(replace(btrim(p_query),E'\\',E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  RETURN QUERY
  SELECT d.product_id,d.variant_id,d.product_code,d.sku,
    COALESCE(localized.display_name,d.display_name),d.variant_title,d.status,d.unit_code,d.tax_code,d.barcodes,d.version
  FROM catalog.variant_search_documents d
  LEFT JOIN catalog.product_localizations localized
    ON localized.tenant_id=d.tenant_id AND localized.product_id=d.product_id AND lower(localized.locale)=lower(p_locale)
  WHERE d.tenant_id=v_tenant_id
    AND (p_cursor IS NULL OR d.sku > p_cursor)
    AND d.searchable_text ILIKE v_pattern ESCAPE E'\\'
  ORDER BY d.sku
  LIMIT v_limit;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN RETURN; END IF;

  RETURN QUERY
  SELECT d.product_id,d.variant_id,d.product_code,d.sku,
    COALESCE(localized.display_name,d.display_name),d.variant_title,d.status,d.unit_code,d.tax_code,d.barcodes,d.version
  FROM catalog.variant_search_documents d
  LEFT JOIN catalog.product_localizations localized
    ON localized.tenant_id=d.tenant_id AND localized.product_id=d.product_id AND lower(localized.locale)=lower(p_locale)
  WHERE d.tenant_id=v_tenant_id
    AND (p_cursor IS NULL OR d.sku > p_cursor)
    AND p_query OPERATOR(public.<%) d.searchable_text
  ORDER BY public.word_similarity(p_query,d.searchable_text) DESC,d.sku
  LIMIT v_limit;
END $$;

REVOKE ALL ON FUNCTION catalog.search_variant_feed(text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.search_variant_feed(text,text,integer,text) TO store_app_runtime,store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id,module,checksum)
VALUES ('CAT-0002','MOD-A-CATALOG','manifest:CAT-0002-search-performance.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
