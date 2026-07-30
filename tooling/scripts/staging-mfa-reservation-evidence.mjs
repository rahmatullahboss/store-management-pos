import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const TENANT_ID = "018f0000-0000-7000-8000-000000000002";
const WAREHOUSE_ID = "018f0000-0000-7000-8000-000000000402";
const VARIANT_ID = "018f1000-0000-7000-8000-000000000201";
const STEP_UP_COOKIE = "ozzyl_staging_step_up";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function responseCookies(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";", 1)[0]);
}

function mergeCookies(...headers) {
  const values = new Map();
  for (const header of headers) {
    if (!header) continue;
    const entries = Array.isArray(header) ? header : header.split(";");
    for (const entry of entries) {
      const [name, ...parts] = entry.trim().split("=");
      if (!name || parts.length === 0) continue;
      values.set(name, parts.join("="));
    }
  }
  return [...values.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function base32Decode(value) {
  const normalized = value.replaceAll(" ", "").toUpperCase().replace(/=+$/u, "");
  if (!/^[A-Z2-7]{16,128}$/u.test(normalized)) {
    throw new Error("MFA enrollment returned an invalid secret encoding");
  }
  const output = [];
  let bits = 0;
  let buffer = 0;
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("MFA enrollment returned an invalid secret encoding");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function hotp(secret, counter) {
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(input).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary =
    ((digest[offset] & 127) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}

async function safeTotpCounter() {
  for (;;) {
    const seconds = Math.floor(Date.now() / 1_000);
    const within = seconds % 30;
    if (within >= 5 && within <= 15) return Math.floor(seconds / 30);
    const waitSeconds = within < 5 ? 5 - within : 35 - within;
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1_000));
  }
}

async function postForm(baseUrl, pathname, cookie, fields) {
  return await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: baseUrl,
      "sec-fetch-site": "same-origin",
      "user-agent": "Ozzyl-Staging-MFA-Evidence/1.0",
    },
    body: new URLSearchParams(fields),
  });
}

