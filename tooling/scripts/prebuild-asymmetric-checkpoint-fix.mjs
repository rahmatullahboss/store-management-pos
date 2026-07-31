import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sourcePath = "apps/api/src/staging-asymmetric-token.ts";
const source = readFileSync(sourcePath, "utf8");
const oldBlock = `  const signingInput = \`${"${headerSegment}.${payloadSegment}"}\`;
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    decodeBase64Url(signatureSegment, "Staging token signature is invalid"),
    encoder.encode(signingInput),
  );`;
const newBlock = `  const signingInput = \`${"${headerSegment}.${payloadSegment}"}\`;
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
  );`;

if (source.includes(oldBlock)) {
  writeFileSync(sourcePath, source.replace(oldBlock, newBlock));
} else if (!source.includes(newBlock)) {
  throw new Error("RS256 signature BufferSource compatibility target mismatch");
}

const basePackage = execFileSync(
  "git",
  ["show", "6be2f1fdde595c2f4fa8080cac68b7932d042ada:package.json"],
  { encoding: "utf8" },
);
writeFileSync("package.json", basePackage);
unlinkSync(fileURLToPath(import.meta.url));
