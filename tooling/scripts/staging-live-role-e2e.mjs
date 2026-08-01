import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";

import {
  ADMIN_ROLE_MATRIX_ROUTES,
  CROSS_ROLE_P0_JOURNEYS,
  E2E_PERSONAS,
} from "../fixtures/main-web-role-matrix.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const artifactDirectory = path.join(root, "artifacts", "staging");
const reportPath = path.join(artifactDirectory, "live-role-e2e-report.json");
const baseUrl = process.env.STAGING_BASE_URL ?? "https://store-pos-staging.rahmatullahzisan.workers.dev";
const databaseUrl = process.env.DATABASE_URL;
const runTag = `${process.env.GITHUB_RUN_ID ?? Date.now()}-${randomBytes(4).toString("hex")}`;

if (!databaseUrl) throw new Error("DATABASE_URL is required for live role E2E");
await mkdir(artifactDirectory, { recursive: true });

const accounts = [];
const routeResults = [];
const contextResults = [];
const primaryResults = [];
const journeyResults = [];
let permissionRevocation = { passed: false };
let sessionRevocation = { passed: false };
let ambiguousRole = { passed: false };
let crossTenantScope = { passed: false };
let cleanup = { accountsRemoved: 0, rolesRemoved: 0 };
let primaryError = null;

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function tokenFromCookie(cookie) {
  const match = /(?:^|;\s*)ozzyl_staging_session=([A-Za-z0-9_-]{43})(?:;|$)/u.exec(cookie);
  if (!match) throw new Error("Opaque staging session cookie is missing");
  return match[1];
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("base64url");
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function leakMarkers(body) {
  const lowered = body.toLowerCase();
  return [
    "postgresql://",
    "database_url",
    "private_key",
    "begin private key",
    "authorization: bearer",
  ].filter((marker) => lowered.includes(marker));
}

function safeError(error) {
  let message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  message = message.replaceAll(databaseUrl, "[REDACTED_DATABASE_URL]");
  for (const account of accounts) {
    message = message
      .replaceAll(account.email, "[REDACTED_EMAIL]")
      .replaceAll(account.password, "[REDACTED_PASSWORD]")
      .replaceAll(account.cookie ?? "__never__", "[REDACTED_COOKIE]");
  }
  return message.slice(0, 1200);
}

async function signUp(account) {
  const response = await fetch(`${baseUrl}/auth/sign-up`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: baseUrl,
      "sec-fetch-site": "same-origin",
      "user-agent": "Ozzyl-Live-Role-E2E/1.0",
    },
    body: new URLSearchParams({
      name: account.displayName,
      email: account.email,
      password: account.password,
      returnTo: "/admin",
    }),
  });
  if (response.status !== 303 || !cookieHeader(response).includes("ozzyl_staging_session=")) {
    throw new Error(`Role E2E sign-up returned HTTP ${response.status}`);
  }
}

async function signIn(account) {
  const response = await fetch(`${baseUrl}/auth/sign-in`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: baseUrl,
      "sec-fetch-site": "same-origin",
      "user-agent": "Ozzyl-Live-Role-E2E/1.0",
    },
    body: new URLSearchParams({
      email: account.email,
      password: account.password,
      returnTo: "/admin",
    }),
  });
  const cookie = cookieHeader(response);
  if (response.status !== 303 || !cookie.includes("ozzyl_staging_session=")) {
    throw new Error(`Role E2E sign-in returned HTTP ${response.status}`);
  }
  return cookie;
}