async function jsonRequest(baseUrl, pathname, cookie, method = "GET", body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    redirect: "manual",
    headers: {
      cookie,
      origin: baseUrl,
      "sec-fetch-site": "same-origin",
      "user-agent": "Ozzyl-Staging-MFA-Evidence/1.0",
      ...(body === undefined ? {} : { "content-type": "application/json; charset=utf-8" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let parsed = null;
  const text = await response.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return { response, body: parsed };
}

function exactAmount(value, label) {
  const amount = value?.amount;
  if (typeof amount !== "string" || !/^-?\d+(?:\.\d+)?$/u.test(amount)) {
    throw new Error(`${label} did not return an exact quantity`);
  }
  return BigInt(amount);
}

async function databaseEvidence(connectionString, reservationId, secretText) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT
         reservation.state,
         reservation.version::text,
         line.reserved_quantity::text,
         line.released_quantity::text,
         (SELECT count(*)::int
            FROM platform.audit_events
           WHERE tenant_id = reservation.tenant_id
             AND target_type = 'stock_reservation'
             AND target_id = reservation.id::text
             AND event_type LIKE 'inventory.reservation.%.v1') AS audit_events,
         (SELECT count(*)::int
            FROM platform.outbox_events
           WHERE tenant_id = reservation.tenant_id
             AND aggregate_type = 'stock_reservation'
             AND aggregate_id = reservation.id::text
             AND event_type LIKE 'inventory.reservation.%.v1') AS outbox_events,
         (SELECT count(*)::int
            FROM platform.auth_step_up_grants AS grant_row
            JOIN platform.auth_sessions AS session_row ON session_row.id = grant_row.session_id
            JOIN platform.users AS user_row ON user_row.id = session_row.user_id
           WHERE user_row.email_normalized = $3
             AND grant_row.permission_scope = 'inventory.reservation.manage'
             AND grant_row.used_at IS NOT NULL) AS used_grants,
         (SELECT count(*)::int
            FROM platform.auth_mfa_factors AS factor
            JOIN platform.users AS user_row ON user_row.id = factor.user_id
           WHERE user_row.email_normalized = $3
             AND factor.status = 'active'
             AND factor.secret_ciphertext <> ''
             AND factor.secret_ciphertext <> $4) AS encrypted_factors
       FROM inventory.stock_reservations AS reservation
       JOIN inventory.stock_reservation_lines AS line
         ON line.tenant_id = reservation.tenant_id
        AND line.reservation_id = reservation.id
       WHERE reservation.tenant_id = $1::uuid
         AND reservation.id = $2::uuid`,
      [TENANT_ID, reservationId, globalThis.__stagingMfaEvidenceEmail, secretText],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Controlled reservation database evidence was not found");
    return {
      state: row.state,
      version: row.version,
      reserved: row.reserved_quantity,
      released: row.released_quantity,
      auditEvents: Number(row.audit_events),
      outboxEvents: Number(row.outbox_events),
      usedGrants: Number(row.used_grants),
      encryptedFactors: Number(row.encrypted_factors),
    };
  } finally {
    await client.end();
  }
}

export async function cleanupMfaReservationEvidence(connectionString, reservationId) {
  if (!reservationId) return false;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM inventory.stock_reservation_lines WHERE tenant_id = $1::uuid AND reservation_id = $2::uuid",
      [TENANT_ID, reservationId],
    );
    const result = await client.query(
      "DELETE FROM inventory.stock_reservations WHERE tenant_id = $1::uuid AND id = $2::uuid RETURNING id",
      [TENANT_ID, reservationId],
    );
    await client.query("COMMIT");
    return result.rowCount === 1;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

export async function runMfaReservationJourney({
  baseUrl,
  sessionCookie,
  password,
  email,
  connectionString,
  runId,
}) {
  let reservationId = "";
  globalThis.__stagingMfaEvidenceEmail = String(email).toLowerCase();
  try {
    const enrollment = await postForm(baseUrl, "/auth/mfa/enroll", sessionCookie, {
      label: "CI authenticator",
      password,
    });
    if (enrollment.status !== 200) {
      throw new Error(`MFA enrollment failed with HTTP ${enrollment.status}`);
    }
    const enrollmentHtml = await enrollment.text();
    const secretMatch = /<code>([A-Z2-7]{32})<\/code>/u.exec(enrollmentHtml);
    if (!secretMatch?.[1]) throw new Error("MFA enrollment did not expose a one-time secret");
    const secretText = secretMatch[1];
    const secret = base32Decode(secretText);
    const baseCounter = await safeTotpCounter();

    const confirmation = await postForm(baseUrl, "/auth/mfa/confirm", sessionCookie, {
      password,
      code: hotp(secret, baseCounter - 1),
    });
    if (confirmation.status !== 303) {
      throw new Error(`MFA confirmation failed with HTTP ${confirmation.status}`);
    }

    const status = await jsonRequest(baseUrl, "/auth/mfa/status", sessionCookie);
    if (status.response.status !== 200 || status.body?.enrolled !== true) {
      throw new Error("MFA active-factor status verification failed");
    }

    const firstStepUp = await postForm(baseUrl, "/auth/mfa/step-up", sessionCookie, {
      password,
      code: hotp(secret, baseCounter),
      returnTo: "/admin/inventory/reservations",
    });
    const firstStepCookie = responseCookies(firstStepUp).find((value) => value.startsWith(`${STEP_UP_COOKIE}=`));
    if (firstStepUp.status !== 303 || !firstStepCookie) {
      throw new Error(`First MFA step-up failed with HTTP ${firstStepUp.status}`);
    }
    const firstCommandCookie = mergeCookies(sessionCookie, firstStepCookie);

    const availabilityPath = `/api/v1/inventory/availability?variantId=${VARIANT_ID}&warehouseId=${WAREHOUSE_ID}`;
    const before = await jsonRequest(baseUrl, availabilityPath, sessionCookie);
    if (before.response.status !== 200) throw new Error("Initial availability probe failed");
    const beforeAvailable = exactAmount(before.body?.available, "Initial availability");
    const beforeReserved = exactAmount(before.body?.reserved, "Initial reserved quantity");

    reservationId = randomUUID();
    const sourceId = `mfa-evidence-${runId || Date.now()}-${randomBytes(4).toString("hex")}`;
    const create = await jsonRequest(
      baseUrl,
      "/api/v1/inventory/reservations",
      firstCommandCookie,
      "POST",
      {
        id: reservationId,
        sourceId,
        lines: [{
          id: randomUUID(),
          variantId: VARIANT_ID,
          warehouseId: WAREHOUSE_ID,
          quantity: { amount: "1", unit: "EACH", scale: 0 },
        }],
      },
    );
    if (
      create.response.status !== 201 ||
      create.body?.id !== reservationId ||
      create.body?.state !== "fully_reserved" ||
      create.body?.version !== "1"
    ) {
      throw new Error(`Controlled reservation create failed with HTTP ${create.response.status}`);
    }

    const replay = await jsonRequest(
      baseUrl,
      "/api/v1/inventory/reservations",
      firstCommandCookie,
      "POST",
      {
        id: randomUUID(),
        sourceId: `${sourceId}-replay`,
        lines: [{
          id: randomUUID(),
          variantId: VARIANT_ID,
          warehouseId: WAREHOUSE_ID,
          quantity: { amount: "1", unit: "EACH", scale: 0 },
        }],
      },
    );
    if (replay.response.status !== 403 || replay.body?.error?.code !== "PERMISSION_DENIED") {
      throw new Error("Consumed step-up grant replay was not rejected");
    }

    const during = await jsonRequest(baseUrl, availabilityPath, sessionCookie);
    if (during.response.status !== 200) throw new Error("Reserved availability probe failed");
    const duringAvailable = exactAmount(during.body?.available, "Reserved availability");
    const duringReserved = exactAmount(during.body?.reserved, "Reserved quantity");
    if (duringAvailable !== beforeAvailable - 1n || duringReserved !== beforeReserved + 1n) {
      throw new Error("Reservation did not reconcile against availability");
    }

    const secondStepUp = await postForm(baseUrl, "/auth/mfa/step-up", sessionCookie, {
      password,
      code: hotp(secret, baseCounter + 1),
      returnTo: "/admin/inventory/reservations",
    });
    const secondStepCookie = responseCookies(secondStepUp).find((value) => value.startsWith(`${STEP_UP_COOKIE}=`));
    if (secondStepUp.status !== 303 || !secondStepCookie) {
      throw new Error(`Second MFA step-up failed with HTTP ${secondStepUp.status}`);
    }
    const release = await jsonRequest(
      baseUrl,
      `/api/v1/inventory/reservations/${reservationId}/release`,
      mergeCookies(sessionCookie, secondStepCookie),
      "POST",
      { expectedVersion: 1 },
    );
    if (
      release.response.status !== 200 ||
      release.body?.id !== reservationId ||
      release.body?.state !== "released" ||
      release.body?.version !== "2"
    ) {
      throw new Error(`Controlled reservation release failed with HTTP ${release.response.status}`);
    }

    const after = await jsonRequest(baseUrl, availabilityPath, sessionCookie);
    if (after.response.status !== 200) throw new Error("Released availability probe failed");
    if (
      exactAmount(after.body?.available, "Released availability") !== beforeAvailable ||
      exactAmount(after.body?.reserved, "Released reserved quantity") !== beforeReserved
    ) {
      throw new Error("Release did not restore availability");
    }

    const database = await databaseEvidence(connectionString, reservationId, secretText);
    if (
      database.state !== "released" ||
      database.version !== "2" ||
      database.reserved !== database.released ||
      database.auditEvents < 2 ||
      database.outboxEvents < 2 ||
      database.usedGrants < 2 ||
      database.encryptedFactors !== 1
    ) {
      throw new Error("MFA reservation database evidence is incomplete");
    }

    return {
      reservationId,
      report: {
        provider: "totp",
        passwordRecheck: true,
        encryptedAtRest: true,
        replayRejected: true,
        singleUseGrants: true,
        grantLifetimeSeconds: 300,
        commandTokenLifetimeSeconds: 60,
        permission: "inventory.reservation.manage",
        createPassed: true,
        releasePassed: true,
        availabilityReconciled: true,
        auditEvents: database.auditEvents,
        outboxEvents: database.outboxEvents,
        usedGrants: database.usedGrants,
      },
    };
  } catch (error) {
    if (reservationId) {
      try {
        await cleanupMfaReservationEvidence(connectionString, reservationId);
      } catch {
        // Preserve the primary failure; account cleanup remains independent.
      }
    }
    throw error;
  } finally {
    delete globalThis.__stagingMfaEvidenceEmail;
  }
}
