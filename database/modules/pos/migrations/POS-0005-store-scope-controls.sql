BEGIN;

CREATE OR REPLACE FUNCTION pos.validate_device_store_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE register_store_id uuid;
BEGIN
  IF NEW.register_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT store_id INTO register_store_id
  FROM platform.registers
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.register_id;
  IF NOT FOUND OR register_store_id IS DISTINCT FROM NEW.store_id THEN
    RAISE EXCEPTION 'POS device register must belong to the same store' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pos_device_store_scope
  BEFORE INSERT OR UPDATE OF store_id, register_id ON pos.devices
  FOR EACH ROW EXECUTE FUNCTION pos.validate_device_store_scope();

CREATE OR REPLACE FUNCTION pos.validate_session_store_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  device_store_id uuid;
  device_register_id uuid;
BEGIN
  SELECT store_id, register_id
    INTO device_store_id, device_register_id
  FROM pos.devices
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.device_id;
  IF NOT FOUND
     OR device_store_id IS DISTINCT FROM NEW.store_id
     OR device_register_id IS DISTINCT FROM NEW.register_id THEN
    RAISE EXCEPTION 'POS session device, register and store scope must match' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pos_session_store_scope
  BEFORE INSERT OR UPDATE OF store_id, register_id, device_id ON pos.register_sessions
  FOR EACH ROW EXECUTE FUNCTION pos.validate_session_store_scope();

CREATE OR REPLACE FUNCTION pos.validate_checkout_store_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  session_store_id uuid;
  session_register_id uuid;
  session_device_id uuid;
BEGIN
  SELECT store_id, register_id, device_id
    INTO session_store_id, session_register_id, session_device_id
  FROM pos.register_sessions
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.session_id;
  IF NOT FOUND
     OR session_store_id IS DISTINCT FROM NEW.store_id
     OR session_register_id IS DISTINCT FROM NEW.register_id
     OR session_device_id IS DISTINCT FROM NEW.device_id THEN
    RAISE EXCEPTION 'POS checkout session, device, register and store scope must match' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pos_checkout_store_scope
  BEFORE INSERT OR UPDATE OF store_id, register_id, device_id, session_id ON pos.checkout_operations
  FOR EACH ROW EXECUTE FUNCTION pos.validate_checkout_store_scope();

CREATE OR REPLACE FUNCTION pos.validate_offline_authorization_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  device_store_id uuid;
  device_register_id uuid;
  store_legal_entity_id uuid;
BEGIN
  SELECT store_id, register_id
    INTO device_store_id, device_register_id
  FROM pos.devices
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.device_id;

  SELECT legal_entity_id
    INTO store_legal_entity_id
  FROM platform.stores
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.store_id;

  IF device_store_id IS DISTINCT FROM NEW.store_id
     OR device_register_id IS DISTINCT FROM NEW.register_id
     OR store_legal_entity_id IS DISTINCT FROM NEW.legal_entity_id THEN
    RAISE EXCEPTION 'offline authorization legal entity, store, register and device scope must match' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pos_offline_authorization_store_scope
  BEFORE INSERT OR UPDATE OF legal_entity_id, store_id, register_id, device_id
  ON pos.offline_authorizations
  FOR EACH ROW EXECUTE FUNCTION pos.validate_offline_authorization_scope();

DO $scope_validation$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pos.devices AS device
    JOIN platform.registers AS register
      ON register.tenant_id = device.tenant_id
     AND register.id = device.register_id
    WHERE device.register_id IS NOT NULL
      AND register.store_id IS DISTINCT FROM device.store_id
  ) THEN
    RAISE EXCEPTION 'existing POS device store scope is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pos.register_sessions AS session
    JOIN pos.devices AS device
      ON device.tenant_id = session.tenant_id
     AND device.id = session.device_id
    WHERE device.store_id IS DISTINCT FROM session.store_id
       OR device.register_id IS DISTINCT FROM session.register_id
  ) THEN
    RAISE EXCEPTION 'existing POS session store scope is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pos.checkout_operations AS checkout
    JOIN pos.register_sessions AS session
      ON session.tenant_id = checkout.tenant_id
     AND session.id = checkout.session_id
    WHERE session.store_id IS DISTINCT FROM checkout.store_id
       OR session.register_id IS DISTINCT FROM checkout.register_id
       OR session.device_id IS DISTINCT FROM checkout.device_id
  ) THEN
    RAISE EXCEPTION 'existing POS checkout store scope is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pos.offline_authorizations AS authorization
    JOIN pos.devices AS device
      ON device.tenant_id = authorization.tenant_id
     AND device.id = authorization.device_id
    JOIN platform.stores AS store
      ON store.tenant_id = authorization.tenant_id
     AND store.id = authorization.store_id
    WHERE device.store_id IS DISTINCT FROM authorization.store_id
       OR device.register_id IS DISTINCT FROM authorization.register_id
       OR store.legal_entity_id IS DISTINCT FROM authorization.legal_entity_id
  ) THEN
    RAISE EXCEPTION 'existing offline authorization store scope is invalid';
  END IF;
END $scope_validation$;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0005','MOD-D-POS','manifest:POS-0005-store-scope-controls.sql');

COMMIT;