async function assignPersonaRole(client, account, persona) {
  await client.query("BEGIN");
  try {
    const identity = await client.query(
      `SELECT u.id AS user_id, m.id AS membership_id, m.tenant_id
       FROM platform.users AS u
       JOIN platform.memberships AS m ON m.user_id = u.id AND m.status = 'active'
       WHERE u.email_normalized = $1 AND u.status = 'active'
       FOR UPDATE OF m`,
      [account.email.toLowerCase()],
    );
    const row = identity.rows[0];
    if (!row) throw new Error(`No active membership for ${persona.id}`);

    const legal = await client.query(
      "SELECT id FROM platform.legal_entities WHERE tenant_id = $1::uuid AND status = 'active' ORDER BY code LIMIT 1",
      [row.tenant_id],
    );
    const legalEntityId = legal.rows[0]?.id;
    const store = await client.query(
      "SELECT id FROM platform.stores WHERE tenant_id = $1::uuid AND legal_entity_id = $2::uuid AND status = 'active' ORDER BY code LIMIT 1",
      [row.tenant_id, legalEntityId],
    );
    const storeId = store.rows[0]?.id;
    const warehouse = await client.query(
      "SELECT id FROM platform.warehouses WHERE tenant_id = $1::uuid AND legal_entity_id = $2::uuid AND store_id = $3::uuid AND status = 'active' ORDER BY code LIMIT 1",
      [row.tenant_id, legalEntityId, storeId],
    );
    const warehouseId = warehouse.rows[0]?.id;
    const register = await client.query(
      "SELECT id FROM platform.registers WHERE tenant_id = $1::uuid AND store_id = $2::uuid AND status = 'active' ORDER BY code LIMIT 1",
      [row.tenant_id, storeId],
    );
    const registerId = register.rows[0]?.id;
    if (!legalEntityId || !storeId || !warehouseId || !registerId) {
      throw new Error(`Scoped staging fixtures are incomplete for ${persona.id}`);
    }

    const requestedPermissions = sortedUnique(persona.permissions);
    const existingPermissions = await client.query(
      "SELECT code FROM platform.permissions WHERE code = ANY($1::text[]) ORDER BY code",
      [requestedPermissions],
    );
    const registeredPermissions = existingPermissions.rows.map((permission) => permission.code);
    if (JSON.stringify(registeredPermissions) !== JSON.stringify(requestedPermissions)) {
      const missing = requestedPermissions.filter((permission) => !registeredPermissions.includes(permission));
      throw new Error(`Persona ${persona.id} references unregistered permissions: ${missing.join(",")}`);
    }

    const roleCode = `e2e-${persona.id}-${runTag}`;
    const role = await client.query(
      `INSERT INTO platform.roles(id, tenant_id, code, display_name, system_role)
       VALUES (gen_random_uuid(), $1::uuid, $2, $3, false)
       RETURNING id`,
      [row.tenant_id, roleCode, `Live E2E ${persona.displayName}`],
    );
    const roleId = role.rows[0]?.id;
    if (!roleId) throw new Error(`Role creation failed for ${persona.id}`);

    await client.query(
      `INSERT INTO platform.role_permissions(role_id, permission_code)
       SELECT $1::uuid, code FROM platform.permissions WHERE code = ANY($2::text[])`,
      [roleId, requestedPermissions],
    );
    await client.query(
      "DELETE FROM platform.membership_roles WHERE tenant_id = $1::uuid AND membership_id = $2::uuid",
      [row.tenant_id, row.membership_id],
    );
    await client.query(
      `INSERT INTO platform.membership_roles(
         id, tenant_id, membership_id, role_id, legal_entity_id, store_id, warehouse_id, register_id, granted_by
       ) VALUES (
         gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, NULL
       )`,
      [row.tenant_id, row.membership_id, roleId, legalEntityId, storeId, warehouseId, registerId],
    );
    await client.query("COMMIT");
    return {
      userId: row.user_id,
      membershipId: row.membership_id,
      tenantId: row.tenant_id,
      roleId,
      roleCode,
      scope: { legalEntityId, storeId, warehouseId, registerId },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function getContext(cookie) {
  const response = await fetch(`${baseUrl}/auth/context`, {
    redirect: "manual",
    headers: { Cookie: cookie, "x-staging-smoke": process.env.GITHUB_RUN_ID ?? "manual" },
  });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body };
}

async function checkRoute(account, route, expectedStatus) {
  const pathname = `/admin${route.renderPath}`;
  const response = await fetch(`${baseUrl}${pathname}`, {
    redirect: "manual",
    headers: { Cookie: account.cookie, "x-staging-smoke": process.env.GITHUB_RUN_ID ?? "manual" },
  });
  const body = await response.text();
  const denied = body.includes("data-permission-denied");
  const leaks = leakMarkers(body);
  const passed = response.status === expectedStatus
    && denied === (expectedStatus === 403)
    && leaks.length === 0;
  return {
    persona: account.persona.id,
    route: route.id,
    permission: route.permission,
    expectedStatus,
    status: response.status,
    denied,
    leaks,
    passed,
  };
}

async function checkPath(account, pathname, expectedStatus) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    redirect: "manual",
    headers: { Cookie: account.cookie, "x-staging-smoke": process.env.GITHUB_RUN_ID ?? "manual" },
  });
  const body = await response.text();
  return {
    status: response.status,
    passed: response.status === expectedStatus && leakMarkers(body).length === 0,
  };
}

