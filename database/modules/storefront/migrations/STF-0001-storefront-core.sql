BEGIN;

CREATE SCHEMA IF NOT EXISTS storefront;
COMMENT ON SCHEMA storefront IS 'MOD-H storefront channels, publication, content, domains and cache generations';

INSERT INTO platform.module_ownership(
  module_id, postgres_schema, git_path, migration_prefix, owner_workpack, dependency_modules
) VALUES (
  'MOD-H-STOREFRONT',
  'storefront',
  'modules/storefront',
  'STF',
  'MOD-H',
  ARRAY['MOD-A-CATALOG','MOD-A-PRICING','MOD-B-INVENTORY','MOD-C-CUSTOMER','MOD-C-SALES','MOD-E-PAYMENT','MOD-F-LOCALIZATION','MOD-G-INTEGRATION']
)
ON CONFLICT (module_id) DO UPDATE SET
  postgres_schema = EXCLUDED.postgres_schema,
  git_path = EXCLUDED.git_path,
  migration_prefix = EXCLUDED.migration_prefix,
  owner_workpack = EXCLUDED.owner_workpack,
  dependency_modules = EXCLUDED.dependency_modules;

CREATE TABLE IF NOT EXISTS storefront.storefronts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  primary_store_id uuid NULL,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9-]{1,62}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','suspended','archived')),
  default_locale text NOT NULL CHECK (char_length(default_locale) BETWEEN 2 AND 35),
  default_currency char(3) NOT NULL CHECK (default_currency = upper(default_currency)),
  time_zone text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 80),
  platform_subdomain text NULL CHECK (platform_subdomain IS NULL OR platform_subdomain ~ '^[a-z][a-z0-9-]{1,62}$'),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NULL,
  suspended_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, primary_store_id) REFERENCES platform.stores(tenant_id, id),
  CHECK ((status = 'active' AND activated_at IS NOT NULL) OR status <> 'active'),
  CHECK ((status = 'suspended' AND suspended_at IS NOT NULL) OR status <> 'suspended')
);
CREATE UNIQUE INDEX IF NOT EXISTS storefront_platform_subdomain_unique
  ON storefront.storefronts(lower(platform_subdomain))
  WHERE platform_subdomain IS NOT NULL AND status <> 'archived';
CREATE INDEX IF NOT EXISTS storefront_scope_status_idx
  ON storefront.storefronts(tenant_id, legal_entity_id, status, id);

CREATE TABLE IF NOT EXISTS storefront.sales_channels (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  storefront_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9-]{1,62}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','suspended','archived')),
  price_list_id uuid NOT NULL,
  inventory_scope jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(inventory_scope) = 'object'),
  allowed_country_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  guest_checkout_enabled boolean NOT NULL DEFAULT true,
  customer_accounts_enabled boolean NOT NULL DEFAULT true,
  backorder_policy text NOT NULL DEFAULT 'deny' CHECK (backorder_policy IN ('deny','allow','preorder_only')),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, storefront_id, code),
  FOREIGN KEY (tenant_id, storefront_id) REFERENCES storefront.storefronts(tenant_id, id),
  CHECK (allowed_country_codes <@ ARRAY[
    'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
    'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
    'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
    'DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR',
    'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
    'HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT',
    'JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
    'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
    'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA',
    'RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
    'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'
  ]::text[]),
  CHECK ((status = 'active' AND activated_at IS NOT NULL) OR status <> 'active')
);
CREATE INDEX IF NOT EXISTS storefront_sales_channel_lookup_idx
  ON storefront.sales_channels(tenant_id, storefront_id, status, id);

