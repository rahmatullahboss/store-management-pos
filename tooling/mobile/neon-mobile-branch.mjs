import { mkdir, writeFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const apiKey = process.env.NEON_API_KEY;
const projectId = process.env.NEON_PROJECT_ID ?? "twilight-boat-26805962";
const branchName = process.env.NEON_BRANCH_NAME ?? "dev/module-store-companion-mobile";
const parentBranchName = process.env.NEON_PARENT_BRANCH_NAME ?? "dev/module-pos-cash-offline";
const expectedParentBranchId = process.env.NEON_PARENT_BRANCH_ID ?? "br-rapid-river-axoz0rfs";
const databaseName = process.env.NEON_DATABASE_NAME ?? "neondb";
const roleName = process.env.NEON_ROLE_NAME ?? "neondb_owner";
const reportPath = process.env.MOBILE_NEON_REPORT_PATH ?? "artifacts/mobile/neon-branch-evidence.json";
const apiBase = "https://console.neon.tech/api/v2";

if (!apiKey) throw new Error("NEON_API_KEY is required");

async function request(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Neon API ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
  }
  return await response.json();
}

async function resolveReadWriteEndpoint(branchId) {
  const payload = await request(
    `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/endpoints`,
  );
  let endpoint = (payload.endpoints ?? []).find((candidate) => candidate.type === "read_write");
  if (!endpoint) {
    const created = await request(`/projects/${encodeURIComponent(projectId)}/endpoints`, {
      method: "POST",
      body: JSON.stringify({ endpoint: { branch_id: branchId, type: "read_write" } }),
    });
    endpoint = created.endpoint;
  }
  if (!endpoint?.id) throw new Error(`Branch ${branchId} has no read-write endpoint`);
  return endpoint;
}

async function connectionUri(branchId, endpointId) {
  const payload = await request(
    `/projects/${encodeURIComponent(projectId)}/connection_uri?branch_id=${encodeURIComponent(branchId)}&endpoint_id=${encodeURIComponent(endpointId)}&database_name=${encodeURIComponent(databaseName)}&role_name=${encodeURIComponent(roleName)}&pooled=true`,
  );
  if (typeof payload.uri !== "string" || !payload.uri.startsWith("postgres")) {
    throw new Error(`Neon connection URI was not returned for branch ${branchId}`);
  }
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::add-mask::${payload.uri}`);
  return payload.uri;
}

async function schemaFingerprint(uri) {
  const sql = neon(uri);
  const schemas = await sql`
    select nspname as schema_name
    from pg_namespace
    where nspname not like 'pg_%'
      and nspname <> 'information_schema'
    order by nspname
  `;
  const relations = await sql`
    select
      n.nspname as schema_name,
      c.relkind,
      count(*)::int as relation_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not like 'pg_%'
      and n.nspname <> 'information_schema'
      and c.relkind in ('r', 'p', 'v', 'm', 'S')
    group by n.nspname, c.relkind
    order by n.nspname, c.relkind
  `;
  const forcedRls = await sql`
    select count(*)::int as forced_rls_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not like 'pg_%'
      and n.nspname <> 'information_schema'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and c.relforcerowsecurity
  `;
  const migrations = await sql`
    select table_schema, table_name
    from information_schema.tables
    where table_name ilike '%migration%'
      and table_schema not in ('pg_catalog', 'information_schema')
    order by table_schema, table_name
  `;

  return {
    schemas: schemas.map((row) => row.schema_name),
    relations,
    forcedRlsCount: forcedRls[0]?.forced_rls_count ?? 0,
    migrationTables: migrations,
  };
}

function stableJson(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

const branchPayload = await request(`/projects/${encodeURIComponent(projectId)}/branches?limit=100`);
const branches = branchPayload.branches ?? [];
const parent = branches.find((candidate) => candidate.name === parentBranchName);
if (!parent) throw new Error(`Unable to resolve Neon parent branch ${parentBranchName}`);
if (parent.id !== expectedParentBranchId) {
  throw new Error(
    `Parent branch ID mismatch: expected ${expectedParentBranchId}, resolved ${parent.id}`,
  );
}

let branch = branches.find((candidate) => candidate.name === branchName);
let created = false;
if (!branch) {
  const createdPayload = await request(`/projects/${encodeURIComponent(projectId)}/branches`, {
    method: "POST",
    body: JSON.stringify({ branch: { name: branchName, parent_id: parent.id } }),
  });
  branch = createdPayload.branch;
  created = true;
}
if (!branch?.id) throw new Error("Mobile Neon branch response did not include an id");
if (branch.parent_id !== parent.id) {
  throw new Error(
    `Existing mobile branch ${branch.id} has parent ${branch.parent_id}; expected ${parent.id}`,
  );
}

const [parentEndpoint, mobileEndpoint] = await Promise.all([
  resolveReadWriteEndpoint(parent.id),
  resolveReadWriteEndpoint(branch.id),
]);
const [parentUri, mobileUri] = await Promise.all([
  connectionUri(parent.id, parentEndpoint.id),
  connectionUri(branch.id, mobileEndpoint.id),
]);
const [parentFingerprint, mobileFingerprint] = await Promise.all([
  schemaFingerprint(parentUri),
  schemaFingerprint(mobileUri),
]);

const schemaMatches = JSON.stringify(parentFingerprint.schemas) === JSON.stringify(mobileFingerprint.schemas);
const relationMatches = JSON.stringify(parentFingerprint.relations) === JSON.stringify(mobileFingerprint.relations);
const rlsMatches = parentFingerprint.forcedRlsCount === mobileFingerprint.forcedRlsCount;
const migrationTableMatches =
  JSON.stringify(parentFingerprint.migrationTables) === JSON.stringify(mobileFingerprint.migrationTables);

if (!schemaMatches || !relationMatches || !rlsMatches || !migrationTableMatches) {
  throw new Error("Mobile Neon branch schema fingerprint does not match the reviewed MOD-D parent");
}

const report = {
  generatedAt: new Date().toISOString(),
  projectId,
  databaseName,
  roleName,
  branch: {
    id: branch.id,
    name: branch.name,
    parentId: branch.parent_id,
    created,
  },
  parent: {
    id: parent.id,
    name: parent.name,
  },
  verification: {
    schemaMatches,
    relationMatches,
    rlsMatches,
    migrationTableMatches,
    schemaCount: mobileFingerprint.schemas.length,
    relationGroups: mobileFingerprint.relations.length,
    forcedRlsCount: mobileFingerprint.forcedRlsCount,
    migrationTables: mobileFingerprint.migrationTables,
  },
  safety: {
    productionDataUsed: false,
    businessSchemaOwnedByMobile: false,
    directMobileDatabaseAccessAllowed: false,
    branchRetainedForSyntheticEvidence: true,
  },
};

await mkdir(new URL(`../../${reportPath.split("/").slice(0, -1).join("/")}/`, import.meta.url), {
  recursive: true,
}).catch(async () => {
  await mkdir(reportPath.split("/").slice(0, -1).join("/"), { recursive: true });
});
await mkdir(reportPath.split("/").slice(0, -1).join("/"), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`${created ? "created" : "verified"} Neon branch ${branch.name} (${branch.id})`);
console.log(`verified parent ${parent.name} (${parent.id}) and matching schema fingerprint`);
