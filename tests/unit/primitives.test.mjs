import test from "node:test";
import assert from "node:assert/strict";
import { uuidV7 } from "../../build/packages/foundation/src/ids.js";
import { addMoney, formatMoneyExact, money } from "../../build/packages/foundation/src/money.js";
import { addQuantity, quantity } from "../../build/packages/foundation/src/quantity.js";
import { businessDate, locale, timeZone } from "../../build/packages/foundation/src/localization.js";

test("UUIDv7 encodes time, version and variant", () => {
  const id = uuidV7(1_700_000_000_000, Uint8Array.from([1,2,3,4,5,6,7,8,9,10]));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(uuidV7(1_700_000_000_000, Uint8Array.from([1,2,3,4,5,6,7,8,9,10])), id);
});

test("Money and Quantity remain exact", () => {
  const total = addMoney(money(10n, "GBP", 2), money(20n, "GBP", 2));
  assert.equal(total.amountMinor, 30n);
  assert.equal(formatMoneyExact(total), "0.30 GBP");
  assert.throws(() => addMoney(total, money(1n, "BDT", 2)));
  assert.equal(addQuantity(quantity(1000000n, "EA", 6), quantity(500000n, "EA", 6)).amount, 1500000n);
});

test("Locale, timezone and business date reject invalid values", () => {
  assert.equal(locale("bn-BD"), "bn-BD");
  assert.equal(timeZone("Asia/Dhaka"), "Asia/Dhaka");
  assert.equal(businessDate("2026-07-28"), "2026-07-28");
  assert.throws(() => businessDate("2026-02-31"));
  assert.throws(() => timeZone("Invalid/Zone"));
});
