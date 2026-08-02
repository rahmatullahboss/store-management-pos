import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const sql = await readFile(
  path.join(
    root,
    "database/modules/storefront/migrations/STF-0003-public-host-resolution.sql",
  ),
  "utf8",
);

const required = [
  [
    /CREATE TABLE IF NOT EXISTS storefront\.domain_sales_channel_bindings/u,
    "domain-to-channel binding table",
  ],
  [
    /ALTER TABLE storefront\.domain_sales_channel_bindings ENABLE ROW LEVEL SECURITY/u,
    "binding RLS enablement",
  ],
  [
    /ALTER TABLE storefront\.domain_sales_channel_bindings FORCE ROW LEVEL SECURITY/u,
    "binding forced RLS",
  ],
  [
    /FUNCTION storefront\.bind_domain_sales_channel/u,
    "idempotent domain binding command",
  ],
  [
    /pg_advisory_xact_lock/u,
    "domain binding serialization",
  ],
  [
    /FUNCTION storefront\.resolve_public_host\(p_hostname text\)/u,
    "narrow public hostname resolver",
  ],
  [
    /SECURITY DEFINER[\s\S]*SET row_security = off/u,
    "security-definer public resolver with explicit RLS handling",
  ],
  [
    /JOIN pricing\.price_lists pl[\s\S]*pl\.status = 'active'[\s\S]*pl\.active_version IS NOT NULL/u,
    "authoritative active price-list version join",
  ],
  [
    /d\.status = 'active'[\s\S]*d\.certificate_status = 'active'/u,
    "active verified domain filter",
  ],
  [
    /sf\.status = 'active'[\s\S]*sc\.status = 'active'/u,
    "active storefront and sales-channel filter",
  ],
  [
    /b\.status = 'active'/u,
    "active domain binding filter",
  ],
  [
    /REVOKE ALL ON FUNCTION storefront\.resolve_public_host\(text\) FROM PUBLIC/u,
    "public execute revocation",
  ],
  [
    /GRANT EXECUTE ON FUNCTION storefront\.resolve_public_host\(text\) TO store_app_runtime/u,
    "runtime-only resolver grant",
  ],
  [
    /REVOKE INSERT, UPDATE, DELETE ON storefront\.domain_sales_channel_bindings FROM store_app_runtime/u,
    "runtime direct binding write revocation",
  ],
  [
    /INSERT INTO platform\.audit_events/u,
    "binding audit evidence",
  ],
  [
    /INSERT INTO platform\.outbox_events/u,
    "binding outbox evidence",
  ],
];

for (const [pattern, label] of required) {
  if (!pattern.test(sql)) throw new Error(`STF-0003 is missing ${label}`);
}

if (/SELECT\s+\*/iu.test(sql.replace(/SELECT \* INTO/gu, ""))) {
  throw new Error("STF-0003 public resolver must not expose SELECT *");
}
if (/settings|failure_detail|challenge_value_hash/iu.test(
  sql.slice(sql.indexOf("FUNCTION storefront.resolve_public_host")),
)) {
  throw new Error("STF-0003 public resolver exposes a sensitive field");
}

console.log("validated STF-0003 public hostname security boundary");
