import type { FiscalProvider, FiscalProviderRequest, FiscalProviderResult } from "./provider.js";

export type FiscalSimulatorMode = "accept" | "reject" | "unknown" | "throw_after_effect";

interface RecordedResult {
  readonly payloadHash: string;
  readonly result: FiscalProviderResult;
}

export class DeterministicFiscalProvider implements FiscalProvider {
  readonly #results = new Map<string, RecordedResult>();

  constructor(
    readonly capabilityId: string,
    private readonly supportedCountryPackVersions: ReadonlySet<string>,
    private readonly mode: FiscalSimulatorMode = "accept",
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  supportsCountryPack(version: string): boolean {
    return this.supportedCountryPackVersions.has(version);
  }

  async submit(request: FiscalProviderRequest): Promise<FiscalProviderResult> {
    const existing = this.#results.get(request.idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== request.payloadHash) throw new TypeError("Fiscal provider idempotency key was reused with different payload");
      return existing.result;
    }
    const observedAt = this.clock();
    const providerReference = `fiscal-${request.submissionId}`;
    const result: FiscalProviderResult = this.mode === "reject"
      ? Object.freeze({ status: "rejected", observedAt, providerReference, rejectionCode: "SIMULATED_REJECTION" })
      : this.mode === "unknown" || this.mode === "throw_after_effect"
        ? Object.freeze({ status: "unknown", observedAt, providerReference })
        : Object.freeze({ status: "accepted", observedAt, providerReference });
    this.#results.set(request.idempotencyKey, { payloadHash: request.payloadHash, result });
    if (this.mode === "throw_after_effect") throw new Error("Simulated connection loss after provider effect");
    return result;
  }
}
