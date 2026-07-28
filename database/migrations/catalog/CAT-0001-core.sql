BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS catalog;

CREATE TABLE IF NOT EXISTS catalog.categories (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  parent_id uuid NULL,
  code text NOT NULL,
  normalized_code text NOT NULL,
  display_name text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, normalized_code),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES catalog.categories(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS catalog.brands (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  code text NOT NULL,
  normalized_code text NOT NULL,
  display_name text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, normalized_code)
);

CREATE TABLE IF NOT EXISTS catalog.tags (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  code text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS catalog.units (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  code text NOT NULL,
  display_name text NOT NULL,
  dimension text NOT NULL,
  decimal_scale integer NOT NULL CHECK (decimal_scale BETWEEN 0 AND 18),
  is_base_unit boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS units_one_base_per_dimension_idx ON catalog.units(tenant_id, dimension) WHERE is_base_unit;

CREATE TABLE IF NOT EXISTS catalog.unit_conversion_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  from_unit_id uuid NOT NULL,
  to_unit_id uuid NOT NULL,
  numerator numeric(38,0) NOT NULL CHECK (numerator > 0),
  denominator numeric(38,0) NOT NULL CHECK (denominator > 0),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz NULL,
  conversion_version bigint NOT NULL CHECK (conversion_version > 0),
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, from_unit_id, to_unit_id, conversion_version),
  FOREIGN KEY (tenant_id, from_unit_id) REFERENCES catalog.units(tenant_id, id),
  FOREIGN KEY (tenant_id, to_unit_id) REFERENCES catalog.units(tenant_id, id),
  CHECK (from_unit_id <> to_unit_id),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX IF NOT EXISTS unit_conversion_effective_idx ON catalog.unit_conversion_versions(tenant_id, from_unit_id, to_unit_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS catalog.attribute_definitions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  code text NOT NULL,
  display_name text NOT NULL,
  data_type text NOT NULL CHECK (data_type IN ('option','text','number','boolean','date')),
  variant_axis boolean NOT NULL DEFAULT false,
  required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS catalog.attribute_values (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  definition_id uuid NOT NULL,
  code text NOT NULL,
  display_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, definition_id, code),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES catalog.attribute_definitions(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS catalog.products (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  code text NOT NULL,
  normalized_code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('stock','service','bundle','non_stock')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','inactive','archived')),
  default_locale text NOT NULL,
  brand_id uuid NULL,
  tax_code text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NULL,
  archived_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, normalized_code),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES catalog.brands(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS products_status_idx ON catalog.products(tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS catalog.product_localizations (
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  locale text NOT NULL,
  display_name text NOT NULL,
  description text NULL,
  search_keywords text[] NOT NULL DEFAULT '{}',
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce(display_name,'') || ' ' || coalesce(description,''))) STORED,
  PRIMARY KEY (tenant_id, product_id, locale),
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog.products(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS product_localizations_search_idx ON catalog.product_localizations USING gin(search_vector);
CREATE INDEX IF NOT EXISTS product_localizations_name_trgm_idx ON catalog.product_localizations USING gin(display_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS catalog.product_categories (
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  category_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, product_id, category_id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog.products(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, category_id) REFERENCES catalog.categories(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS catalog.product_tags (
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, product_id, tag_id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog.products(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, tag_id) REFERENCES catalog.tags(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS catalog.variants (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  product_id uuid NOT NULL,
  sku text NOT NULL,
  normalized_sku text NOT NULL,
  title text NOT NULL,
  combination_key text NOT NULL,
  unit_code text NOT NULL,
  tracking_mode text NOT NULL DEFAULT 'none' CHECK (tracking_mode IN ('none','serial','batch','batch_expiry')),
  weight_minor numeric(38,0) NULL,
  weight_scale integer NULL CHECK (weight_scale BETWEEN 0 AND 18),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, normalized_sku),
  UNIQUE (tenant_id, product_id, combination_key),
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog.products(tenant_id, id),
  CHECK ((weight_minor IS NULL AND weight_scale IS NULL) OR (weight_minor >= 0 AND weight_scale IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS variants_product_idx ON catalog.variants(tenant_id, product_id, status);
CREATE INDEX IF NOT EXISTS variants_sku_trgm_idx ON catalog.variants USING gin(normalized_sku gin_trgm_ops);

CREATE TABLE IF NOT EXISTS catalog.variant_attributes (
  tenant_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  definition_id uuid NOT NULL,
  value_code text NOT NULL,
  display_label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, variant_id, definition_id),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES catalog.variants(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, definition_id) REFERENCES catalog.attribute_definitions(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS catalog.variant_barcodes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  variant_id uuid NOT NULL,
  value text NOT NULL,
  normalized_value text NOT NULL,
  symbology text NOT NULL CHECK (symbology IN ('EAN13','EAN8','UPC_A','UPC_E','CODE128','QR','INTERNAL')),
  is_primary boolean NOT NULL DEFAULT false,
  unit_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, normalized_value),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES catalog.variants(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS variant_one_primary_barcode_idx ON catalog.variant_barcodes(tenant_id, variant_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS variant_barcodes_variant_idx ON catalog.variant_barcodes(tenant_id, variant_id);

CREATE TABLE IF NOT EXISTS catalog.product_media (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  product_id uuid NOT NULL,
  variant_id uuid NULL,
  url text NOT NULL,
  alt_text text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog.products(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, variant_id) REFERENCES catalog.variants(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS catalog.variant_supplier_references (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  variant_id uuid NOT NULL,
  supplier_id text NOT NULL,
  supplier_sku text NOT NULL,
  supplier_name text NULL,
  minimum_order_quantity_minor numeric(38,0) NULL,
  quantity_scale integer NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, variant_id, supplier_id, supplier_sku),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES catalog.variants(tenant_id, id) ON DELETE CASCADE,
  CHECK ((minimum_order_quantity_minor IS NULL AND quantity_scale IS NULL) OR (minimum_order_quantity_minor > 0 AND quantity_scale IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS catalog.bundle_components (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  bundle_variant_id uuid NOT NULL,
  component_variant_id uuid NOT NULL,
  quantity_minor numeric(38,0) NOT NULL CHECK (quantity_minor > 0),
  quantity_scale integer NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  unit_code text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, bundle_variant_id, component_variant_id),
  FOREIGN KEY (tenant_id, bundle_variant_id) REFERENCES catalog.variants(tenant_id, id),
  FOREIGN KEY (tenant_id, component_variant_id) REFERENCES catalog.variants(tenant_id, id),
  CHECK (bundle_variant_id <> component_variant_id)
);

CREATE TABLE IF NOT EXISTS catalog.variant_search_documents (
  tenant_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_code text NOT NULL,
  sku text NOT NULL,
  display_name text NOT NULL,
  variant_title text NOT NULL,
  status text NOT NULL,
  unit_code text NOT NULL,
  tax_code text NULL,
  barcodes text[] NOT NULL DEFAULT '{}',
  searchable_text text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, searchable_text)) STORED,
  version bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, variant_id),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES catalog.variants(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog.products(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS variant_search_vector_idx ON catalog.variant_search_documents USING gin(search_vector);
CREATE INDEX IF NOT EXISTS variant_search_text_trgm_idx ON catalog.variant_search_documents USING gin(searchable_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS variant_search_sku_idx ON catalog.variant_search_documents(tenant_id, sku);
CREATE INDEX IF NOT EXISTS variant_search_product_code_idx ON catalog.variant_search_documents(tenant_id, product_code);
CREATE INDEX IF NOT EXISTS variant_search_barcodes_idx ON catalog.variant_search_documents USING gin(barcodes);

CREATE TABLE IF NOT EXISTS catalog.import_runs (
  id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  source_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('validated','executing','completed','failed')),
  accepted_rows integer NOT NULL CHECK (accepted_rows >= 0),
  warning_count integer NOT NULL CHECK (warning_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, source_hash, id)
);

CREATE TABLE IF NOT EXISTS catalog.import_errors (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  import_id text NOT NULL,
  row_number integer NOT NULL CHECK (row_number > 0),
  code text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning','error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, import_id) REFERENCES catalog.import_runs(tenant_id, id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION catalog.reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000'; END $$;
DROP TRIGGER IF EXISTS unit_conversion_versions_append_only ON catalog.unit_conversion_versions;
CREATE TRIGGER unit_conversion_versions_append_only BEFORE UPDATE OR DELETE ON catalog.unit_conversion_versions FOR EACH ROW EXECUTE FUNCTION catalog.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'categories','brands','tags','units','unit_conversion_versions','attribute_definitions','attribute_values',
    'products','product_localizations','product_categories','product_tags','variants','variant_attributes',
    'variant_barcodes','product_media','variant_supplier_references','bundle_components','variant_search_documents',
    'import_runs','import_errors'
  ] LOOP
    EXECUTE format('ALTER TABLE catalog.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE catalog.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON catalog.%I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON catalog.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())', table_name);
  END LOOP;
END $rls$;

CREATE OR REPLACE FUNCTION catalog.refresh_product_search_documents(p_product_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, platform, catalog AS $$
DECLARE v_tenant_id uuid := platform.current_tenant_id();
BEGIN
  DELETE FROM catalog.variant_search_documents WHERE tenant_id = v_tenant_id AND product_id = p_product_id;
  INSERT INTO catalog.variant_search_documents(
    tenant_id, variant_id, product_id, product_code, sku, display_name, variant_title, status,
    unit_code, tax_code, barcodes, searchable_text, version
  )
  SELECT
    p.tenant_id, v.id, p.id, p.normalized_code, v.normalized_sku,
    COALESCE(default_text.display_name, any_text.display_name, p.code), v.title,
    CASE WHEN p.status = 'active' AND v.status = 'active' THEN 'active' ELSE 'inactive' END,
    v.unit_code, p.tax_code,
    COALESCE(barcode_list.values, '{}'::text[]),
    concat_ws(' ', p.normalized_code, v.normalized_sku, v.title,
      COALESCE(default_text.display_name, ''), COALESCE(default_text.description, ''),
      COALESCE(any_text.all_text, ''), COALESCE(attribute_text.all_text, ''),
      COALESCE(tag_text.all_text, ''), COALESCE(array_to_string(barcode_list.values, ' '), '')),
    GREATEST(p.version, v.version)
  FROM catalog.products p
  JOIN catalog.variants v ON v.tenant_id = p.tenant_id AND v.product_id = p.id
  LEFT JOIN catalog.product_localizations default_text ON default_text.tenant_id = p.tenant_id AND default_text.product_id = p.id AND lower(default_text.locale) = lower(p.default_locale)
  LEFT JOIN LATERAL (
    SELECT min(pl.display_name) AS display_name, string_agg(concat_ws(' ', pl.display_name, pl.description, array_to_string(pl.search_keywords, ' ')), ' ') AS all_text
    FROM catalog.product_localizations pl WHERE pl.tenant_id = p.tenant_id AND pl.product_id = p.id
  ) any_text ON true
  LEFT JOIN LATERAL (
    SELECT string_agg(concat_ws(' ', va.value_code, va.display_label), ' ') AS all_text
    FROM catalog.variant_attributes va WHERE va.tenant_id = v.tenant_id AND va.variant_id = v.id
  ) attribute_text ON true
  LEFT JOIN LATERAL (
    SELECT string_agg(t.code, ' ') AS all_text
    FROM catalog.product_tags pt JOIN catalog.tags t ON t.tenant_id = pt.tenant_id AND t.id = pt.tag_id
    WHERE pt.tenant_id = p.tenant_id AND pt.product_id = p.id
  ) tag_text ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(vb.normalized_value ORDER BY vb.is_primary DESC, vb.normalized_value) AS values
    FROM catalog.variant_barcodes vb WHERE vb.tenant_id = v.tenant_id AND vb.variant_id = v.id
  ) barcode_list ON true
  WHERE p.tenant_id = v_tenant_id AND p.id = p_product_id AND v.status <> 'archived';
END $$;

CREATE OR REPLACE FUNCTION catalog.save_product(
  p_idempotency_key text,
  p_request_hash text,
  p_product jsonb,
  p_expected_version bigint,
  p_request_id text
) RETURNS TABLE(product_id uuid, version bigint, status text, replayed boolean, updated_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, platform, catalog AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_trace_id text := COALESCE(platform.current_trace_id(), p_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_product_id uuid := (p_product->>'id')::uuid;
  v_current catalog.products%ROWTYPE;
  v_version bigint;
  v_status text;
  v_updated_at timestamptz;
  v_variant jsonb;
  v_localized jsonb;
  v_attribute jsonb;
  v_barcode jsonb;
  v_reference jsonb;
  v_media jsonb;
  v_tag text;
  v_category text;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN RAISE EXCEPTION 'request context is required' USING ERRCODE = '42501'; END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 THEN RAISE EXCEPTION 'idempotency key is required' USING ERRCODE = '22023'; END IF;
  IF p_request_hash !~ '^[a-fA-F0-9]{64}$' THEN RAISE EXCEPTION 'request hash is invalid' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_existing FROM platform.idempotency_records
  WHERE tenant_id = v_tenant_id AND scope = 'catalog.product.save' AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE = 'P0001'; END IF;
    IF v_existing.status = 'completed' THEN
      RETURN QUERY SELECT (v_existing.response_json->>'productId')::uuid, (v_existing.response_json->>'version')::bigint,
        v_existing.response_json->>'status', true, (v_existing.response_json->>'updatedAt')::timestamptz;
      RETURN;
    END IF;
    RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE = '55P03';
  END IF;
  INSERT INTO platform.idempotency_records(tenant_id, scope, idempotency_key, request_hash, status)
  VALUES (v_tenant_id, 'catalog.product.save', p_idempotency_key, p_request_hash, 'processing');

  SELECT * INTO v_current FROM catalog.products WHERE tenant_id = v_tenant_id AND id = v_product_id FOR UPDATE;
  IF FOUND THEN
    IF p_expected_version IS NULL OR v_current.version <> p_expected_version THEN RAISE EXCEPTION 'catalog product version conflict' USING ERRCODE = '40001'; END IF;
    IF v_current.status = 'archived' THEN RAISE EXCEPTION 'archived product cannot be edited' USING ERRCODE = '55000'; END IF;
    UPDATE catalog.products SET
      code = p_product->>'code', normalized_code = p_product->>'normalizedCode', kind = p_product->>'kind',
      status = p_product->>'status', default_locale = p_product->>'defaultLocale',
      brand_id = NULLIF(p_product->>'brandId','')::uuid, tax_code = NULLIF(p_product->>'taxCode',''),
      metadata = COALESCE(p_product->'metadata','{}'::jsonb), updated_by = v_actor_id, updated_at = now(), version = version + 1
    WHERE tenant_id = v_tenant_id AND id = v_product_id
    RETURNING catalog.products.version, catalog.products.status, catalog.products.updated_at INTO v_version, v_status, v_updated_at;
  ELSE
    IF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'catalog product does not exist' USING ERRCODE = '40001'; END IF;
    INSERT INTO catalog.products(id, tenant_id, code, normalized_code, kind, status, default_locale, brand_id, tax_code, metadata, created_by, updated_by)
    VALUES (v_product_id, v_tenant_id, p_product->>'code', p_product->>'normalizedCode', p_product->>'kind', p_product->>'status',
      p_product->>'defaultLocale', NULLIF(p_product->>'brandId','')::uuid, NULLIF(p_product->>'taxCode',''), COALESCE(p_product->'metadata','{}'::jsonb), v_actor_id, v_actor_id)
    RETURNING catalog.products.version, catalog.products.status, catalog.products.updated_at INTO v_version, v_status, v_updated_at;
  END IF;

  DELETE FROM catalog.product_localizations WHERE tenant_id = v_tenant_id AND product_id = v_product_id;
  FOR v_localized IN SELECT value FROM jsonb_array_elements(COALESCE(p_product->'localized','[]'::jsonb)) LOOP
    INSERT INTO catalog.product_localizations(tenant_id, product_id, locale, display_name, description, search_keywords)
    VALUES (v_tenant_id, v_product_id, v_localized->>'locale', v_localized->>'name', NULLIF(v_localized->>'description',''),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_localized->'searchKeywords','[]'::jsonb))));
  END LOOP;

  DELETE FROM catalog.product_categories WHERE tenant_id = v_tenant_id AND product_id = v_product_id;
  FOR v_category IN SELECT jsonb_array_elements_text(COALESCE(p_product->'categoryIds','[]'::jsonb)) LOOP
    INSERT INTO catalog.product_categories(tenant_id, product_id, category_id) VALUES (v_tenant_id, v_product_id, v_category::uuid);
  END LOOP;

  DELETE FROM catalog.product_tags WHERE tenant_id = v_tenant_id AND product_id = v_product_id;
  FOR v_tag IN SELECT jsonb_array_elements_text(COALESCE(p_product->'tags','[]'::jsonb)) LOOP
    INSERT INTO catalog.tags(id, tenant_id, code, display_name) VALUES (gen_random_uuid(), v_tenant_id, v_tag, v_tag)
    ON CONFLICT (tenant_id, code) DO UPDATE SET display_name = EXCLUDED.display_name;
    INSERT INTO catalog.product_tags(tenant_id, product_id, tag_id)
    SELECT v_tenant_id, v_product_id, id FROM catalog.tags WHERE tenant_id = v_tenant_id AND code = v_tag;
  END LOOP;

  UPDATE catalog.variants SET status = 'inactive', updated_at = now(), version = version + 1
  WHERE tenant_id = v_tenant_id AND product_id = v_product_id
    AND id NOT IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(COALESCE(p_product->'variants','[]'::jsonb)));

  FOR v_variant IN SELECT value FROM jsonb_array_elements(COALESCE(p_product->'variants','[]'::jsonb)) LOOP
    INSERT INTO catalog.variants(id, tenant_id, product_id, sku, normalized_sku, title, combination_key, unit_code, tracking_mode, weight_minor, weight_scale, status, metadata)
    VALUES ((v_variant->>'id')::uuid, v_tenant_id, v_product_id, v_variant->>'sku', v_variant->>'normalizedSku', v_variant->>'title',
      v_variant->>'combinationKey', v_variant->>'unitCode', COALESCE(v_variant->>'trackingMode','none'), NULLIF(v_variant->>'weightMinor','')::numeric,
      NULLIF(v_variant->>'weightScale','')::integer, 'active', COALESCE(v_variant->'metadata','{}'::jsonb))
    ON CONFLICT (id) DO UPDATE SET
      sku = EXCLUDED.sku, normalized_sku = EXCLUDED.normalized_sku, title = EXCLUDED.title, combination_key = EXCLUDED.combination_key,
      unit_code = EXCLUDED.unit_code, tracking_mode = EXCLUDED.tracking_mode, weight_minor = EXCLUDED.weight_minor,
      weight_scale = EXCLUDED.weight_scale, status = 'active', metadata = EXCLUDED.metadata, updated_at = now(), version = catalog.variants.version + 1
    WHERE catalog.variants.tenant_id = v_tenant_id AND catalog.variants.product_id = v_product_id;

    DELETE FROM catalog.variant_attributes WHERE tenant_id = v_tenant_id AND variant_id = (v_variant->>'id')::uuid;
    FOR v_attribute IN SELECT value FROM jsonb_array_elements(COALESCE(v_variant->'attributeValues','[]'::jsonb)) LOOP
      INSERT INTO catalog.variant_attributes(tenant_id, variant_id, definition_id, value_code, display_label, sort_order)
      VALUES (v_tenant_id, (v_variant->>'id')::uuid, (v_attribute->>'definitionId')::uuid, v_attribute->>'code', v_attribute->>'label', COALESCE((v_attribute->>'sortOrder')::integer,0));
    END LOOP;

    DELETE FROM catalog.variant_barcodes WHERE tenant_id = v_tenant_id AND variant_id = (v_variant->>'id')::uuid;
    FOR v_barcode IN SELECT value FROM jsonb_array_elements(COALESCE(v_variant->'barcodes','[]'::jsonb)) LOOP
      INSERT INTO catalog.variant_barcodes(id, tenant_id, variant_id, value, normalized_value, symbology, is_primary, unit_code)
      VALUES (gen_random_uuid(), v_tenant_id, (v_variant->>'id')::uuid, v_barcode->>'value', v_barcode->>'normalizedValue',
        v_barcode->>'symbology', COALESCE((v_barcode->>'isPrimary')::boolean,false), NULLIF(v_barcode->>'unitCode',''));
    END LOOP;

    DELETE FROM catalog.variant_supplier_references WHERE tenant_id = v_tenant_id AND variant_id = (v_variant->>'id')::uuid;
    FOR v_reference IN SELECT value FROM jsonb_array_elements(COALESCE(v_variant->'supplierReferences','[]'::jsonb)) LOOP
      INSERT INTO catalog.variant_supplier_references(id, tenant_id, variant_id, supplier_id, supplier_sku, supplier_name, minimum_order_quantity_minor, quantity_scale, metadata)
      VALUES (gen_random_uuid(), v_tenant_id, (v_variant->>'id')::uuid, v_reference->>'supplierId', v_reference->>'supplierSku',
        NULLIF(v_reference->>'supplierName',''), NULLIF(v_reference->>'minimumOrderQuantityMinor','')::numeric,
        NULLIF(v_reference->>'quantityScale','')::integer, COALESCE(v_reference->'metadata','{}'::jsonb));
    END LOOP;
  END LOOP;

  DELETE FROM catalog.product_media WHERE tenant_id = v_tenant_id AND product_id = v_product_id;
  FOR v_media IN SELECT value FROM jsonb_array_elements(COALESCE(p_product->'media','[]'::jsonb)) LOOP
    INSERT INTO catalog.product_media(id, tenant_id, product_id, variant_id, url, alt_text, sort_order)
    VALUES ((v_media->>'id')::uuid, v_tenant_id, v_product_id, NULLIF(v_media->>'variantId','')::uuid,
      v_media->>'url', v_media->>'altText', COALESCE((v_media->>'sortOrder')::integer,0));
  END LOOP;

  PERFORM catalog.refresh_product_search_documents(v_product_id);

  INSERT INTO platform.audit_events(id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version)
  VALUES (gen_random_uuid(), v_tenant_id, 'catalog.product.saved.v1', 'catalog.product.write', 'success', v_actor_id,
    'catalog.product', v_product_id::text, p_request_id, v_trace_id,
    jsonb_build_object('version',v_version,'status',v_status,'variantCount',jsonb_array_length(COALESCE(p_product->'variants','[]'::jsonb))),
    v_business_date, 'mod-a-v1');

  INSERT INTO platform.outbox_events(id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version, payload,
    metadata, correlation_id, occurred_at, business_date)
  VALUES (gen_random_uuid(), v_tenant_id, 'catalog.product.saved.v1', 'catalog.product', v_product_id::text, '1.0',
    jsonb_build_object('productId',v_product_id,'version',v_version,'status',v_status,'updatedAt',v_updated_at),
    jsonb_build_object('requestId',p_request_id), p_request_id, v_updated_at, v_business_date);

  UPDATE platform.idempotency_records SET status='completed', response_status=200,
    response_json=jsonb_build_object('productId',v_product_id,'version',v_version,'status',v_status,'updatedAt',v_updated_at),
    resource_type='catalog.product', resource_id=v_product_id::text, updated_at=now()
  WHERE tenant_id=v_tenant_id AND scope='catalog.product.save' AND idempotency_key=p_idempotency_key;

  RETURN QUERY SELECT v_product_id, v_version, v_status, false, v_updated_at;
END $$;

CREATE OR REPLACE FUNCTION catalog.change_product_status(
  p_product_id uuid,
  p_status text,
  p_expected_version bigint,
  p_reason text,
  p_request_id text
) RETURNS TABLE(product_id uuid, version bigint, status text, replayed boolean, updated_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, platform, catalog AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_trace_id text := COALESCE(platform.current_trace_id(), p_request_id);
  v_version bigint;
  v_updated_at timestamptz;
BEGIN
  IF p_status NOT IN ('draft','active','inactive','archived') THEN RAISE EXCEPTION 'invalid catalog status' USING ERRCODE='22023'; END IF;
  UPDATE catalog.products SET status=p_status, updated_by=v_actor_id, updated_at=now(), version=version+1,
    published_at=CASE WHEN p_status='active' AND published_at IS NULL THEN now() ELSE published_at END,
    archived_at=CASE WHEN p_status='archived' THEN now() ELSE archived_at END
  WHERE tenant_id=v_tenant_id AND id=p_product_id AND version=p_expected_version AND status <> 'archived'
  RETURNING catalog.products.version, catalog.products.updated_at INTO v_version, v_updated_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog product version conflict or archived product' USING ERRCODE='40001'; END IF;
  PERFORM catalog.refresh_product_search_documents(p_product_id);
  INSERT INTO platform.audit_events(id,tenant_id,event_type,action,outcome,actor_id,target_type,target_id,reason,request_id,trace_id,metadata,business_date,source_version)
  VALUES (gen_random_uuid(),v_tenant_id,'catalog.product.status_changed.v1','catalog.product.status.change','success',v_actor_id,'catalog.product',p_product_id::text,p_reason,p_request_id,v_trace_id,jsonb_build_object('status',p_status,'version',v_version),v_business_date,'mod-a-v1');
  INSERT INTO platform.outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,schema_version,payload,metadata,correlation_id,occurred_at,business_date)
  VALUES (gen_random_uuid(),v_tenant_id,'catalog.product.status_changed.v1','catalog.product',p_product_id::text,'1.0',jsonb_build_object('productId',p_product_id,'status',p_status,'version',v_version),jsonb_build_object('requestId',p_request_id),p_request_id,v_updated_at,v_business_date);
  RETURN QUERY SELECT p_product_id,v_version,p_status,false,v_updated_at;
END $$;

CREATE OR REPLACE FUNCTION catalog.search_variant_feed(
  p_locale text,
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_cursor text DEFAULT NULL
) RETURNS TABLE(
  product_id uuid, variant_id uuid, product_code text, sku text, display_name text,
  variant_title text, status text, unit_code text, tax_code text, barcodes text[], version bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, platform, catalog AS $$
  SELECT d.product_id,d.variant_id,d.product_code,d.sku,
    COALESCE(localized.display_name,d.display_name),d.variant_title,d.status,d.unit_code,d.tax_code,d.barcodes,d.version
  FROM catalog.variant_search_documents d
  LEFT JOIN catalog.product_localizations localized ON localized.tenant_id=d.tenant_id AND localized.product_id=d.product_id AND lower(localized.locale)=lower(p_locale)
  WHERE d.tenant_id=platform.current_tenant_id()
    AND (p_cursor IS NULL OR d.sku > p_cursor)
    AND (
      p_query IS NULL OR btrim(p_query)='' OR
      d.sku=upper(btrim(p_query)) OR d.product_code=upper(btrim(p_query)) OR upper(btrim(p_query))=ANY(d.barcodes) OR
      d.search_vector @@ plainto_tsquery('simple'::regconfig,p_query) OR d.searchable_text OPERATOR(public.%) p_query
    )
  ORDER BY
    CASE WHEN p_query IS NOT NULL AND upper(btrim(p_query))=ANY(d.barcodes) THEN 0
         WHEN p_query IS NOT NULL AND d.sku=upper(btrim(p_query)) THEN 1
         WHEN p_query IS NOT NULL AND d.product_code=upper(btrim(p_query)) THEN 2 ELSE 3 END,
    d.sku
  LIMIT LEAST(GREATEST(p_limit,1),500)
$$;

CREATE OR REPLACE FUNCTION catalog.record_import(
  p_import_id text,
  p_source_hash text,
  p_accepted_rows integer,
  p_warning_count integer,
  p_request_id text
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, platform, catalog AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_business_date date := COALESCE(platform.current_business_date(),CURRENT_DATE);
  v_trace_id text := COALESCE(platform.current_trace_id(),p_request_id);
BEGIN
  INSERT INTO catalog.import_runs(id,tenant_id,source_hash,status,accepted_rows,warning_count,requested_by,request_id,completed_at)
  VALUES (p_import_id,v_tenant_id,p_source_hash,'completed',p_accepted_rows,p_warning_count,v_actor_id,p_request_id,now())
  ON CONFLICT (tenant_id,id) DO UPDATE SET status='completed',accepted_rows=EXCLUDED.accepted_rows,warning_count=EXCLUDED.warning_count,completed_at=now();
  INSERT INTO platform.audit_events(id,tenant_id,event_type,action,outcome,actor_id,target_type,target_id,request_id,trace_id,metadata,business_date,source_version)
  VALUES (gen_random_uuid(),v_tenant_id,'catalog.import.completed.v1','catalog.import.execute','success',v_actor_id,'catalog.import',p_import_id,p_request_id,v_trace_id,jsonb_build_object('acceptedRows',p_accepted_rows,'warningCount',p_warning_count,'sourceHash',p_source_hash),v_business_date,'mod-a-v1');
END $$;

INSERT INTO platform.permissions(code,module,description,risk_level) VALUES
  ('catalog.product.read','catalog','Read catalog products and variants','standard'),
  ('catalog.product.write','catalog','Create and edit catalog products and variants','sensitive'),
  ('catalog.product.publish','catalog','Activate, archive or publish catalog products','privileged'),
  ('catalog.unit.manage','catalog','Manage units and versioned conversions','privileged'),
  ('catalog.import.execute','catalog','Validate and execute catalog imports','sensitive'),
  ('catalog.export.read','catalog','Export catalog data','sensitive')
ON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description,risk_level=EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA catalog TO store_app_runtime, store_app_reporting;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA catalog TO store_app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA catalog TO store_app_reporting;
REVOKE UPDATE,DELETE ON catalog.unit_conversion_versions FROM store_app_runtime;
REVOKE DELETE ON catalog.products,catalog.variants,catalog.import_runs,catalog.import_errors FROM store_app_runtime;
REVOKE ALL ON FUNCTION catalog.save_product(text,text,jsonb,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.change_product_status(uuid,text,bigint,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.search_variant_feed(text,text,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.record_import(text,text,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.save_product(text,text,jsonb,bigint,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION catalog.change_product_status(uuid,text,bigint,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION catalog.search_variant_feed(text,text,integer,text) TO store_app_runtime,store_app_reporting;
GRANT EXECUTE ON FUNCTION catalog.record_import(text,text,integer,integer,text) TO store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA catalog GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA catalog GRANT SELECT ON TABLES TO store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id,module,checksum)
VALUES ('CAT-0001','MOD-A-CATALOG','manifest:CAT-0001-core.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
