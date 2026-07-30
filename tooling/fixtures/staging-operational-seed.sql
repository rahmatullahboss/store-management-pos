BEGIN;

SELECT pg_advisory_xact_lock(hashtext('store-management-staging-operational-seed-v1'));
SELECT platform.set_request_context(
  '018f0000-0000-7000-8000-000000000002'::uuid,
  '018f0000-0000-7000-8000-000000000102'::uuid,
  '018f0000-0000-7000-8000-000000000202'::uuid,
  '018f0000-0000-7000-8000-000000000302'::uuid,
  '018f0000-0000-7000-8000-000000000402'::uuid,
  '018f0000-0000-7000-8000-000000000502'::uuid,
  DATE '2026-07-30',
  'staging-operational-seed-v1',
  'staging-operational-seed-v1'
);

INSERT INTO catalog.units(
  id, tenant_id, code, display_name, dimension, decimal_scale,
  is_base_unit, status, created_by
) VALUES (
  '018f1000-0000-7000-8000-000000000001',
  '018f0000-0000-7000-8000-000000000002',
  'EA', 'Each', 'count', 0, true, 'active',
  '018f0000-0000-7000-8000-000000000102'
)
ON CONFLICT (tenant_id, code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  dimension = EXCLUDED.dimension,
  decimal_scale = EXCLUDED.decimal_scale,
  is_base_unit = EXCLUDED.is_base_unit,
  status = EXCLUDED.status;

INSERT INTO catalog.products(
  id, tenant_id, code, normalized_code, kind, status, default_locale,
  metadata, created_by, updated_by, published_at
) VALUES
  ('018f1000-0000-7000-8000-000000000101','018f0000-0000-7000-8000-000000000002','DEMO-TSHIRT','demo-tshirt','stock','active','bn-BD','{"displayName":"Premium Cotton T-Shirt","category":"Fashion"}'::jsonb,'018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102','2026-07-28T04:00:00Z'),
  ('018f1000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000002','DEMO-RICE','demo-rice','stock','active','bn-BD','{"displayName":"Aromatic Rice 5 kg","category":"Grocery"}'::jsonb,'018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102','2026-07-28T04:00:00Z'),
  ('018f1000-0000-7000-8000-000000000103','018f0000-0000-7000-8000-000000000002','DEMO-HEADPHONE','demo-headphone','stock','active','bn-BD','{"displayName":"Wireless Headphones","category":"Electronics"}'::jsonb,'018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102','2026-07-28T04:00:00Z'),
  ('018f1000-0000-7000-8000-000000000104','018f0000-0000-7000-8000-000000000002','DEMO-BAG','demo-bag','stock','active','bn-BD','{"displayName":"Canvas Carry Bag","category":"Lifestyle"}'::jsonb,'018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102','2026-07-28T04:00:00Z'),
  ('018f1000-0000-7000-8000-000000000105','018f0000-0000-7000-8000-000000000002','DEMO-PAPER','demo-paper','stock','active','bn-BD','{"displayName":"Thermal Paper 80 mm","category":"Store supplies"}'::jsonb,'018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102','2026-07-28T04:00:00Z')
ON CONFLICT (tenant_id, normalized_code) DO UPDATE SET
  status = EXCLUDED.status,
  default_locale = EXCLUDED.default_locale,
  metadata = EXCLUDED.metadata,
  updated_by = EXCLUDED.updated_by,
  published_at = EXCLUDED.published_at,
  updated_at = now();

INSERT INTO catalog.variants(
  id, tenant_id, product_id, sku, normalized_sku, title,
  combination_key, unit_code, tracking_mode, status, metadata
) VALUES
  ('018f1000-0000-7000-8000-000000000201','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000101','TSHIRT-NAVY-M','tshirt-navy-m','Navy / Medium','colour=navy|size=m','EA','none','active','{"barcode":"894110000001"}'::jsonb),
  ('018f1000-0000-7000-8000-000000000202','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000102','RICE-AROMA-5KG','rice-aroma-5kg','5 kg bag','pack=5kg','EA','batch_expiry','active','{"barcode":"894110000002"}'::jsonb),
  ('018f1000-0000-7000-8000-000000000203','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000103','HEADPHONE-BLK','headphone-blk','Black','colour=black','EA','serial','active','{"barcode":"894110000003"}'::jsonb),
  ('018f1000-0000-7000-8000-000000000204','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000104','BAG-OLIVE','bag-olive','Olive','colour=olive','EA','none','active','{"barcode":"894110000004"}'::jsonb),
  ('018f1000-0000-7000-8000-000000000205','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000105','PAPER-80','paper-80','80 mm roll','width=80mm','EA','none','active','{"barcode":"894110000005"}'::jsonb)
ON CONFLICT (tenant_id, normalized_sku) DO UPDATE SET
  product_id = EXCLUDED.product_id,
  title = EXCLUDED.title,
  combination_key = EXCLUDED.combination_key,
  unit_code = EXCLUDED.unit_code,
  tracking_mode = EXCLUDED.tracking_mode,
  status = EXCLUDED.status,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO pricing.price_lists(
  id, tenant_id, code, display_name, currency, money_scale,
  current_version, active_version, status, created_by, updated_by
) VALUES (
  '018f1000-0000-7000-8000-000000000301',
  '018f0000-0000-7000-8000-000000000002',
  'STG-RETAIL-BDT', 'Staging retail BDT', 'BDT', 2,
  1, 1, 'active',
  '018f0000-0000-7000-8000-000000000102',
  '018f0000-0000-7000-8000-000000000102'
)
ON CONFLICT (tenant_id, code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  currency = EXCLUDED.currency,
  money_scale = EXCLUDED.money_scale,
  current_version = EXCLUDED.current_version,
  active_version = EXCLUDED.active_version,
  status = EXCLUDED.status,
  updated_by = EXCLUDED.updated_by,
  updated_at = now();

INSERT INTO pricing.price_list_versions(
  id, tenant_id, price_list_id, version, status, priority,
  legal_entity_id, store_id, channel, effective_from, reason, created_by
) VALUES (
  '018f1000-0000-7000-8000-000000000302',
  '018f0000-0000-7000-8000-000000000002',
  '018f1000-0000-7000-8000-000000000301',
  1, 'active', 100,
  '018f0000-0000-7000-8000-000000000202',
  '018f0000-0000-7000-8000-000000000302',
  'pos', '2026-07-01T00:00:00Z',
  'Deterministic staging release-candidate prices',
  '018f0000-0000-7000-8000-000000000102'
)
ON CONFLICT (tenant_id, price_list_id, version) DO UPDATE SET
  status = EXCLUDED.status,
  priority = EXCLUDED.priority,
  legal_entity_id = EXCLUDED.legal_entity_id,
  store_id = EXCLUDED.store_id,
  channel = EXCLUDED.channel,
  effective_from = EXCLUDED.effective_from,
  reason = EXCLUDED.reason;

INSERT INTO pricing.price_rules(
  id, tenant_id, price_list_version_id, variant_id, unit_code,
  minimum_quantity_minor, quantity_scale, unit_price_minor,
  compare_at_price_minor, priority, rule_version, metadata
) VALUES
  ('018f1000-0000-7000-8000-000000000311','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000302','018f1000-0000-7000-8000-000000000201','EA',1,0,85000,95000,100,1,'{"label":"Launch price"}'::jsonb),
  ('018f1000-0000-7000-8000-000000000312','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000302','018f1000-0000-7000-8000-000000000202','EA',1,0,72000,NULL,100,1,'{}'::jsonb),
  ('018f1000-0000-7000-8000-000000000313','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000302','018f1000-0000-7000-8000-000000000203','EA',1,0,245000,275000,100,1,'{"label":"Featured"}'::jsonb),
  ('018f1000-0000-7000-8000-000000000314','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000302','018f1000-0000-7000-8000-000000000204','EA',1,0,95000,NULL,100,1,'{}'::jsonb),
  ('018f1000-0000-7000-8000-000000000315','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000302','018f1000-0000-7000-8000-000000000205','EA',1,0,8500,NULL,100,1,'{}'::jsonb)
ON CONFLICT (tenant_id, price_list_version_id, variant_id, unit_code, minimum_quantity_minor, quantity_scale, rule_version)
DO UPDATE SET
  unit_price_minor = EXCLUDED.unit_price_minor,
  compare_at_price_minor = EXCLUDED.compare_at_price_minor,
  priority = EXCLUDED.priority,
  metadata = EXCLUDED.metadata;

INSERT INTO inventory.warehouse_settings(
  tenant_id, warehouse_id, negative_stock_policy, costing_method,
  cycle_count_frequency_days
) VALUES (
  '018f0000-0000-7000-8000-000000000002',
  '018f0000-0000-7000-8000-000000000402',
  'deny', 'fifo', 30
)
ON CONFLICT (tenant_id, warehouse_id) DO UPDATE SET
  negative_stock_policy = EXCLUDED.negative_stock_policy,
  costing_method = EXCLUDED.costing_method,
  cycle_count_frequency_days = EXCLUDED.cycle_count_frequency_days,
  updated_at = now();

INSERT INTO inventory.stock_ledger_entries(
  id, tenant_id, legal_entity_id, operation_id, operation_line_index,
  posting_group_id, variant_id, warehouse_id, stock_status,
  quantity_amount, quantity_scale, unit_code, unit_cost_minor, currency,
  value_delta_minor, movement_type, source_document_type,
  source_document_id, business_date, posted_at, actor_id, request_id,
  trace_id, metadata
)
SELECT
  seed.id, seed.tenant_id, seed.legal_entity_id, seed.operation_id,
  seed.operation_line_index, seed.posting_group_id, seed.variant_id,
  seed.warehouse_id, seed.stock_status, seed.quantity_amount,
  seed.quantity_scale, seed.unit_code, seed.unit_cost_minor, seed.currency,
  seed.value_delta_minor, seed.movement_type, seed.source_document_type,
  seed.source_document_id, seed.business_date, seed.posted_at, seed.actor_id,
  seed.request_id, seed.trace_id, seed.metadata
FROM (VALUES
  ('018f1000-0000-7000-8000-000000000901'::uuid,'018f0000-0000-7000-8000-000000000002'::uuid,'018f0000-0000-7000-8000-000000000202'::uuid,'staging-opening-tshirt',0,'STG-PG-OPENING','018f1000-0000-7000-8000-000000000201'::uuid,'018f0000-0000-7000-8000-000000000402'::uuid,'sellable',120::numeric,0::smallint,'EA',42000::numeric,'BDT'::char(3),5040000::numeric,'opening_balance','staging_seed','STG-OPEN-001',DATE '2026-07-28','2026-07-28T04:00:00Z'::timestamptz,'018f0000-0000-7000-8000-000000000102'::uuid,'staging-seed-stock-1','staging-seed-stock','{"synthetic":true}'::jsonb),
  ('018f1000-0000-7000-8000-000000000902'::uuid,'018f0000-0000-7000-8000-000000000002'::uuid,'018f0000-0000-7000-8000-000000000202'::uuid,'staging-opening-rice',0,'STG-PG-OPENING','018f1000-0000-7000-8000-000000000202'::uuid,'018f0000-0000-7000-8000-000000000402'::uuid,'sellable',35::numeric,0::smallint,'EA',54000::numeric,'BDT'::char(3),1890000::numeric,'opening_balance','staging_seed','STG-OPEN-002',DATE '2026-07-28','2026-07-28T04:01:00Z'::timestamptz,'018f0000-0000-7000-8000-000000000102'::uuid,'staging-seed-stock-2','staging-seed-stock','{"synthetic":true}'::jsonb),
  ('018f1000-0000-7000-8000-000000000903'::uuid,'018f0000-0000-7000-8000-000000000002'::uuid,'018f0000-0000-7000-8000-000000000202'::uuid,'staging-opening-headphone',0,'STG-PG-OPENING','018f1000-0000-7000-8000-000000000203'::uuid,'018f0000-0000-7000-8000-000000000402'::uuid,'sellable',8::numeric,0::smallint,'EA',165000::numeric,'BDT'::char(3),1320000::numeric,'opening_balance','staging_seed','STG-OPEN-003',DATE '2026-07-28','2026-07-28T04:02:00Z'::timestamptz,'018f0000-0000-7000-8000-000000000102'::uuid,'staging-seed-stock-3','staging-seed-stock','{"synthetic":true}'::jsonb),
  ('018f1000-0000-7000-8000-000000000904'::uuid,'018f0000-0000-7000-8000-000000000002'::uuid,'018f0000-0000-7000-8000-000000000202'::uuid,'staging-opening-bag',0,'STG-PG-OPENING','018f1000-0000-7000-8000-000000000204'::uuid,'018f0000-0000-7000-8000-000000000402'::uuid,'sellable',60::numeric,0::smallint,'EA',52000::numeric,'BDT'::char(3),3120000::numeric,'opening_balance','staging_seed','STG-OPEN-004',DATE '2026-07-28','2026-07-28T04:03:00Z'::timestamptz,'018f0000-0000-7000-8000-000000000102'::uuid,'staging-seed-stock-4','staging-seed-stock','{"synthetic":true}'::jsonb),
  ('018f1000-0000-7000-8000-000000000905'::uuid,'018f0000-0000-7000-8000-000000000002'::uuid,'018f0000-0000-7000-8000-000000000202'::uuid,'staging-opening-paper',0,'STG-PG-OPENING','018f1000-0000-7000-8000-000000000205'::uuid,'018f0000-0000-7000-8000-000000000402'::uuid,'sellable',15::numeric,0::smallint,'EA',5200::numeric,'BDT'::char(3),78000::numeric,'opening_balance','staging_seed','STG-OPEN-005',DATE '2026-07-28','2026-07-28T04:04:00Z'::timestamptz,'018f0000-0000-7000-8000-000000000102'::uuid,'staging-seed-stock-5','staging-seed-stock','{"synthetic":true}'::jsonb)
) AS seed(
  id, tenant_id, legal_entity_id, operation_id, operation_line_index,
  posting_group_id, variant_id, warehouse_id, stock_status, quantity_amount,
  quantity_scale, unit_code, unit_cost_minor, currency, value_delta_minor,
  movement_type, source_document_type, source_document_id, business_date,
  posted_at, actor_id, request_id, trace_id, metadata
)
WHERE NOT EXISTS (
  SELECT 1
  FROM inventory.stock_ledger_entries existing
  WHERE existing.tenant_id = seed.tenant_id
    AND existing.operation_id = seed.operation_id
    AND existing.operation_line_index = seed.operation_line_index
);

INSERT INTO procurement.suppliers(
  id, tenant_id, legal_entity_id, code, legal_name, display_name,
  status, currency, payment_terms_days, lead_time_days,
  email, phone, metadata
) VALUES
  ('018f1000-0000-7000-8000-000000000401','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','SUP-NORTH','Northstar Distribution Ltd','Northstar Distribution','active','BDT',30,5,'synthetic-north@example.invalid','+880000000001','{"synthetic":true}'::jsonb),
  ('018f1000-0000-7000-8000-000000000402','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','SUP-PAPER','Paperline Wholesale Ltd','Paperline Wholesale','active','BDT',15,3,'synthetic-paper@example.invalid','+880000000002','{"synthetic":true}'::jsonb),
  ('018f1000-0000-7000-8000-000000000403','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','SUP-AXIS','Axis Devices Ltd','Axis Devices','active','BDT',30,7,'synthetic-axis@example.invalid','+880000000003','{"synthetic":true}'::jsonb)
ON CONFLICT (tenant_id, code) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status,
  currency = EXCLUDED.currency,
  payment_terms_days = EXCLUDED.payment_terms_days,
  lead_time_days = EXCLUDED.lead_time_days,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO procurement.purchase_orders(
  id, tenant_id, legal_entity_id, supplier_id, order_number, state,
  currency, warehouse_id, requested_by, submitted_by, approved_by,
  approved_at, metadata
) VALUES
  ('018f1000-0000-7000-8000-000000000501','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','018f1000-0000-7000-8000-000000000401','PO-STG-0001','partially_received','BDT','018f0000-0000-7000-8000-000000000402','018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102','2026-07-27T05:00:00Z','{"synthetic":true,"promisedDate":"2026-07-31"}'::jsonb),
  ('018f1000-0000-7000-8000-000000000502','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','018f1000-0000-7000-8000-000000000402','PO-STG-0002','approved','BDT','018f0000-0000-7000-8000-000000000402','018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102','2026-07-29T06:00:00Z','{"synthetic":true,"promisedDate":"2026-08-01"}'::jsonb),
  ('018f1000-0000-7000-8000-000000000503','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','018f1000-0000-7000-8000-000000000403','PO-STG-0003','submitted','BDT','018f0000-0000-7000-8000-000000000402','018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102',NULL,NULL,'{"synthetic":true,"promisedDate":"2026-08-04"}'::jsonb)
ON CONFLICT (tenant_id, order_number) DO UPDATE SET
  supplier_id = EXCLUDED.supplier_id,
  state = EXCLUDED.state,
  currency = EXCLUDED.currency,
  warehouse_id = EXCLUDED.warehouse_id,
  submitted_by = EXCLUDED.submitted_by,
  approved_by = EXCLUDED.approved_by,
  approved_at = EXCLUDED.approved_at,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO procurement.purchase_order_lines(
  id, tenant_id, purchase_order_id, item_id, variant_id, warehouse_id,
  ordered_quantity, received_quantity, returned_quantity,
  cancelled_quantity, quantity_scale, unit_code, unit_cost_minor,
  currency, promised_date, notes
) VALUES
  ('018f1000-0000-7000-8000-000000000511','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000501','018f1000-0000-7000-8000-000000000101','018f1000-0000-7000-8000-000000000201','018f0000-0000-7000-8000-000000000402',100,60,0,0,0,'EA',41000,'BDT','2026-07-31','Synthetic partial receipt'),
  ('018f1000-0000-7000-8000-000000000512','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000502','018f1000-0000-7000-8000-000000000105','018f1000-0000-7000-8000-000000000205','018f0000-0000-7000-8000-000000000402',300,0,0,0,0,'EA',5000,'BDT','2026-08-01','Synthetic approved order'),
  ('018f1000-0000-7000-8000-000000000513','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000503','018f1000-0000-7000-8000-000000000103','018f1000-0000-7000-8000-000000000203','018f0000-0000-7000-8000-000000000402',20,0,0,0,0,'EA',158000,'BDT','2026-08-04','Awaiting approval')
ON CONFLICT (tenant_id, id) DO UPDATE SET
  purchase_order_id = EXCLUDED.purchase_order_id,
  item_id = EXCLUDED.item_id,
  variant_id = EXCLUDED.variant_id,
  warehouse_id = EXCLUDED.warehouse_id,
  ordered_quantity = EXCLUDED.ordered_quantity,
  received_quantity = EXCLUDED.received_quantity,
  returned_quantity = EXCLUDED.returned_quantity,
  cancelled_quantity = EXCLUDED.cancelled_quantity,
  quantity_scale = EXCLUDED.quantity_scale,
  unit_code = EXCLUDED.unit_code,
  unit_cost_minor = EXCLUDED.unit_cost_minor,
  currency = EXCLUDED.currency,
  promised_date = EXCLUDED.promised_date,
  notes = EXCLUDED.notes,
  updated_at = now();

INSERT INTO customer.customers(
  id, tenant_id, legal_entity_id, customer_kind, display_name,
  person_data, company_data, status, created_by, updated_by
) VALUES
  ('018f1000-0000-7000-8000-000000000601','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','person','Ayesha Rahman','{"givenName":"Ayesha","familyName":"Rahman","synthetic":true}'::jsonb,NULL,'active','018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102'),
  ('018f1000-0000-7000-8000-000000000602','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','company','Dhaka Office Supplies',NULL,'{"legalName":"Dhaka Office Supplies Ltd","synthetic":true}'::jsonb,'active','018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102'),
  ('018f1000-0000-7000-8000-000000000603','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','person','Nabil Hasan','{"givenName":"Nabil","familyName":"Hasan","synthetic":true}'::jsonb,NULL,'active','018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102'),
  ('018f1000-0000-7000-8000-000000000604','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','company','Ozzyl Demo Wholesale',NULL,'{"legalName":"Ozzyl Demo Wholesale","synthetic":true}'::jsonb,'active','018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102')
ON CONFLICT (tenant_id, id) DO UPDATE SET
  legal_entity_id = EXCLUDED.legal_entity_id,
  customer_kind = EXCLUDED.customer_kind,
  display_name = EXCLUDED.display_name,
  person_data = EXCLUDED.person_data,
  company_data = EXCLUDED.company_data,
  status = EXCLUDED.status,
  updated_by = EXCLUDED.updated_by,
  updated_at = now();

INSERT INTO inventory.stock_reservations(
  id, tenant_id, source_type, source_id, state, fulfillment_policy,
  expires_at, created_by
) VALUES
  ('018f1000-0000-7000-8000-000000000701','018f0000-0000-7000-8000-000000000002','sales_order','SO-STG-0001','fully_reserved','all_or_nothing','2026-08-02T18:00:00Z','018f0000-0000-7000-8000-000000000102'),
  ('018f1000-0000-7000-8000-000000000702','018f0000-0000-7000-8000-000000000002','sales_order','SO-STG-0002','fully_reserved','all_or_nothing','2026-08-02T18:00:00Z','018f0000-0000-7000-8000-000000000102'),
  ('018f1000-0000-7000-8000-000000000703','018f0000-0000-7000-8000-000000000002','sales_order','SO-STG-0003','fully_reserved','allow_partial','2026-08-03T18:00:00Z','018f0000-0000-7000-8000-000000000102')
ON CONFLICT (tenant_id, source_type, source_id) DO UPDATE SET
  state = EXCLUDED.state,
  fulfillment_policy = EXCLUDED.fulfillment_policy,
  expires_at = EXCLUDED.expires_at,
  updated_at = now();

INSERT INTO inventory.stock_reservation_lines(
  id, tenant_id, reservation_id, variant_id, warehouse_id, unit_code,
  quantity_scale, requested_quantity, reserved_quantity
) VALUES
  ('018f1000-0000-7000-8000-000000000711','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000701','018f1000-0000-7000-8000-000000000201','018f0000-0000-7000-8000-000000000402','EA',0,2,2),
  ('018f1000-0000-7000-8000-000000000712','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000702','018f1000-0000-7000-8000-000000000204','018f0000-0000-7000-8000-000000000402','EA',0,1,1),
  ('018f1000-0000-7000-8000-000000000713','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000703','018f1000-0000-7000-8000-000000000203','018f0000-0000-7000-8000-000000000402','EA',0,1,1)
ON CONFLICT (tenant_id, reservation_id, variant_id, warehouse_id, unit_code, quantity_scale)
DO UPDATE SET
  requested_quantity = EXCLUDED.requested_quantity,
  reserved_quantity = EXCLUDED.reserved_quantity,
  updated_at = now();

INSERT INTO sales.orders(
  id, tenant_id, legal_entity_id, store_id, warehouse_id,
  document_number, customer_id, customer_snapshot, currency,
  fulfillment_method, payment_terms, reservation_id, credit_decision,
  order_status, payment_status, fulfillment_status, invoice_status,
  return_status, backorder_status, totals_snapshot,
  commission_basis_metadata, notes, created_by, updated_by,
  availability_mode
) VALUES
  ('018f1000-0000-7000-8000-000000000801','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','018f0000-0000-7000-8000-000000000302','018f0000-0000-7000-8000-000000000402','SO-STG-0001','018f1000-0000-7000-8000-000000000601','{"displayName":"Ayesha Rahman","synthetic":true}'::jsonb,'BDT','pickup','prepaid','018f1000-0000-7000-8000-000000000701','approved','confirmed','paid','unfulfilled','not_invoiced','not_returned','none','{"subtotalMinor":"170000","discountMinor":"0","taxMinor":"0","totalMinor":"170000","scale":2}'::jsonb,'{}'::jsonb,'[]'::jsonb,'018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102','standard'),
  ('018f1000-0000-7000-8000-000000000802','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','018f0000-0000-7000-8000-000000000302','018f0000-0000-7000-8000-000000000402','SO-STG-0002','018f1000-0000-7000-8000-000000000602','{"displayName":"Dhaka Office Supplies","synthetic":true}'::jsonb,'BDT','local_delivery','on_account','018f1000-0000-7000-8000-000000000702','approved','confirmed','partially_paid','partially_fulfilled','partially_invoiced','not_returned','none','{"subtotalMinor":"95000","discountMinor":"0","taxMinor":"0","totalMinor":"95000","scale":2}'::jsonb,'{}'::jsonb,'[]'::jsonb,'018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102','standard'),
  ('018f1000-0000-7000-8000-000000000803','018f0000-0000-7000-8000-000000000002','018f0000-0000-7000-8000-000000000202','018f0000-0000-7000-8000-000000000302','018f0000-0000-7000-8000-000000000402','SO-STG-0003','018f1000-0000-7000-8000-000000000603','{"displayName":"Nabil Hasan","synthetic":true}'::jsonb,'BDT','ship_from_store','prepaid','018f1000-0000-7000-8000-000000000703','approved','on_hold','unpaid','unfulfilled','not_invoiced','not_returned','none','{"subtotalMinor":"245000","discountMinor":"0","taxMinor":"0","totalMinor":"245000","scale":2}'::jsonb,'{}'::jsonb,'[]'::jsonb,'018f0000-0000-7000-8000-000000000102','018f0000-0000-7000-8000-000000000102','standard')
ON CONFLICT (tenant_id, legal_entity_id, document_number) DO UPDATE SET
  customer_id = EXCLUDED.customer_id,
  customer_snapshot = EXCLUDED.customer_snapshot,
  currency = EXCLUDED.currency,
  fulfillment_method = EXCLUDED.fulfillment_method,
  payment_terms = EXCLUDED.payment_terms,
  reservation_id = EXCLUDED.reservation_id,
  credit_decision = EXCLUDED.credit_decision,
  order_status = EXCLUDED.order_status,
  payment_status = EXCLUDED.payment_status,
  fulfillment_status = EXCLUDED.fulfillment_status,
  invoice_status = EXCLUDED.invoice_status,
  return_status = EXCLUDED.return_status,
  backorder_status = EXCLUDED.backorder_status,
  totals_snapshot = EXCLUDED.totals_snapshot,
  updated_by = EXCLUDED.updated_by,
  updated_at = now();

INSERT INTO sales.order_lines(
  id, tenant_id, order_id, line_number, item_id, variant_id,
  item_snapshot, quantity_snapshot, price_tax_snapshot
) VALUES
  ('018f1000-0000-7000-8000-000000000811','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000801',1,'018f1000-0000-7000-8000-000000000101','018f1000-0000-7000-8000-000000000201','{"name":"Premium Cotton T-Shirt","sku":"TSHIRT-NAVY-M"}'::jsonb,'{"amount":"2","scale":0,"unitCode":"EA"}'::jsonb,'{"unitPriceMinor":"85000","lineTotalMinor":"170000","currency":"BDT","scale":2}'::jsonb),
  ('018f1000-0000-7000-8000-000000000812','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000802',1,'018f1000-0000-7000-8000-000000000104','018f1000-0000-7000-8000-000000000204','{"name":"Canvas Carry Bag","sku":"BAG-OLIVE"}'::jsonb,'{"amount":"1","scale":0,"unitCode":"EA"}'::jsonb,'{"unitPriceMinor":"95000","lineTotalMinor":"95000","currency":"BDT","scale":2}'::jsonb),
  ('018f1000-0000-7000-8000-000000000813','018f0000-0000-7000-8000-000000000002','018f1000-0000-7000-8000-000000000803',1,'018f1000-0000-7000-8000-000000000103','018f1000-0000-7000-8000-000000000203','{"name":"Wireless Headphones","sku":"HEADPHONE-BLK"}'::jsonb,'{"amount":"1","scale":0,"unitCode":"EA"}'::jsonb,'{"unitPriceMinor":"245000","lineTotalMinor":"245000","currency":"BDT","scale":2}'::jsonb)
ON CONFLICT (tenant_id, order_id, line_number) DO UPDATE SET
  item_id = EXCLUDED.item_id,
  variant_id = EXCLUDED.variant_id,
  item_snapshot = EXCLUDED.item_snapshot,
  quantity_snapshot = EXCLUDED.quantity_snapshot,
  price_tax_snapshot = EXCLUDED.price_tax_snapshot;

COMMIT;
