import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCustomAuthStagingDeploy,
} from "../../tooling/scripts/staging-custom-auth-patch.mjs";

const availabilityPath =
  "/api/v1/inventory/availability?variantId=018f1000-0000-7000-8000-000000000201&warehouseId=018f0000-0000-7000-8000-000000000402";

test("staging waits on an authenticated read before the MFA write journey", async () => {
  const original = await readFile(
    new URL(
      "../../tooling/scripts/deploy-custom-auth-staging.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const patched = buildCustomAuthStagingDeploy(original);
  const readiness = `await probe(baseUrl, "${availabilityPath}", '\"available\"', 200, { Cookie: account.cookie });`;
  const journey =
    'runMfaReservationJourney({\n      baseUrl, sessionCookie: account.cookie';

  assert.ok(patched.includes(readiness));
  assert.ok(patched.includes(journey));
  assert.ok(patched.indexOf(readiness) < patched.indexOf(journey));
  assert.match(patched, /for \(let attempt = 1; attempt <= 12; attempt \+= 1\)/u);
  assert.match(patched, /setTimeout\(resolve, 2_500\)/u);
  assert.equal(patched.match(/runMfaReservationJourney\(/gu)?.length, 1);
  assert.equal(readiness.includes("POST"), false);
  assert.equal(
    readiness.includes("/api/v1/inventory/reservations"),
    false,
  );
  assert.equal(readiness.includes("/release"), false);
});
