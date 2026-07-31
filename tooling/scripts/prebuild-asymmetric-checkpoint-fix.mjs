import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function replaceExact(path, oldValue, newValue) {
  const source = readFileSync(path, "utf8");
  const count = source.split(oldValue).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one compatibility target, found ${count}`);
  writeFileSync(path, source.replace(oldValue, newValue));
}

replaceExact(
  "apps/api/src/staging-asymmetric-token.ts",
  `  const signingInput = \`${"${headerSegment}.${payloadSegment}"}\`;
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    decodeBase64Url(signatureSegment, "Staging token signature is invalid"),
    encoder.encode(signingInput),
  );`,
  `  const signingInput = \`${"${headerSegment}.${payloadSegment}"}\`;
  const decodedSignature = decodeBase64Url(
    signatureSegment,
    "Staging token signature is invalid",
  );
  const signature = new Uint8Array(decodedSignature.byteLength);
  signature.set(decodedSignature);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    signature.buffer,
    encoder.encode(signingInput),
  );`,
);

replaceExact(
  "tests/unit/staging-asymmetric-deployment.test.mjs",
  "/privateJwk|\\\"d\\\"|activeKid|previousKid/u",
  "/privateJwk|\"d\"|activeKid|previousKid/u",
);

replaceExact(
  "tests/unit/staging-asymmetric-deployment.test.mjs",
  `  assert.match(lifecycle, /KMS\/HSM-backed non-exportable private keys/u);
  assert.match(lifecycle, /Artifacts and workflow summaries may contain only algorithm/u);
}`,
  `  assert.match(lifecycle, /KMS\/HSM-backed non-exportable private keys/u);
  assert.match(lifecycle, /Artifacts and workflow summaries may contain only algorithm/u);
});`,
);

replaceExact(
  "tests/unit/staging-operational-release.test.mjs",
  `  const runner = await source("tooling/scripts/run-custom-auth-staging.mjs");
  const deploy = await source("tooling/scripts/deploy-custom-auth-staging.mjs");
  const evidenceSources = \`${"${runner}\\n${deploy}"}\`;`,
  `  const runner = await source("tooling/scripts/run-custom-auth-staging.mjs");
  const deploy = await source("tooling/scripts/deploy-custom-auth-staging.mjs");
  const patcher = await source("tooling/scripts/staging-custom-auth-patch.mjs");
  const evidenceSources = \`${"${runner}\\n${deploy}\\n${patcher}"}\`;`,
);

replaceExact(
  "tests/unit/staging-operational-release.test.mjs",
  "  assert.match(status, /schema_version: 14/u);",
  `  assert.match(status, /schema_version: 15/u);
  assert.match(status, /status: asymmetric_internal_token_implemented_pending_live_evidence/u);
  assert.match(status, /signing_algorithm: RS256/u);
  assert.match(status, /key_id_required: true/u);
  assert.ok(status.includes("public_jwks_path: /internal-identity/.well-known/jwks.json"));
  assert.match(status, /private_key_published: false/u);`,
);

const basePackage = execFileSync(
  "git",
  ["show", "6be2f1fdde595c2f4fa8080cac68b7932d042ada:package.json"],
  { encoding: "utf8" },
);
writeFileSync("package.json", basePackage);
unlinkSync(fileURLToPath(import.meta.url));
