BEGIN;

CREATE OR REPLACE FUNCTION catalog.catalog_snapshot_feed(
  p_locale text,
  p_snapshot_at timestamptz,
  p_after_updated_at timestamptz DEFAULT NULL,
  p_after_variant_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 500
) RETURNS TABLE(
  product_id uuid,
  variant_id uuid,
  product_code text,
  sku text,
  display_name text,
  variant_title text,
  status text,
  unit_code text,
  tax_code text,
  barcodes text[],
  version bigint,
  updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,platform,catalog AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_limit integer := LEAST(GREATEST(p_limit,1),501);
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant context is required' USING ERRCODE='42501';
  END IF;
  IF p_snapshot_at IS NULL THEN
    RAISE EXCEPTION 'snapshot instant is required' USING ERRCODE='22023';
  END IF;
  IF (p_after_updated_at IS NULL) <> (p_after_variant_id IS NULL) THEN
    RAISE EXCEPTION 'feed cursor requires both updated_at and variant_id' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  SELECT d.product_id,d.variant_id,d.product_code,d.sku,
    COALESCE(localized.display_name,d.display_name),d.variant_title,d.status,d.unit_code,
    d.tax_code,d.barcodes,d.version,d.updated_at
  FROM catalog.variant_search_documents d
  LEFT JOIN catalog.product_localizations localized
    ON localized.tenant_id=d.tenant_id
    AND localized.product_id=d.product_id
    AND lower(localized.locale)=lower(p_locale)
  WHERE d.tenant_id=v_tenant_id
    AND d.updated_at<=p_snapshot_at
    AND (
      p_after_updated_at IS NULL OR
      (d.updated_at,d.variant_id)>(p_after_updated_at,p_after_variant_id)
    )
  ORDER BY d.updated_at,d.variant_id
  LIMIT v_limit;
END $$;

INSERT INTO platform.permissions(code,module,description,risk_level) VALUES
  ('catalog.feed.read','catalog','Read a bounded catalog snapshot or incremental POS feed','standard')
ON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description,risk_level=EXCLUDED.risk_level;

REVOKE ALL ON FUNCTION catalog.catalog_snapshot_feed(text,timestamptz,timestamptz,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.catalog_snapshot_feed(text,timestamptz,timestamptz,uuid,integer)
  TO store_app_runtime,store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id,module,checksum)
VALUES ('CAT-0003','MOD-A-CATALOG','manifest:CAT-0003-pos-feed.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
