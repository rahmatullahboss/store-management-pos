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

{
  const path = "apps/api/src/staging-asymmetric-token.ts";
  const source = readFileSync(path, "utf8");
  const lines = source.split("\n");
  const indexes = lines
    .map((line, index) =>
      line.includes("publicJwk: RsaPublicJwk") && line.includes("Promise<CryptoKey>")
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
  if (indexes.length > 1) {
    throw new Error(`${path}: expected at most one single-line public import helper, found ${indexes.length}`);
  }
  if (indexes.length === 1) {
    const index = indexes[0];
    const line = lines[index];
    const match = /^\s*async function ([A-Za-z][A-Za-z0-9_]*)\(/u.exec(line);
    if (
      !match ||
      !line.includes("error: () => PlatformError") ||
      !line.trim().endsWith("{")
    ) {
      throw new Error(`${path}: public import helper declaration shape is invalid`);
    }
    const helperName = match[1];
    lines.splice(
      index,
      1,
      `async function ${helperName}(`,
      "  publicJwk: RsaPublicJwk,",
      "  error: () => PlatformError,",
      "): Promise<CryptoKey> {",
    );
    writeFileSync(path, lines.join("\n"));
  }
}

replaceExact(
  "tooling/scripts/staging-custom-auth-patch.mjs",
  `const actualRelations = "'auth_credentials','auth_sessions','auth_rate_limits','auth_events'";`,
  `const actualRelations = "'custom_auth_credentials','custom_auth_sessions','custom_auth_rate_limits','custom_auth_events'";`,
);

replaceExact(
  "tests/unit/staging-asymmetric-deployment.test.mjs",
  "/privateJwk|\\\"d\\\"|activeKid|previousKid/u",
  "/privateJwk|\"d\"|activeKid|previousKid/u",
);

{
  const path = "tests/unit/staging-asymmetric-deployment.test.mjs";
  const source = readFileSync(path, "utf8");
  const lines = source.split("\n");
  const rotateIndexes = lines
    .map((line, index) =>
      line.includes("assert.match") && line.includes("rotateStagingInternalTokenKeyset")
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
  if (rotateIndexes.length > 1) {
    throw new Error(`${path}: multiple long rotation assertions found`);
  }
  if (rotateIndexes.length === 1) {
    lines.splice(
      rotateIndexes[0],
      1,
      "    assert.match(",
      "      patchSource,",
      "      /rotateStagingInternalTokenKeyset\\(activeKeyPair, previousKeyPair, now\\)/u,",
      "    );",
    );
  }
  const workflowIndexes = lines
    .map((line, index) =>
      line.includes("assert.equal") && line.includes("Persistent Admin POS Staging")
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
  if (workflowIndexes.length > 1) {
    throw new Error(`${path}: multiple long workflow assertions found`);
  }
  if (workflowIndexes.length === 1) {
    lines.splice(
      workflowIndexes[0],
      1,
      "  assert.equal(",
      "    workflow.match(",
      "      /Persistent Admin POS Staging \\(asymmetric token lifecycle\\)/gu,",
      "    )?.length,",
      "    1,",
      "  );",
    );
  }
  writeFileSync(path, lines.join("\n"));
}

{
  const path = "tests/unit/staging-asymmetric-deployment.test.mjs";
  const source = readFileSync(path, "utf8");
  if (source.endsWith("\n}\n")) {
    writeFileSync(path, `${source.slice(0, -3)}\n});\n`);
  } else if (!source.endsWith("\n});\n")) {
    throw new Error(`${path}: bounded final test closure target mismatch`);
  }
}

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

{
  const path = "docs/architecture/staging/internal-token-key-lifecycle.md";
  const source = readFileSync(path, "utf8");
  const lines = source.split("\n");
  const trailingWhitespaceLines = lines.filter((line) => /[ \t]+$/u.test(line));
  if (trailingWhitespaceLines.length !== 1) {
    throw new Error(
      `${path}: expected one trailing-whitespace line, found ${trailingWhitespaceLines.length}`,
    );
  }
  writeFileSync(
    path,
    lines.map((line) => line.replace(/[ \t]+$/u, "")).join("\n"),
  );
}

const basePackage = execFileSync(
  "git",
  ["show", "6be2f1fdde595c2f4fa8080cac68b7932d042ada:package.json"],
  { encoding: "utf8" },
);
writeFileSync("package.json", basePackage);
unlinkSync(fileURLToPath(import.meta.url));
