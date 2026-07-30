import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("report STF-0013 digest for manifest registration", async () => {
  const sql = await readFile(
    new URL(
      "../../database/modules/storefront/migrations/STF-0013-public-search-filters.sql",
      import.meta.url,
    ),
    "utf8",
  );
  console.log(
    `STF-0013 sha256 ${createHash("sha256").update(sql).digest("hex")}`,
  );
});
