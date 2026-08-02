import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relative) {
  return await readFile(new URL(relative, import.meta.url), "utf8");
}

test("blocked commerce and private account handlers remain absent from the API root router", async () => {
  const api = await source("../../apps/api/src/index.ts");

  for (const forbiddenImport of [
    "cart-quote-handler",
    "checkout-capability-handler",
    "customer-account-handler",
  ]) {
    assert.equal(api.includes(forbiddenImport), false, forbiddenImport);
  }

  for (const forbiddenRoute of [
    "/v1/storefront/cart/quote",
    "/v1/storefront/checkout/capabilities",
    "/v1/storefront/checkout/submit",
    "/v1/storefront/account",
  ]) {
    assert.equal(api.includes(forbiddenRoute), false, forbiddenRoute);
  }
});

test("buyer runtime does not silently wire blocked abuse or telemetry providers", async () => {
  const runtime = await source("../../apps/storefront-web/src/runtime.ts");
  const api = await source("../../apps/api/src/index.ts");

  for (const sourceText of [runtime, api]) {
    assert.equal(
      sourceText.includes("modules/storefront/src/abuse-control.js"),
      false,
      "distributed abuse provider must be integrated explicitly after Issue #107",
    );
    assert.equal(
      sourceText.includes("abuse-control-provider-bridge"),
      false,
      "trusted distributed abuse bridge must stay off live roots before Issue #107 integration",
    );
    assert.equal(
      sourceText.includes("modules/storefront/src/observability.js"),
      false,
      "storefront operational sink must be integrated explicitly after Issue #108",
    );
    assert.equal(
      sourceText.includes("operational-sink-bridge"),
      false,
      "trusted operational sink bridge must stay off live roots before Issue #108 integration",
    );
  }
});

test("trusted domain provider bridge stays off public and tenant-facing runtime roots", async () => {
  const api = await source("../../apps/api/src/index.ts");
  const handler = await source("../../apps/api/src/modules/storefront/handler.ts");
  const runtime = await source("../../apps/storefront-web/src/runtime.ts");

  for (const sourceText of [api, handler, runtime]) {
    assert.equal(
      sourceText.includes("domain-provider-bridge"),
      false,
      "trusted provider observation bridge must not be reachable from public/tenant routes before Issue #104 integration",
    );
    assert.equal(
      sourceText.includes("mapStorefrontTrustedDomainLifecycleObservationV1"),
      false,
    );
    assert.equal(
      sourceText.includes("mapStorefrontTrustedDomainVerificationObservationV1"),
      false,
    );
  }
});

test("external domain provider observations are intercepted before domain command execution", async () => {
  const handler = await source("../../apps/api/src/modules/storefront/handler.ts");
  const guard = handler.indexOf("DOMAIN_PROVIDER_CONTROL_UNAVAILABLE");
  const providerGuard = handler.indexOf(
    'if (request.method === "POST" && (providerVerification?.[1] || providerTransition?.[1]))',
  );
  const commandVerification = handler.indexOf("const domainVerification = url.pathname.match");
  const commandTransition = handler.indexOf("const domainTransition = url.pathname.match");

  assert.notEqual(guard, -1);
  assert.notEqual(providerGuard, -1);
  assert.notEqual(commandVerification, -1);
  assert.notEqual(commandTransition, -1);
  assert.ok(providerGuard < commandVerification);
  assert.ok(providerGuard < commandTransition);
});

test("machine tracker keeps blocked authority and H7 runtime dependencies explicit", async () => {
  const status = await source("../../docs/architecture/storefront/status.yaml");

  for (const required of [
    "current_checkpoint: H7",
    "status: blocked_on_cross_module_authority",
    "status: blocked_on_trusted_customer_order_and_return_capabilities",
    "status: blocked_on_trusted_provider_control_plane",
    "status: active_with_external_runtime_blockers",
    "issue_97_lossless_MOD_A_price_tax_into_MOD_C_and_pre_order_shipping",
    "issue_98_MOD_E_side_effect_free_public_payment_capability",
    "issue_100_MOD_F_typed_checkout_country_address_contact_policy",
    "issue_101_trusted_session_to_canonical_customer_binding_and_storefront_scoped_MOD_C_order_reads",
    "issue_102_buyer_safe_idempotent_return_support_request_capability",
    "issue_104_trusted_MOD_G_shared_Cloudflare_custom_hostname_provider_lifecycle",
    "issue_107_distributed_storefront_abuse_rate_limit_provider",
    "issue_108_approved_shared_operational_telemetry_sink",
  ]) {
    assert.equal(status.includes(required), true, required);
  }

  const verifiedHead = status.match(/verified_implementation_head: ([0-9a-f]{40})/u)?.[1];
  assert.match(verifiedHead ?? "", /^[0-9a-f]{40}$/u);
  assert.notEqual(
    verifiedHead,
    "d5e5c6a0b0a780a89c9702f0ade6f632c0dc60ab",
    "machine tracker must not regress to the H3 verified head",
  );
});

test("fail-closed matrix can only be relaxed by an explicit blocker-aware code change", async () => {
  const api = await source("../../apps/api/src/index.ts");
  const handler = await source("../../apps/api/src/modules/storefront/handler.ts");
  const runtime = await source("../../apps/storefront-web/src/runtime.ts");

  const combined = `${api}\n${handler}\n${runtime}`;
  assert.equal(combined.includes("handleStorefrontCustomerAccountRequest"), false);
  assert.equal(combined.includes("handleStorefrontCartQuoteRequest"), false);
  assert.equal(combined.includes("handleStorefrontCheckoutCapabilityRequest"), false);
  assert.equal(combined.includes("STOREFRONT_ABUSE_CONTROL_UNAVAILABLE"), false);
  assert.equal(combined.includes("createStorefrontDistributedAbuseProviderRequestV1"), false);
  assert.equal(combined.includes("mapStorefrontDistributedAbuseProviderResultV1"), false);
  assert.equal(combined.includes("serializeStorefrontOperationalEventV1"), false);
  assert.equal(combined.includes("deliverStorefrontOperationalEventV1"), false);
  assert.equal(handler.includes("DOMAIN_PROVIDER_CONTROL_UNAVAILABLE"), true);
});
