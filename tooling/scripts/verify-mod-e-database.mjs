import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const scripts = [
  "../../tests/integration/sql/mod-e-database-invariants.sql",
  "../../tests/integration/sql/mod-e-payment-lifecycle.sql",
  "../../tests/integration/sql/mod-e-accounting-lifecycle.sql",
  "../../tests/integration/sql/mod-e-banking-lifecycle.sql",
  "../../tests/integration/sql/mod-e-finance-readiness.sql",
].map((relative) => fileURLToPath(new URL(relative, import.meta.url)));

for (const scriptPath of scripts) {
  await new Promise((resolve, reject) => {
    const child = spawn("psql", [connectionString, "-v", "ON_ERROR_STOP=1", "-f", scriptPath], {
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`psql drill exited with ${code}: ${scriptPath}`)));
  });
}
console.log("MOD-E database invariant, payment, accounting, banking, and finance-readiness drills passed and rolled back");
