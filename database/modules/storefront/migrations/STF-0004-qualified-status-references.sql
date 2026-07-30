BEGIN;

CREATE OR REPLACE FUNCTION storefront.transition_storefront(
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_new_status text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(storefront_id uuid, status text, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
  v_current storefront.storefronts%ROWTYPE;
  v_allowed boolean;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.transition', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'storefrontId')::uuid,
      v_replay ->> 'status',
      true;
    RETURN;
  END IF;

  SELECT sf.* INTO v_current
  FROM storefront.storefronts AS sf
  WHERE sf.tenant_id = p_tenant_id AND sf.id = p_storefront_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002';
  END IF;

  v_allowed := CASE v_current.status
    WHEN 'draft' THEN p_new_status IN ('draft','active','suspended','archived')
    WHEN 'active' THEN p_new_status IN ('active','suspended','archived')
    WHEN 'suspended' THEN p_new_status IN ('suspended','active','archived')
    WHEN 'archived' THEN p_new_status = 'archived'
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid storefront transition: % -> %', v_current.status, p_new_status
      USING ERRCODE = '22023';
  END IF;

  IF p_new_status = 'active' AND NOT EXISTS (
    SELECT 1
    FROM platform.legal_entities AS le
    WHERE le.tenant_id = p_tenant_id
      AND le.id = v_current.legal_entity_id
      AND le.status = 'active'
  ) THEN
    RAISE EXCEPTION 'storefront legal entity is not active' USING ERRCODE = '42501';
  END IF;

  UPDATE storefront.storefronts AS sf
  SET status = p_new_status,
      activated_at = CASE
        WHEN p_new_status = 'active' THEN COALESCE(sf.activated_at, now())
        ELSE sf.activated_at
      END,
      suspended_at = CASE
        WHEN p_new_status = 'suspended' THEN now()
        WHEN p_new_status = 'active' THEN NULL
        ELSE sf.suspended_at
      END,
      updated_by = p_actor_id,
      updated_at = now(),
      version = sf.version + 1
  WHERE sf.tenant_id = p_tenant_id AND sf.id = p_storefront_id;

  IF p_new_status IN ('suspended','archived') THEN
    UPDATE storefront.sales_channels AS sc
    SET status = 'suspended',
        updated_by = p_actor_id,
        updated_at = now(),
        version = sc.version + 1
    WHERE sc.tenant_id = p_tenant_id
      AND sc.storefront_id = p_storefront_id
      AND sc.status = 'active';
  END IF;

  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.transition', p_idempotency_key,
    p_request_hash,
    jsonb_build_object('storefrontId', p_storefront_id, 'status', p_new_status),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT p_storefront_id, p_new_status, false;
END $$;

CREATE OR REPLACE FUNCTION storefront.register_domain(
  p_domain_id uuid,
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_storefront_id uuid,
  p_hostname text,
  p_domain_kind text,
  p_verification_method text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(domain_id uuid, status text, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storefront, platform AS $$
DECLARE
  v_replay jsonb;
BEGIN
  PERFORM storefront.assert_tenant_context(p_tenant_id);
  v_replay := storefront.command_replay(
    p_tenant_id, 'storefront.domain.register', p_idempotency_key, p_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'domainId')::uuid,
      v_replay ->> 'status',
      true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(lower(p_hostname), 0));
  IF NOT EXISTS (
    SELECT 1
    FROM storefront.storefronts AS sf
    WHERE sf.tenant_id = p_tenant_id
      AND sf.id = p_storefront_id
      AND sf.status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO storefront.domains(
    id, tenant_id, storefront_id, hostname, domain_kind, status,
    verification_method, created_by, updated_by
  ) VALUES (
    p_domain_id, p_tenant_id, p_storefront_id, lower(p_hostname), p_domain_kind,
    CASE
      WHEN p_domain_kind = 'platform_subdomain' THEN 'certificate_pending'
      ELSE 'verification_pending'
    END,
    p_verification_method, p_actor_id, p_actor_id
  );

  PERFORM storefront.store_command_receipt(
    p_receipt_id, p_tenant_id, 'storefront.domain.register', p_idempotency_key,
    p_request_hash,
    jsonb_build_object(
      'domainId', p_domain_id,
      'status', CASE
        WHEN p_domain_kind = 'platform_subdomain' THEN 'certificate_pending'
        ELSE 'verification_pending'
      END
    ),
    p_actor_id, p_request_id, p_trace_id, p_business_date
  );
  RETURN QUERY SELECT
    p_domain_id,
    CASE
      WHEN p_domain_kind = 'platform_subdomain' THEN 'certificate_pending'
      ELSE 'verification_pending'
    END,
    false;
END $$;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES (
  'STF-0004',
  'MOD-H-STOREFRONT',
  'manifest:STF-0004-qualified-status-references.sql'
)
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