async function cleanupAccount(client, account) {
  await client.query("BEGIN");
  try {
    const users = await client.query(
      "SELECT id FROM platform.users WHERE email_normalized = $1 FOR UPDATE",
      [account.email.toLowerCase()],
    );
    for (const user of users.rows) {
      await client.query("DELETE FROM platform.memberships WHERE user_id = $1::uuid", [user.id]);
      await client.query("DELETE FROM platform.users WHERE id = $1::uuid", [user.id]);
    }
    let roleRemoved = 0;
    if (account.assignment?.roleId) {
      const removed = await client.query(
        "DELETE FROM platform.roles WHERE id = $1::uuid RETURNING id",
        [account.assignment.roleId],
      );
      roleRemoved = removed.rowCount ?? removed.rows.length;
    }
    await client.query("COMMIT");
    return { accountRemoved: users.rowCount ?? users.rows.length, roleRemoved };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  for (const persona of E2E_PERSONAS) {
    const account = {
      persona,
      displayName: persona.displayName,
      email: `role-e2e-${persona.id}-${runTag}@example.com`,
      password: `Role-${randomBytes(20).toString("base64url")}!9a`,
      cookie: null,
      assignment: null,
    };
    accounts.push(account);
    await signUp(account);
    account.assignment = await assignPersonaRole(client, account, persona);
    account.cookie = await signIn(account);

    const context = await getContext(account.cookie);
    const expectedPermissions = sortedUnique(persona.permissions);
    const observedPermissions = sortedUnique(context.body?.context?.permissions ?? []);
    const contextPassed = context.status === 200
      && context.body?.authenticated === true
      && context.body?.roleResolution === "single-scoped-database-role"
      && context.body?.context?.role === account.assignment.roleCode
      && JSON.stringify(observedPermissions) === JSON.stringify(expectedPermissions)
      && context.body?.context?.scope?.legalEntityId === account.assignment.scope.legalEntityId
      && context.body?.context?.scope?.storeId === account.assignment.scope.storeId
      && context.body?.context?.scope?.warehouseId === account.assignment.scope.warehouseId
      && context.body?.context?.scope?.registerId === account.assignment.scope.registerId;
    contextResults.push({ persona: persona.id, status: context.status, permissionCount: observedPermissions.length, passed: contextPassed });
    if (!contextPassed) throw new Error(`Database RBAC context failed for ${persona.id}`);

    const permissionSet = new Set(persona.permissions);
    for (const route of ADMIN_ROLE_MATRIX_ROUTES) {
      const expectedStatus = permissionSet.has(route.permission) ? 200 : 403;
      const result = await checkRoute(account, route, expectedStatus);
      routeResults.push(result);
      if (!result.passed) {
        throw new Error(`Live role route failed for ${persona.id}/${route.id}: expected ${expectedStatus}, received ${result.status}`);
      }
    }

    const missing = await checkPath(account, "/admin/__live-role-e2e-not-found__", 404);
    if (!missing.passed) throw new Error(`Unknown route did not fail closed for ${persona.id}`);

    const primaryPath = persona.primarySurface === "pos" ? "/pos" : `/admin${persona.primaryPath}`;
    const primary = await checkPath(account, primaryPath, 200);
    primaryResults.push({ persona: persona.id, primaryPath, status: primary.status, passed: primary.passed });
    if (!primary.passed) throw new Error(`Primary role surface failed for ${persona.id}`);
  }

  for (const journey of CROSS_ROLE_P0_JOURNEYS) {
    const steps = [];
    for (const personaId of journey.personas) {
      const account = accounts.find((candidate) => candidate.persona.id === personaId);
      if (!account) throw new Error(`Journey ${journey.id} references missing persona ${personaId}`);
      const pathname = account.persona.primarySurface === "pos" ? "/pos" : `/admin${account.persona.primaryPath}`;
      const result = await checkPath(account, pathname, 200);
      steps.push({ persona: personaId, status: result.status, passed: result.passed });
    }
    const passed = steps.every((step) => step.passed);
    journeyResults.push({ id: journey.id, steps, passed });
    if (!passed) throw new Error(`Cross-role surface journey failed for ${journey.id}`);
  }

  const manager = accounts.find((account) => account.persona.id === "store-manager");
  if (!manager) throw new Error("Store manager role fixture is missing");
  await client.query(
    "DELETE FROM platform.role_permissions WHERE role_id = $1::uuid AND permission_code = 'pricing.promotion.manage'",
    [manager.assignment.roleId],
  );
  const managerContext = await getContext(manager.cookie);
  const revokedRoute = await checkPath(manager, "/admin/pricing/promotions", 403);
  permissionRevocation = {
    contextStatus: managerContext.status,
    permissionRemoved: !managerContext.body?.context?.permissions?.includes("pricing.promotion.manage"),
    routeStatus: revokedRoute.status,
    passed: managerContext.status === 200
      && !managerContext.body?.context?.permissions?.includes("pricing.promotion.manage")
      && revokedRoute.passed,
  };
  if (!permissionRevocation.passed) throw new Error("Permission revocation was not effective without re-login");

  const owner = accounts.find((account) => account.persona.id === "business-owner");
  if (!owner) throw new Error("Business owner role fixture is missing");
  const secondaryRole = await client.query(
    `INSERT INTO platform.roles(id, tenant_id, code, display_name, system_role)
     VALUES (gen_random_uuid(), $1::uuid, $2, 'Live E2E ambiguous secondary role', false)
     RETURNING id`,
    [owner.assignment.tenantId, `e2e-ambiguous-${runTag}`],
  );
  const secondaryRoleId = secondaryRole.rows[0]?.id;
  await client.query(
    "INSERT INTO platform.role_permissions(role_id, permission_code) VALUES ($1::uuid, 'catalog.product.read')",
    [secondaryRoleId],
  );
  await client.query(
    `INSERT INTO platform.membership_roles(
       id, tenant_id, membership_id, role_id, legal_entity_id, store_id, warehouse_id, register_id, granted_by
     ) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, NULL)`,
    [
      owner.assignment.tenantId,
      owner.assignment.membershipId,
      secondaryRoleId,
      owner.assignment.scope.legalEntityId,
      owner.assignment.scope.storeId,
      owner.assignment.scope.warehouseId,
      owner.assignment.scope.registerId,
    ],
  );
  const ambiguousContext = await getContext(owner.cookie);
  ambiguousRole = { status: ambiguousContext.status, passed: ambiguousContext.status === 403 };
  await client.query("DELETE FROM platform.membership_roles WHERE role_id = $1::uuid", [secondaryRoleId]);
  await client.query("DELETE FROM platform.roles WHERE id = $1::uuid", [secondaryRoleId]);
  if (!ambiguousRole.passed) throw new Error("Ambiguous role assignment did not fail closed");

  const otherTenantStore = await client.query(
    `SELECT s.id
     FROM platform.stores AS s
     WHERE s.tenant_id <> $1::uuid AND s.status = 'active'
     ORDER BY s.code
     LIMIT 1`,
    [owner.assignment.tenantId],
  );
  const foreignStoreId = otherTenantStore.rows[0]?.id;
  if (!foreignStoreId) throw new Error("Cross-tenant scope fixture is unavailable");
  let foreignKeyRejected = false;
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO platform.membership_roles(
         id, tenant_id, membership_id, role_id, store_id, granted_by
       ) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, NULL)`,
      [owner.assignment.tenantId, owner.assignment.membershipId, owner.assignment.roleId, foreignStoreId],
    );
    await client.query("ROLLBACK");
  } catch (error) {
    foreignKeyRejected = error?.code === "23503";
    await client.query("ROLLBACK");
  }
  crossTenantScope = { foreignKeyRejected, passed: foreignKeyRejected };
  if (!crossTenantScope.passed) throw new Error("Cross-tenant role scope was not rejected");

  const cashier = accounts.find((account) => account.persona.id === "cashier");
  if (!cashier) throw new Error("Cashier role fixture is missing");
  const cashierToken = tokenFromCookie(cashier.cookie);
  const revokedSession = await client.query(
    "UPDATE platform.auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id",
    [hashToken(cashierToken)],
  );
  const revokedContext = await getContext(cashier.cookie);
  sessionRevocation = {
    sessionsRevoked: revokedSession.rowCount ?? revokedSession.rows.length,
    contextStatus: revokedContext.status,
    passed: (revokedSession.rowCount ?? revokedSession.rows.length) === 1 && revokedContext.status === 403,
  };
  if (!sessionRevocation.passed) throw new Error("Session revocation did not invalidate live role context");
} catch (error) {
  primaryError = error;
} finally {
  for (const account of [...accounts].reverse()) {
    try {
      const result = await cleanupAccount(client, account);
      cleanup.accountsRemoved += result.accountRemoved;
      cleanup.rolesRemoved += result.roleRemoved;
    } catch (error) {
      if (!primaryError) primaryError = error;
    }
  }
  await client.end();

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: primaryError ? "failed" : "passed",
    syntheticDataOnly: true,
    personaCount: E2E_PERSONAS.length,
    routeCount: ADMIN_ROLE_MATRIX_ROUTES.length,
    contextResults,
    routeResults,
    primaryResults,
    journeyResults,
    permissionRevocation,
    sessionRevocation,
    ambiguousRole,
    crossTenantScope,
    cleanup,
    summary: {
      contextsPassed: contextResults.filter((result) => result.passed).length,
      contextsTotal: contextResults.length,
      routeAssertionsPassed: routeResults.filter((result) => result.passed).length,
      routeAssertionsTotal: routeResults.length,
      primarySurfacesPassed: primaryResults.filter((result) => result.passed).length,
      primarySurfacesTotal: primaryResults.length,
      journeySurfacesPassed: journeyResults.filter((result) => result.passed).length,
      journeySurfacesTotal: journeyResults.length,
    },
    ...(primaryError ? { error: safeError(primaryError) } : {}),
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (primaryError) throw primaryError;
console.log(
  `Live database role E2E passed ${routeResults.filter((result) => result.passed).length}/${routeResults.length} route assertions across ${contextResults.length} real custom-auth role contexts`,
);
