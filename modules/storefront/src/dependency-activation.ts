export const STOREFRONT_DEPENDENCY_ISSUES = Object.freeze([
  97,
  98,
  100,
  101,
  102,
  104,
  107,
  108,
] as const);

export type StorefrontDependencyIssue =
  (typeof STOREFRONT_DEPENDENCY_ISSUES)[number];

export type StorefrontActivationSurface =
  | "public_cart_quote"
  | "checkout_capabilities"
  | "checkout_submit"
  | "private_profile"
  | "private_order_history"
  | "private_order_detail"
  | "private_order_tracking"
  | "buyer_return_request"
  | "buyer_support_request"
  | "tenant_domain_verification"
  | "tenant_domain_provider_transition"
  | "custom_domain_activation"
  | "distributed_abuse_enforcement"
  | "operational_event_sink";

export const STOREFRONT_ACTIVATION_REQUIREMENTS: Readonly<
  Record<StorefrontActivationSurface, readonly StorefrontDependencyIssue[]>
> = Object.freeze({
  public_cart_quote: Object.freeze([97]),
  checkout_capabilities: Object.freeze([97, 98, 100]),
  checkout_submit: Object.freeze([97, 98, 100]),
  private_profile: Object.freeze([101]),
  private_order_history: Object.freeze([101]),
  private_order_detail: Object.freeze([101]),
  private_order_tracking: Object.freeze([101]),
  buyer_return_request: Object.freeze([101, 102]),
  buyer_support_request: Object.freeze([101, 102]),
  tenant_domain_verification: Object.freeze([104]),
  tenant_domain_provider_transition: Object.freeze([104]),
  custom_domain_activation: Object.freeze([104]),
  distributed_abuse_enforcement: Object.freeze([107]),
  operational_event_sink: Object.freeze([108]),
});

export interface StorefrontActivationDecisionV1 {
  readonly decisionVersion: "storefront-dependency-activation.v1";
  readonly surface: StorefrontActivationSurface;
  readonly allowed: boolean;
  readonly requiredIssues: readonly StorefrontDependencyIssue[];
  readonly missingIssues: readonly StorefrontDependencyIssue[];
}

function isDependencyIssue(value: number): value is StorefrontDependencyIssue {
  return (STOREFRONT_DEPENDENCY_ISSUES as readonly number[]).includes(value);
}

export function evaluateStorefrontDependencyActivationV1(
  surface: StorefrontActivationSurface,
  verifiedIssues: Iterable<number>,
): StorefrontActivationDecisionV1 {
  const verified = new Set<StorefrontDependencyIssue>();
  for (const issue of verifiedIssues) {
    if (!Number.isInteger(issue) || !isDependencyIssue(issue)) {
      throw new Error(`Unsupported storefront dependency issue: ${String(issue)}.`);
    }
    verified.add(issue);
  }

  const requiredIssues = STOREFRONT_ACTIVATION_REQUIREMENTS[surface];
  if (!requiredIssues) {
    throw new Error(`Unsupported storefront activation surface: ${String(surface)}.`);
  }

  const missingIssues = Object.freeze(
    requiredIssues.filter((issue) => !verified.has(issue)),
  );

  return Object.freeze({
    decisionVersion: "storefront-dependency-activation.v1",
    surface,
    allowed: missingIssues.length === 0,
    requiredIssues,
    missingIssues,
  });
}

export function assertStorefrontDependencyActivationV1(
  surface: StorefrontActivationSurface,
  verifiedIssues: Iterable<number>,
): void {
  const decision = evaluateStorefrontDependencyActivationV1(
    surface,
    verifiedIssues,
  );
  if (!decision.allowed) {
    throw new Error(
      `Storefront surface ${surface} remains blocked by dependency issues: ${decision.missingIssues
        .map((issue) => `#${issue}`)
        .join(", ")}.`,
    );
  }
}
