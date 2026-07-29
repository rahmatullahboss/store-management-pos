import { appendFile } from "node:fs/promises";

const apiKey = process.env.NEON_API_KEY;
const projectId = process.env.NEON_PROJECT_ID;
const branchName = process.env.NEON_BRANCH_NAME ?? "dev/module-inventory-procurement";
const parentBranchName = process.env.NEON_PARENT_BRANCH_NAME;
const databaseName = process.env.NEON_DATABASE_NAME ?? "neondb";
const roleName = process.env.NEON_ROLE_NAME ?? "neondb_owner";
const apiBase = "https://console.neon.tech/api/v2";

if (!apiKey) throw new Error("NEON_API_KEY is required");
if (!projectId) throw new Error("NEON_PROJECT_ID is required");

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

const branchPayload = await request(`/projects/${encodeURIComponent(projectId)}/branches?limit=100`);
const branches = branchPayload.branches ?? [];
let branch = branches.find((candidate) => candidate.name === branchName);
let created = false;
if (!branch) {
  const parent = parentBranchName
    ? branches.find((candidate) => candidate.name === parentBranchName)
    : branches.find((candidate) => candidate.primary === true) ?? branches.find((candidate) => candidate.name === "main");
  if (!parent) throw new Error("Unable to resolve the Neon parent branch");
  const createdPayload = await request(`/projects/${encodeURIComponent(projectId)}/branches`, {
    method: "POST",
    body: JSON.stringify({ branch: { name: branchName, parent_id: parent.id } }),
  });
  branch = createdPayload.branch;
  created = true;
}
if (!branch?.id) throw new Error("Neon branch response did not include an id");

const endpointPayload = await request(
  `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branch.id)}/endpoints`,
);
let endpoint = (endpointPayload.endpoints ?? []).find((candidate) => candidate.type === "read_write");
if (!endpoint) {
  const createdEndpointPayload = await request(`/projects/${encodeURIComponent(projectId)}/endpoints`, {
    method: "POST",
    body: JSON.stringify({ endpoint: { branch_id: branch.id, type: "read_write" } }),
  });
  endpoint = createdEndpointPayload.endpoint;
}
if (!endpoint?.id) throw new Error("Neon branch does not have a read-write compute endpoint");

const uriPayload = await request(
  `/projects/${encodeURIComponent(projectId)}/connection_uri?branch_id=${encodeURIComponent(branch.id)}&endpoint_id=${encodeURIComponent(endpoint.id)}&database_name=${encodeURIComponent(databaseName)}&role_name=${encodeURIComponent(roleName)}&pooled=false`,
);
const databaseUrl = uriPayload.uri;
if (typeof databaseUrl !== "string" || !databaseUrl.startsWith("postgres")) throw new Error("Neon connection URI was not returned");

if (process.env.GITHUB_ACTIONS === "true") console.log(`::add-mask::${databaseUrl}`);
if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `DATABASE_URL=${databaseUrl}\n`, { encoding: "utf8", mode: 0o600 });
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `branch_id=${branch.id}\ncreated=${created}\nbranch_name=${branchName}\n`, { encoding: "utf8" });
}
console.log(`${created ? "created" : "verified"} Neon branch ${branchName}`);
