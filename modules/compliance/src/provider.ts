export type FiscalProviderOutcome = "accepted" | "rejected" | "unknown";

export interface FiscalProviderRequest {
  readonly submissionId: string;
  readonly documentId: string;
  readonly countryPackVersion: string;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
}

export interface FiscalProviderResult {
  readonly status: FiscalProviderOutcome;
  readonly observedAt: string;
  readonly providerReference?: string;
  readonly rejectionCode?: string;
}

export interface FiscalProvider {
  readonly capabilityId: string;
  supportsCountryPack(version: string): boolean;
  submit(request: FiscalProviderRequest): Promise<FiscalProviderResult>;
}

export interface FiscalProviderRegistry {
  require(capabilityId: string): FiscalProvider;
}
