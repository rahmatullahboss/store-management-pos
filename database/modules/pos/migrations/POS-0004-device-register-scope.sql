BEGIN;

ALTER TABLE pos.devices
  ADD CONSTRAINT pos_devices_register_scope_unique
  UNIQUE (tenant_id, id, register_id);

ALTER TABLE pos.register_sessions
  ADD CONSTRAINT register_sessions_device_register_unique
    UNIQUE (tenant_id, id, device_id, register_id),
  ADD CONSTRAINT register_sessions_device_register_fk
    FOREIGN KEY (tenant_id, device_id, register_id)
    REFERENCES pos.devices(tenant_id, id, register_id);

ALTER TABLE pos.checkout_operations
  ADD CONSTRAINT checkout_operations_session_scope_fk
    FOREIGN KEY (tenant_id, session_id, device_id, register_id)
    REFERENCES pos.register_sessions(tenant_id, id, device_id, register_id);

ALTER TABLE pos.offline_authorizations
  ADD CONSTRAINT offline_authorizations_device_register_fk
    FOREIGN KEY (tenant_id, device_id, register_id)
    REFERENCES pos.devices(tenant_id, id, register_id),
  ADD CONSTRAINT offline_authorizations_scope_unique
    UNIQUE (tenant_id, id, device_id, register_id);

ALTER TABLE pos.offline_operations
  ADD CONSTRAINT offline_operations_authorization_scope_fk
    FOREIGN KEY (tenant_id, authorization_id, device_id, register_id)
    REFERENCES pos.offline_authorizations(tenant_id, id, device_id, register_id);

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0004','MOD-D-POS','manifest:POS-0004-device-register-scope.sql');

COMMIT;