CREATE TABLE IF NOT EXISTS storefront.domains (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  storefront_id uuid NOT NULL,
  hostname text NOT NULL CHECK (
    hostname = lower(hostname)
    AND char_length(hostname) BETWEEN 4 AND 253
    AND hostname !~ '[:/@]'
    AND hostname ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$'
  ),
  domain_kind text NOT NULL CHECK (domain_kind IN ('platform_subdomain','custom')),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','verification_pending','certificate_pending','active','suspended','failed','deleting','deleted')
  ),
  is_canonical boolean NOT NULL DEFAULT false,
  verification_method text NULL CHECK (verification_method IS NULL OR verification_method IN ('dns_txt','dns_cname','http')),
  provider_hostname_id text NULL CHECK (provider_hostname_id IS NULL OR char_length(provider_hostname_id) BETWEEN 1 AND 240),
  certificate_status text NOT NULL DEFAULT 'none' CHECK (
    certificate_status IN ('none','pending','active','expiring','failed','revoked')
  ),
  failure_code text NULL CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 120),
  failure_detail text NULL CHECK (failure_detail IS NULL OR char_length(failure_detail) <= 1000),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NULL,
  activated_at timestamptz NULL,
  suspended_at timestamptz NULL,
  deleted_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, storefront_id) REFERENCES storefront.storefronts(tenant_id, id),
  CHECK ((status = 'active' AND verified_at IS NOT NULL AND activated_at IS NOT NULL AND certificate_status = 'active') OR status <> 'active'),
  CHECK ((status = 'deleted' AND deleted_at IS NOT NULL) OR status <> 'deleted')
);
CREATE UNIQUE INDEX IF NOT EXISTS storefront_domain_hostname_unique
  ON storefront.domains(lower(hostname))
  WHERE status <> 'deleted';
CREATE UNIQUE INDEX IF NOT EXISTS storefront_one_canonical_domain_idx
  ON storefront.domains(tenant_id, storefront_id)
  WHERE is_canonical AND status = 'active';
CREATE INDEX IF NOT EXISTS storefront_domain_resolution_idx
  ON storefront.domains(lower(hostname), status, tenant_id, storefront_id);

CREATE TABLE IF NOT EXISTS storefront.domain_verifications (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  domain_id uuid NOT NULL,
  verification_attempt integer NOT NULL CHECK (verification_attempt > 0),
  challenge_type text NOT NULL CHECK (challenge_type IN ('dns_txt','dns_cname','http')),
  challenge_name text NOT NULL CHECK (char_length(challenge_name) BETWEEN 1 AND 320),
  challenge_value_hash text NOT NULL CHECK (challenge_value_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('pending','verified','failed','expired')),
  provider_reference text NULL CHECK (provider_reference IS NULL OR char_length(provider_reference) <= 240),
  observed_detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(observed_detail) = 'object'),
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  trace_id text NOT NULL CHECK (char_length(trace_id) BETWEEN 1 AND 200),
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, domain_id, verification_attempt),
  FOREIGN KEY (tenant_id, domain_id) REFERENCES storefront.domains(tenant_id, id),
  CHECK (expires_at > observed_at)
);
CREATE INDEX IF NOT EXISTS storefront_domain_verification_latest_idx
  ON storefront.domain_verifications(tenant_id, domain_id, verification_attempt DESC);

CREATE TABLE IF NOT EXISTS storefront.product_publications (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  storefront_id uuid NOT NULL,
  sales_channel_id uuid NOT NULL,
  product_id uuid NOT NULL,
  publication_state text NOT NULL DEFAULT 'draft' CHECK (
    publication_state IN ('draft','scheduled','published','hidden','archived')
  ),
  public_slug text NOT NULL CHECK (
    char_length(public_slug) BETWEEN 1 AND 180
    AND public_slug !~ '[[:space:]/\\?#]'
    AND public_slug !~ '^\.'
  ),
  scheduled_for timestamptz NULL,
  published_at timestamptz NULL,
  hidden_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, sales_channel_id, product_id),
  UNIQUE (tenant_id, sales_channel_id, public_slug),
  FOREIGN KEY (tenant_id, storefront_id) REFERENCES storefront.storefronts(tenant_id, id),
  FOREIGN KEY (tenant_id, sales_channel_id) REFERENCES storefront.sales_channels(tenant_id, id),
  CHECK ((publication_state = 'scheduled' AND scheduled_for IS NOT NULL) OR publication_state <> 'scheduled'),
  CHECK ((publication_state = 'published' AND published_at IS NOT NULL) OR publication_state <> 'published'),
  CHECK ((publication_state = 'hidden' AND hidden_at IS NOT NULL) OR publication_state <> 'hidden')
);
CREATE INDEX IF NOT EXISTS storefront_product_publication_feed_idx
  ON storefront.product_publications(tenant_id, sales_channel_id, publication_state, updated_at DESC, product_id);

