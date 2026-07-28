import type {
  PaymentProvider,
  ProviderAuthorizeRequest,
  ProviderCapabilities,
  ProviderCaptureRequest,
  ProviderRefundRequest,
  ProviderResult,
  ProviderSettlementRecord,
  ProviderVoidRequest,
} from "./provider.js";

export interface DeterministicPaymentProviderOptions {
  readonly declineIntentIds?: ReadonlySet<string>;
  readonly timeoutAfterEffectFor?: ReadonlySet<string>;
  readonly clock?: () => string;
}

function referenceFor(intentId: string): string {
  return `sim_${intentId.replaceAll(/[^a-zA-Z0-9_-]/gu, "_")}`;
}

export class DeterministicPaymentProvider implements PaymentProvider {
  readonly #resultsByIdempotencyKey = new Map<string, ProviderResult>();
  readonly #statusByReference = new Map<string, ProviderResult>();
  readonly #declineIntentIds: ReadonlySet<string>;
  readonly #timeoutAfterEffectFor: ReadonlySet<string>;
  readonly #clock: () => string;
  #effectCount = 0;

  constructor(options: DeterministicPaymentProviderOptions = {}) {
    this.#declineIntentIds = options.declineIntentIds ?? new Set();
    this.#timeoutAfterEffectFor = options.timeoutAfterEffectFor ?? new Set();
    this.#clock = options.clock ?? (() => "2026-07-28T00:00:00.000Z");
  }

  get effectCount(): number {
    return this.#effectCount;
  }

  capabilities(): ProviderCapabilities {
    return Object.freeze({ authorize: true, capture: true, void: true, refund: true, partialRefund: true, statusQuery: true, settlementImport: true });
  }

  async authorize(request: ProviderAuthorizeRequest): Promise<ProviderResult> {
    return await this.#execute(request.idempotencyKey, () => {
      const declined = this.#declineIntentIds.has(request.intentId);
      const result: ProviderResult = Object.freeze({
        status: declined ? "declined" : "authorized",
        providerReference: referenceFor(request.intentId),
        observedAt: this.#clock(),
        ...(declined ? { failureCategory: "issuer_decline" as const, providerCode: "SIM_DECLINE" } : {}),
      });
      this.#statusByReference.set(result.providerReference, result);
      return result;
    });
  }

  async capture(request: ProviderCaptureRequest): Promise<ProviderResult> {
    return await this.#execute(request.idempotencyKey, () => {
      const current = this.#requiredStatus(request.providerReference);
      if (current.status !== "authorized") throw new TypeError("Simulator capture requires an authorized payment");
      const result = Object.freeze({ status: "captured" as const, providerReference: request.providerReference, observedAt: this.#clock() });
      this.#statusByReference.set(request.providerReference, result);
      return result;
    });
  }

  async void(request: ProviderVoidRequest): Promise<ProviderResult> {
    return await this.#execute(request.idempotencyKey, () => {
      const current = this.#requiredStatus(request.providerReference);
      if (current.status !== "authorized") throw new TypeError("Simulator void requires an authorized payment");
      const result = Object.freeze({ status: "cancelled" as const, providerReference: request.providerReference, observedAt: this.#clock() });
      this.#statusByReference.set(request.providerReference, result);
      return result;
    });
  }

  async refund(request: ProviderRefundRequest): Promise<ProviderResult> {
    return await this.#execute(request.idempotencyKey, () => {
      const current = this.#requiredStatus(request.providerReference);
      if (current.status !== "captured" && current.status !== "partially_refunded") throw new TypeError("Simulator refund requires a captured payment");
      const status = request.amount.amountMinor > 0n ? "partially_refunded" as const : "refunded" as const;
      const result = Object.freeze({ status, providerReference: request.providerReference, observedAt: this.#clock() });
      this.#statusByReference.set(request.providerReference, result);
      return result;
    });
  }

  async queryStatus(providerReference: string): Promise<ProviderResult> {
    return this.#requiredStatus(providerReference);
  }

  async verifyWebhook(headers: Readonly<Record<string, string>>, rawBody: string): Promise<boolean> {
    return headers["x-simulator-signature"] === `sim:${rawBody.length.toString()}`;
  }

  async normalizeWebhook(headers: Readonly<Record<string, string>>, rawBody: string): Promise<ProviderResult> {
    if (!await this.verifyWebhook(headers, rawBody)) throw new TypeError("Simulator webhook signature is invalid");
    const parsed = JSON.parse(rawBody) as unknown;
    if (typeof parsed !== "object" || parsed === null) throw new TypeError("Simulator webhook payload is invalid");
    const reference = (parsed as Record<string, unknown>).providerReference;
    if (typeof reference !== "string") throw new TypeError("Simulator webhook provider reference is required");
    return this.#requiredStatus(reference);
  }

  async importSettlement(source: string): Promise<readonly ProviderSettlementRecord[]> {
    const parsed = JSON.parse(source) as unknown;
    if (!Array.isArray(parsed)) throw new TypeError("Simulator settlement source must be an array");
    return parsed.map((entry) => Object.freeze(entry as ProviderSettlementRecord));
  }

  #requiredStatus(providerReference: string): ProviderResult {
    const result = this.#statusByReference.get(providerReference);
    if (!result) throw new TypeError("Simulator provider reference was not found");
    return result;
  }

  async #execute(idempotencyKey: string, effect: () => ProviderResult): Promise<ProviderResult> {
    const replay = this.#resultsByIdempotencyKey.get(idempotencyKey);
    if (replay) return replay;
    const result = effect();
    this.#resultsByIdempotencyKey.set(idempotencyKey, result);
    this.#effectCount += 1;
    if (this.#timeoutAfterEffectFor.has(idempotencyKey)) throw new Error("Simulator timeout after effect");
    return result;
  }
}
