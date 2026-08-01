import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("provider signing boundary cannot import or export private key material", async () => {
  const source = await readFile(
    new URL("../../tooling/scripts/internal-token-provider-signing.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /executeAuditedInternalTokenProviderSigning/u);
  assert.match(source, /await signer\.sign/u);
  assert.match(source, /exactKeys\(value, \["sign"\], "provider"\)/u);
  assert.match(source, /nonExportable !== true/u);
  assert.match(source, /hardwareProtected !== true/u);
  assert.match(source, /auditReferencePresent: true/u);
  assert.match(source, /identifiersIncluded: false/u);
  assert.match(source, /signingInputIncluded: false/u);
  assert.match(source, /signatureIncluded: false/u);
  assert.match(source, /receiptDigestsIncluded: false/u);
  assert.doesNotMatch(source, /crypto\.subtle\.(?:importKey|exportKey)/u);
  assert.doesNotMatch(source, /privateJwk|privateKey|serializedKeyset/u);
});