CREATE TABLE IF NOT EXISTS storefront.variant_publications (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  storefront_id uuid NOT NULL,
  sales_channel_id uuid NOT NULL,
  product_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  publication_state text NOT NULL DEFAULT 'published' CHECK (publication_state IN ('published','hidden','archived')),
  public_slug_suffix text NULL CHECK (
    public_slug_suffix IS NULL OR (
      char_length(public_slug_suffix) BETWEEN 1 AND 120
      AND public_slug_suffix !~ '[[:space:]/\\?#]'
      AND public_slug_suffix !~ '^\.'
    )
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, sales_channel_id, variant_id),
  FOREIGN KEY (tenant_id, storefront_id) REFERENCES storefront.storefronts(tenant_id, id),
  FOREIGN KEY (tenant_id, sales_channel_id, product_id)
    REFERENCES storefront.product_publications(tenant_id, sales_channel_id, product_id)
);
CREATE INDEX IF NOT EXISTS storefront_variant_publication_feed_idx
  ON storefront.variant_publications(tenant_id, sales_channel_id, publication_state, product_id, variant_id);

CREATE TABLE IF NOT EXISTS storefront.category_publications (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  storefront_id uuid NOT NULL,
  sales_channel_id uuid NOT NULL,
  category_id uuid NOT NULL,
  parent_category_id uuid NULL,
  publication_state text NOT NULL DEFAULT 'draft' CHECK (
    publication_state IN ('draft','scheduled','published','hidden','archived')
  ),
  public_slug text NOT NULL CHECK (
    char_length(public_slug) BETWEEN 1 AND 180
    AND public_slug !~ '[[:space:]/\\?#]'
    AND public_slug !~ '^\.'
  ),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN -1000000 AND 1000000),
  scheduled_for timestamptz NULL,
  published_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, sales_channel_id, category_id),
  UNIQUE (tenant_id, sales_channel_id, public_slug),
  FOREIGN KEY (tenant_id, storefront_id) REFERENCES storefront.storefronts(tenant_id, id),
  FOREIGN KEY (tenant_id, sales_channel_id) REFERENCES storefront.sales_channels(tenant_id, id),
  CHECK (parent_category_id IS NULL OR parent_category_id <> category_id),
  CHECK ((publication_state = 'scheduled' AND scheduled_for IS NOT NULL) OR publication_state <> 'scheduled'),
  CHECK ((publication_state = 'published' AND published_at IS NOT NULL) OR publication_state <> 'published')
);
CREATE INDEX IF NOT EXISTS storefront_category_publication_tree_idx
  ON storefront.category_publications(tenant_id, sales_channel_id, parent_category_id, sort_order, category_id);

