BEGIN;
SET LOCAL row_security = off;

INSERT INTO platform.tenants(id, code, display_name, home_region, status, default_locale, default_time_zone) VALUES
  ('018f0000-0000-7000-8000-000000000001','synthetic-alpha','Synthetic Alpha Retail','aws-us-east-2','active','en-GB','Europe/London'),
  ('018f0000-0000-7000-8000-000000000002','synthetic-beta','Synthetic Beta Retail','aws-us-east-2','active','bn-BD','Asia/Dhaka')
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.users(id, identity_subject, display_name, email_normalized, status) VALUES
  ('018f0000-0000-7000-8000-000000000101','synthetic-alpha-owner','Alpha Owner','alpha@example.invalid','active'),
  ('018f0000-0000-7000-8000-000000000102','synthetic-beta-owner','Beta Owner','beta@example.invalid','active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.legal_entities(id, tenant_id, code, legal_name, base_currency, country_code, time_zone) VALUES
  ('018f0000-0000-7000-8000-000000000201','018f0000-0000-7000-8000-000000000001','ALPHA-UK','Synthetic Alpha Retail Ltd','GBP','GB','Europe/London'),
  ('018f0000-0000-7000-8000-000000000202','018f0000-0000-7000-8000-000000000002','BETA-BD','Synthetic Beta Retail Ltd','BDT','BD','Asia/Dhaka')
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.stores(id, tenant_id, legal_entity_id, code, display_name, time_zone) VALUES
  ('018f0000-0000-7000-8000-000000000301','018f0000-0000-7000-8000-000000000001','018f0000-0000-7000-8000-000000000201','LON-01','Synthetic London Store','Europe/London'),
  ('018f0000-0000-7000-8000-000000000302','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','DHK-01','Synthetic Dhaka Store','Asia/Dhaka')
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.warehouses(id, tenant_id, legal_entity_id, store_id, code, display_name) VALUES
  ('018f0000-0000-7000-8000-000000000401','018f0000-0000-7000-8000-000000000001','018f0000-0000-7000-8000-000000000201','018f0000-0000-7000-8000-000000000301','LON-WH','Synthetic London Warehouse'),
  ('018f0000-0000-7000-8000-000000000402','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','018f0000-0000-7000-8000-000000000302','DHK-WH','Synthetic Dhaka Warehouse')
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.registers(id, tenant_id, store_id, code, display_name) VALUES
  ('018f0000-0000-7000-8000-000000000501','018f0000-0000-7000-8000-000000000001','018f0000-0000-7000-8000-000000000301','REG-01','Synthetic London Register'),
  ('018f0000-0000-7000-8000-000000000502','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000302','REG-01','Synthetic Dhaka Register')
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.memberships(id, tenant_id, user_id, status) VALUES
  ('018f0000-0000-7000-8000-000000000601','018f0000-0000-7000-8000-000000000001','018f0000-0000-7000-8000-000000000101','active'),
  ('018f0000-0000-7000-8000-000000000602','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000102','active')
ON CONFLICT (id) DO NOTHING;

COMMIT;
