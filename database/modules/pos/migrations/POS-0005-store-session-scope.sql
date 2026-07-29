BEGIN;

ALTER TABLE pos.devices
  ADD CONSTRAINT pos_devices_store_register_scope_unique
  UNIQUE (tenant_id, id, store_id, register_id);

ALTER TABLE pos.register_sessions
  ADD CONSTRAINT register_sessions_store_register_unique
    UNIQUE (tenant_id, id, store_id, register_id),
  ADD CONSTRAINT register_sessions_device_store_register_fk
    FOREIGN KEY (tenant_id, device_id, store_id, register_id)
    REFERENCES pos.devices(tenant_id, id, store_id, register_id);

ALTER TABLE pos.checkout_operations
  ADD CONSTRAINT checkout_operations_session_store_scope_fk
    FOREIGN KEY (tenant_id, session_id, store_id, register_id)
    REFERENCES pos.register_sessions(tenant_id, id, store_id, register_id);

ALTER TABLE pos.offline_authorizations
  ADD CONSTRAINT offline_authorizations_device_store_register_fk
    FOREIGN KEY (tenant_id, device_id, store_id, register_id)
    REFERENCES pos.devices(tenant_id, id, store_id, register_id),
  ADD CONSTRAINT offline_authorizations_full_scope_unique
    UNIQUE (tenant_id, id, device_id, store_id, register_id);

ALTER TABLE pos.offline_operations
  ADD COLUMN store_id uuid NOT NULL,
  ADD CONSTRAINT offline_operations_store_fk
    FOREIGN KEY (tenant_id, store_id)
    REFERENCES platform.stores(tenant_id, id),
  ADD CONSTRAINT offline_operations_authorization_full_scope_fk
    FOREIGN KEY (tenant_id, authorization_id, device_id, store_id, register_id)
    REFERENCES pos.offline_authorizations(tenant_id, id, device_id, store_id, register_id);

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0005','MOD-D-POS','manifest:POS-0005-store-session-scope.sql');

COMMIT;
