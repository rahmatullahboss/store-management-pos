import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsDir = fileURLToPath(new URL(".", import.meta.url));
const sourcePath = path.join(scriptsDir, "neon-recovery-ci.mjs");
const runtimePath = path.join(scriptsDir, `.neon-recovery-runtime-${process.pid}.mjs`);
const source = await readFile(sourcePath, "utf8");
const unsupportedProjectDefaults = /,\n\s*default_endpoint_settings: \{\n\s*autoscaling_limit_min_cu: 0\.25,\n\s*autoscaling_limit_max_cu: 0\.25,\n\s*suspend_timeout_seconds: 60\n\s*\}/u;
const runtimeSource = source.replace(unsupportedProjectDefaults, "");
if (runtimeSource === source) throw new Error("Neon recovery plan-compatibility transformation did not match the expected project settings");

try {
  await writeFile(runtimePath, runtimeSource, "utf8");
  await import(`${pathToFileURL(runtimePath).href}?run=${Date.now()}`);
} finally {
  await rm(runtimePath, { force: true });
}
