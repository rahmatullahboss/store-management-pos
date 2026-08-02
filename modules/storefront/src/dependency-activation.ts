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

export const STOREFRONT_INTEGRATION_TARGET = "program/integration-v1" as const;

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
  public_cart_quote: Object.freeze([97] as const),
  checkout_capabilities: Object.freeze([97, 98, 100] as const),
  checkout_submit: Object.freeze([97, 98, 100] as const),
  private_profile: Object.freeze([101] as const),
  private_order_history: Object.freeze([101] as const),
  private_order_detail: Object.freeze([101] as const),
  private_order_tracking: Object.freeze([101] as const),
  buyer_return_request: Object.freeze([101, 102] as const),
  buyer_support_request: Object.freeze([101, 102] as const),
  tenant_domain_verification: Object.freeze([104] as const),
  tenant_domain_provider_transition: Object.freeze([104] as const),
  custom_domain_activation: Object.freeze([104] as const),
  distributed_abuse_enforcement: Object.freeze([107] as const),
  operational_event_sink: Object.freeze([108] as const),
});

export interface StorefrontDependencyVerificationEvidenceV1 {
  readonly issue: StorefrontDependencyIssue;
  readonly integrationTarget: typeof STOREFRONT_INTEGRATION_TARGET;
  readonly ownerDeliveryCommitSha: string;
  readonly integrationCommitSha: string;
  readonly storefrontVerificationCommitSha: string;
  readonly storefrontCiRunId: number;
}

export interface StorefrontActivationDecisionV1 {
  readonly decisionVersion: "storefront-dependency-activation.v1";
  readonly surface: StorefrontActivationSurface;
  readonly allowed: boolean;
  readonly requiredIssues: readonly StorefrontDependencyIssue[];
  readonly missingIssues: readonly StorefrontDependencyIssue[];
}

const EVIDENCE_KEYS = Object.freeze([
  "issue",
  "integrationTarget",
  "ownerDeliveryCommitSha",
  "integrationCommitSha",
  "storefrontVerificationCommitSha",
  "storefrontCiRunId",
] as const);
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

function isDependencyIssue(value: number): value is StorefrontDependencyIssue {
  return (STOREFRONT_DEPENDENCY_ISSUES as readonly number[]).includes(value);
}

function parseCommitSha(field: string, value: unknown): string {
  if (typeof value !== "string" || !COMMIT_SHA_PATTERN.test(value)) {
    throw new Error(
      `Invalid storefront dependency evidence ${field}: expected lowercase 40-character commit SHA.`,
    );
  }
  return value;
}

function parseVerificationEvidence(
  value: unknown,
): StorefrontDependencyVerificationEvidenceV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "Invalid storefront dependency evidence: expected a structured evidence object.",
    );
  }

  const record = value as Record<string, unknown>;
  const allowedKeys = EVIDENCE_KEYS as readonly string[];
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(
        `Unsupported storefront dependency evidence field: ${key}.`,
      );
    }
  }

  const issue = record.issue;
  if (
    typeof issue !== "number" ||
    !Number.isInteger(issue) ||
    !isDependencyIssue(issue)
  ) {
    throw new Error(
      `Unsupported storefront dependency issue: ${String(record.issue)}.`,
    );
  }

  if (record.integrationTarget !== STOREFRONT_INTEGRATION_TARGET) {
    throw new Error(
      `Invalid storefront dependency integration target: ${String(record.integrationTarget)}.`,
    );
  }

  const ownerDeliveryCommitSha = parseCommitSha(
    "ownerDeliveryCommitSha",
    record.ownerDeliveryCommitSha,
  );
  const integrationCommitSha = parseCommitSha(
    "integrationCommitSha",
    record.integrationCommitSha,
  );
  const storefrontVerificationCommitSha = parseCommitSha(
    "storefrontVerificationCommitSha",
    record.storefrontVerificationCommitSha,
  );

  if (
    typeof record.storefrontCiRunId !== "number" ||
    !Number.isSafeInteger(record.storefrontCiRunId) ||
    record.storefrontCiRunId <= 0
  ) {
    throw new Error(
      "Invalid storefront dependency evidence storefrontCiRunId: expected a positive safe integer.",
    );
  }

  return Object.freeze({
    issue,
    integrationTarget: STOREFRONT_INTEGRATION_TARGET,
    ownerDeliveryCommitSha,
    integrationCommitSha,
    storefrontVerificationCommitSha,
    storefrontCiRunId: record.storefrontCiRunId,
  });
}

export function evaluateStorefrontDependencyActivationV1(
  surface: StorefrontActivationSurface,
  verificationEvidence: Iterable<StorefrontDependencyVerificationEvidenceV1>,
): StorefrontActivationDecisionV1 {
  const requiredIssues = STOREFRONT_ACTIVATION_REQUIREMENTS[surface];
  if (!requiredIssues) {
    throw new Error(`Unsupported storefront activation surface: ${String(surface)}.`);
  }

  const verified = new Set<StorefrontDependencyIssue>();
  for (const rawEvidence of verificationEvidence) {
    const evidence = parseVerificationEvidence(rawEvidence);
    if (verified.has(evidence.issue)) {
      throw new Error(
        `Duplicate storefront dependency verification evidence for issue #${evidence.issue}.`,
      );
    }
    verified.add(evidence.issue);
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
  verificationEvidence: Iterable<StorefrontDependencyVerificationEvidenceV1>,
): void {
  const decision = evaluateStorefrontDependencyActivationV1(
    surface,
    verificationEvidence,
  );
  if (!decision.allowed) {
    throw new Error(
      `Storefront surface ${surface} remains blocked by dependency issues: ${decision.missingIssues
        .map((issue) => `#${issue}`)
        .join(", ")}.`,
    );
  }
}