CREATE TABLE IF NOT EXISTS storefront.collections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  storefront_id uuid NOT NULL,
  sales_channel_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9-]{1,62}$'),
  public_slug text NOT NULL CHECK (
    char_length(public_slug) BETWEEN 1 AND 180
    AND public_slug !~ '[[:space:]/\\?#]'
    AND public_slug !~ '^\.'
  ),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text NULL CHECK (description IS NULL OR char_length(description) <= 4000),
  publication_state text NOT NULL DEFAULT 'draft' CHECK (
    publication_state IN ('draft','scheduled','published','hidden','archived')
  ),
  scheduled_for timestamptz NULL,
  published_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, sales_channel_id, code),
  UNIQUE (tenant_id, sales_channel_id, public_slug),
  FOREIGN KEY (tenant_id, storefront_id) REFERENCES storefront.storefronts(tenant_id, id),
  FOREIGN KEY (tenant_id, sales_channel_id) REFERENCES storefront.sales_channels(tenant_id, id),
  CHECK ((publication_state = 'scheduled' AND scheduled_for IS NOT NULL) OR publication_state <> 'scheduled'),
  CHECK ((publication_state = 'published' AND published_at IS NOT NULL) OR publication_state <> 'published')
);
CREATE INDEX IF NOT EXISTS storefront_collection_feed_idx
  ON storefront.collections(tenant_id, sales_channel_id, publication_state, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS storefront.collection_members (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  collection_id uuid NOT NULL,
  product_id uuid NOT NULL,
  variant_id uuid NULL,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN -1000000 AND 1000000),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE NULLS NOT DISTINCT (tenant_id, collection_id, product_id, variant_id),
  FOREIGN KEY (tenant_id, collection_id) REFERENCES storefront.collections(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS storefront_collection_members_order_idx
  ON storefront.collection_members(tenant_id, collection_id, sort_order, product_id, variant_id);

CREATE TABLE IF NOT EXISTS storefront.theme_revisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  storefront_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  theme_document jsonb NOT NULL CHECK (jsonb_typeof(theme_document) = 'object'),
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid NULL REFERENCES platform.users(id),
  published_at timestamptz NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  trace_id text NOT NULL CHECK (char_length(trace_id) BETWEEN 1 AND 200),
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, storefront_id, revision),
  FOREIGN KEY (tenant_id, storefront_id) REFERENCES storefront.storefronts(tenant_id, id),
  CHECK ((status = 'published' AND published_by IS NOT NULL AND published_at IS NOT NULL) OR status <> 'published')
);
CREATE UNIQUE INDEX IF NOT EXISTS storefront_one_published_theme_idx
  ON storefront.theme_revisions(tenant_id, storefront_id)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS storefront.navigation_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  storefront_id uuid NOT NULL,
  placement text NOT NULL CHECK (placement IN ('header','footer','utility')),
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  navigation_document jsonb NOT NULL CHECK (jsonb_typeof(navigation_document) = 'object'),
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid NULL REFERENCES platform.users(id),
  published_at timestamptz NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  trace_id text NOT NULL CHECK (char_length(trace_id) BETWEEN 1 AND 200),
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, storefront_id, placement, revision),
  FOREIGN KEY (tenant_id, storefront_id) REFERENCES storefront.storefronts(tenant_id, id),
  CHECK ((status = 'published' AND published_by IS NOT NULL AND published_at IS NOT NULL) OR status <> 'published')
);
CREATE UNIQUE INDEX IF NOT EXISTS storefront_one_published_navigation_idx
  ON storefront.navigation_documents(tenant_id, storefront_id, placement)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS storefront.content_pages (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  storefront_id uuid NOT NULL,
  public_slug text NOT NULL CHECK (
    char_length(public_slug) BETWEEN 1 AND 180
    AND public_slug !~ '[[:space:]/\\?#]'
    AND public_slug !~ '^\.'
  ),
  revision bigint NOT NULL CHECK (revision > 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','hidden','archived')),
  content_document jsonb NOT NULL CHECK (jsonb_typeof(content_document) = 'object'),
  seo_document jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(seo_document) = 'object'),
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  scheduled_for timestamptz NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid NULL REFERENCES platform.users(id),
  published_at timestamptz NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  trace_id text NOT NULL CHECK (char_length(trace_id) BETWEEN 1 AND 200),
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, storefront_id, public_slug, revision),
  FOREIGN KEY (tenant_id, storefront_id) REFERENCES storefront.storefronts(tenant_id, id),
  CHECK ((status = 'scheduled' AND scheduled_for IS NOT NULL) OR status <> 'scheduled'),
  CHECK ((status = 'published' AND published_by IS NOT NULL AND published_at IS NOT NULL) OR status <> 'published')
);
CREATE UNIQUE INDEX IF NOT EXISTS storefront_one_published_content_page_idx
  ON storefront.content_pages(tenant_id, storefront_id, public_slug)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS storefront.homepage_revisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  storefront_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','archived')),
  homepage_document jsonb NOT NULL CHECK (jsonb_typeof(homepage_document) = 'object'),
  seo_document jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(seo_document) = 'object'),
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  scheduled_for timestamptz NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid NULL REFERENCES platform.users(id),
  published_at timestamptz NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  trace_id text NOT NULL CHECK (char_length(trace_id) BETWEEN 1 AND 200),
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, storefront_id, revision),
  FOREIGN KEY (tenant_id, storefront_id) REFERENCES storefront.storefronts(tenant_id, id),
  CHECK ((status = 'scheduled' AND scheduled_for IS NOT NULL) OR status <> 'scheduled'),
  CHECK ((status = 'published' AND published_by IS NOT NULL AND published_at IS NOT NULL) OR status <> 'published')
);
CREATE UNIQUE INDEX IF NOT EXISTS storefront_one_published_homepage_idx
  ON storefront.homepage_revisions(tenant_id, storefront_id)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS storefront.cache_generations (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  storefront_id uuid NOT NULL,
  sales_channel_id uuid NOT NULL,
  locale text NOT NULL CHECK (char_length(locale) BETWEEN 2 AND 35),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  generation_reason text NOT NULL CHECK (char_length(generation_reason) BETWEEN 1 AND 160),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  trace_id text NOT NULL CHECK (char_length(trace_id) BETWEEN 1 AND 200),
  business_date date NOT NULL,
  PRIMARY KEY (tenant_id, storefront_id, sales_channel_id, locale, currency),
  FOREIGN KEY (tenant_id, storefront_id) REFERENCES storefront.storefronts(tenant_id, id),
  FOREIGN KEY (tenant_id, sales_channel_id) REFERENCES storefront.sales_channels(tenant_id, id)
);

