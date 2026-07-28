import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const scriptPath = fileURLToPath(new URL("../../tests/integration/sql/mod-e-database-invariants.sql", import.meta.url));
await new Promise((resolve, reject) => {
  const child = spawn("psql", [connectionString, "-v", "ON_ERROR_STOP=1", "-f", scriptPath], {
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`psql invariant drill exited with ${code}`)));
});
console.log("MOD-E database invariant drill passed and rolled back");
