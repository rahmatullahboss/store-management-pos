import assert from "node:assert/strict";
import test from "node:test";
import {
  BANGLADESH_COUNTRY_PACK,
  BANGLADESH_SUPPORT_MATRIX,
  BUILTIN_COUNTRY_PACKS,
  SYNTHETIC_XZ_COUNTRY_PACK,
  SYNTHETIC_XZ_SUPPORT_MATRIX,
} from "../../build/modules/country-packs/src/fixtures.js";
import { validateCountryPackManifest } from "../../build/modules/country-packs/src/domain.js";

test("Bangladesh fixture is explicit about limited support and disabled unsupported fiscal paths", () => {
  assert.doesNotThrow(() => validateCountryPackManifest(BANGLADESH_COUNTRY_PACK));
  assert.equal(BANGLADESH_COUNTRY_PACK.countryCode, "BD");
  assert.equal(BANGLADESH_COUNTRY_PACK.defaultLocale, "bn-BD");
  assert.equal(BANGLADESH_COUNTRY_PACK.capabilities.fiscalSubmission, false);
  assert.equal(BANGLADESH_COUNTRY_PACK.capabilities.electronicInvoicing, false);
  assert.equal(BANGLADESH_COUNTRY_PACK.capabilities.offlineLegalCapability, "unsupported");
  assert.equal(BANGLADESH_SUPPORT_MATRIX.supportLevel, "limited");
  assert.ok(BANGLADESH_SUPPORT_MATRIX.limitations.some((value) => /no production legal or tax compliance claim/i.test(value)));
});

test("synthetic second pack proves data-only extensibility with RTL and CJK profiles", () => {
  assert.doesNotThrow(() => validateCountryPackManifest(SYNTHETIC_XZ_COUNTRY_PACK));
  assert.equal(SYNTHETIC_XZ_COUNTRY_PACK.countryCode, "XZ");
  assert.deepEqual(SYNTHETIC_XZ_COUNTRY_PACK.localeProfiles.map(({ locale, direction }) => [locale, direction]), [
    ["en", "ltr"],
    ["ar-XZ", "rtl"],
    ["ja-XZ", "ltr"],
  ]);
  assert.equal(SYNTHETIC_XZ_COUNTRY_PACK.currencyMetadata[0].accountingScale, 3);
  assert.equal(SYNTHETIC_XZ_SUPPORT_MATRIX.limitations.length, 1);
  assert.deepEqual(BUILTIN_COUNTRY_PACKS.map(({ packId }) => packId), ["country.bd", "country.xz"]);
});

test("built-in pack manifests remain immutable validated data without country-specific core keys", () => {
  for (const pack of BUILTIN_COUNTRY_PACKS) {
    assert.equal(Object.isFrozen(pack), true);
    assert.doesNotThrow(() => validateCountryPackManifest(pack));
    assert.equal("databaseColumnOverrides" in pack, false);
    assert.equal("coreSchemaChanges" in pack, false);
  }
});