CREATE OR REPLACE FUNCTION storefront.reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;

CREATE TRIGGER storefront_domain_verifications_append_only
  BEFORE UPDATE OR DELETE ON storefront.domain_verifications
  FOR EACH ROW EXECUTE FUNCTION storefront.reject_append_only_mutation();
CREATE TRIGGER storefront_theme_revisions_append_only
  BEFORE UPDATE OR DELETE ON storefront.theme_revisions
  FOR EACH ROW EXECUTE FUNCTION storefront.reject_append_only_mutation();
CREATE TRIGGER storefront_navigation_documents_append_only
  BEFORE UPDATE OR DELETE ON storefront.navigation_documents
  FOR EACH ROW EXECUTE FUNCTION storefront.reject_append_only_mutation();
CREATE TRIGGER storefront_content_pages_append_only
  BEFORE UPDATE OR DELETE ON storefront.content_pages
  FOR EACH ROW EXECUTE FUNCTION storefront.reject_append_only_mutation();
CREATE TRIGGER storefront_homepage_revisions_append_only
  BEFORE UPDATE OR DELETE ON storefront.homepage_revisions
  FOR EACH ROW EXECUTE FUNCTION storefront.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'storefronts','sales_channels','domains','domain_verifications',
    'product_publications','variant_publications','category_publications',
    'collections','collection_members','theme_revisions','navigation_documents',
    'content_pages','homepage_revisions','cache_generations'
  ] LOOP
    EXECUTE format('ALTER TABLE storefront.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE storefront.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON storefront.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON storefront.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name
    );
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('storefront.storefront.create','storefront','Create storefront identities and initial settings','sensitive'),
  ('storefront.storefront.read','storefront','Read storefront, channel, domain and publication configuration','standard'),
  ('storefront.storefront.update','storefront','Update storefront settings and lifecycle','sensitive'),
  ('storefront.channel.manage','storefront','Manage storefront sales channels and commercial capability references','sensitive'),
  ('storefront.publication.manage','storefront','Publish and hide products, variants, categories and collections','sensitive'),
  ('storefront.content.manage','storefront','Create and publish storefront theme, navigation and content revisions','sensitive'),
  ('storefront.domain.manage','storefront','Create, verify, activate, suspend and remove storefront domains','privileged'),
  ('storefront.cache.invalidate','storefront','Advance tenant-scoped storefront cache generations','sensitive')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  description = EXCLUDED.description,
  risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA storefront TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA storefront TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA storefront FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA storefront GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;
ALTER DEFAULT PRIVILEGES IN SCHEMA storefront REVOKE INSERT, UPDATE, DELETE ON TABLES FROM store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('STF-0001','MOD-H-STOREFRONT','manifest:STF-0001-storefront-core.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
