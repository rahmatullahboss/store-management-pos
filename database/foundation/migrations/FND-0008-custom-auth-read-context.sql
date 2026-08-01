BEGIN;

CREATE OR REPLACE FUNCTION platform.custom_auth_ensure_read_role(
  p_membership_id uuid
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_membership platform.memberships%ROWTYPE;
  v_identity_subject text;
  v_role_id uuid;
  v_legal_entity_id uuid;
  v_store_id uuid;
  v_warehouse_id uuid;
  v_register_id uuid;
  v_permissions constant text[] := ARRAY[
    'catalog.feed.read',
    'catalog.product.read',
    'customer.profile.read',
    'fulfillment.read',
    'inventory.replenishment.read',
    'inventory.stock.read',
    'inventory.warehouse.read',
    'platform.device.read',
    'platform.reference.read',
    'pricing.price.read',
    'pricing.price_tax.calculate',
    'procurement.purchase_order.read',
    'procurement.requisition.read',
    'procurement.supplier.read',
    'sales.order.read',
    'tax.calculation.read'
  ];
BEGIN
  SELECT m.* INTO v_membership
  FROM platform.memberships AS m
  WHERE m.id = p_membership_id
    AND m.status = 'active'
  FOR UPDATE;

  IF v_membership.id IS NULL THEN RETURN; END IF;

  SELECT u.identity_subject INTO v_identity_subject
  FROM platform.users AS u
  WHERE u.id = v_membership.user_id
    AND u.status = 'active';

  IF v_identity_subject IS NULL OR v_identity_subject NOT LIKE 'custom-auth:%' THEN
    RETURN;
  END IF;

  INSERT INTO platform.roles(
    id, tenant_id, code, display_name, system_role
  ) VALUES (
    gen_random_uuid(),
    v_membership.tenant_id,
    'staging-read-only',
    'Staging read-only operator',
    false
  )
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT r.id INTO v_role_id
  FROM platform.roles AS r
  WHERE r.tenant_id = v_membership.tenant_id
    AND r.code = 'staging-read-only';

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'staging read-only role is unavailable' USING ERRCODE = '55000';
  END IF;

  INSERT INTO platform.role_permissions(role_id, permission_code)
  SELECT v_role_id, p.code
  FROM platform.permissions AS p
  WHERE p.code = ANY(v_permissions)
    AND p.risk_level = 'standard'
  ON CONFLICT (role_id, permission_code) DO NOTHING;

  SELECT le.id INTO v_legal_entity_id
  FROM platform.legal_entities AS le
  WHERE le.tenant_id = v_membership.tenant_id
    AND le.status = 'active'
  ORDER BY le.code
  LIMIT 1;

  SELECT s.id INTO v_store_id
  FROM platform.stores AS s
  WHERE s.tenant_id = v_membership.tenant_id
    AND s.status = 'active'
    AND (v_legal_entity_id IS NULL OR s.legal_entity_id = v_legal_entity_id)
  ORDER BY s.code
  LIMIT 1;

  SELECT w.id INTO v_warehouse_id
  FROM platform.warehouses AS w
  WHERE w.tenant_id = v_membership.tenant_id
    AND w.status = 'active'
    AND (v_legal_entity_id IS NULL OR w.legal_entity_id = v_legal_entity_id)
    AND (v_store_id IS NULL OR w.store_id = v_store_id)
  ORDER BY w.code
  LIMIT 1;

  SELECT r.id INTO v_register_id
  FROM platform.registers AS r
  WHERE r.tenant_id = v_membership.tenant_id
    AND r.status = 'active'
    AND (v_store_id IS NULL OR r.store_id = v_store_id)
  ORDER BY r.code
  LIMIT 1;

  INSERT INTO platform.membership_roles(
    id,
    tenant_id,
    membership_id,
    role_id,
    legal_entity_id,
    store_id,
    warehouse_id,
    register_id,
    granted_by
  ) VALUES (
    gen_random_uuid(),
    v_membership.tenant_id,
    v_membership.id,
    v_role_id,
    v_legal_entity_id,
    v_store_id,
    v_warehouse_id,
    v_register_id,
    NULL
  )
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION platform.custom_auth_membership_role_trigger()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
BEGIN
  PERFORM platform.custom_auth_ensure_read_role(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS custom_auth_membership_role_after_insert
  ON platform.memberships;
CREATE TRIGGER custom_auth_membership_role_after_insert
AFTER INSERT ON platform.memberships
FOR EACH ROW
EXECUTE FUNCTION platform.custom_auth_membership_role_trigger();

DO $$
DECLARE
  v_membership_id uuid;
BEGIN
  FOR v_membership_id IN
    SELECT m.id
    FROM platform.memberships AS m
    JOIN platform.users AS u ON u.id = m.user_id
    WHERE m.status = 'active'
      AND u.status = 'active'
      AND u.identity_subject LIKE 'custom-auth:%'
  LOOP
    PERFORM platform.custom_auth_ensure_read_role(v_membership_id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION platform.custom_auth_resolve_context(
  p_token_hash text
) RETURNS TABLE (
  session_id uuid,
  expires_at timestamptz,
  user_id uuid,
  display_name text,
  email_normalized text,
  tenant_id uuid,
  tenant_name text,
  membership_id uuid,
  role_code text,
  legal_entity_id uuid,
  store_id uuid,
  warehouse_id uuid,
  register_id uuid,
  permissions text[]
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
  SELECT
    s.id,
    s.expires_at,
    u.id,
    u.display_name,
    u.email_normalized,
    t.id,
    t.display_name,
    m.id,
    r.code,
    mr.legal_entity_id,
    mr.store_id,
    mr.warehouse_id,
    mr.register_id,
    array_agg(DISTINCT rp.permission_code ORDER BY rp.permission_code)
  FROM platform.auth_sessions AS s
  JOIN platform.users AS u
    ON u.id = s.user_id
   AND u.status = 'active'
  JOIN platform.tenants AS t
    ON t.id = s.tenant_id
   AND t.status = 'active'
  JOIN platform.memberships AS m
    ON m.user_id = u.id
   AND m.tenant_id = t.id
   AND m.status = 'active'
  JOIN platform.membership_roles AS mr
    ON mr.membership_id = m.id
   AND mr.tenant_id = t.id
  JOIN platform.roles AS r
    ON r.id = mr.role_id
   AND r.tenant_id = t.id
   AND r.code = 'staging-read-only'
  JOIN platform.role_permissions AS rp
    ON rp.role_id = r.id
  JOIN platform.permissions AS p
    ON p.code = rp.permission_code
   AND p.risk_level = 'standard'
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  GROUP BY
    s.id,
    s.expires_at,
    u.id,
    u.display_name,
    u.email_normalized,
    t.id,
    t.display_name,
    m.id,
    r.code,
    mr.legal_entity_id,
    mr.store_id,
    mr.warehouse_id,
    mr.register_id;
$$;

REVOKE ALL ON FUNCTION platform.custom_auth_ensure_read_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_membership_role_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_resolve_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.custom_auth_ensure_read_role(uuid) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.custom_auth_resolve_context(text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FND-0008','FOUNDATION','manifest:FND-0008-custom-auth-read-context.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
