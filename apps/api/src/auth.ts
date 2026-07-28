import { PlatformError } from "../../../packages/foundation/src/errors.js";

export interface VerifiedIdentity {
  readonly userId: string;
  readonly tenantId: string;
  readonly permissions: readonly string[];
  readonly legalEntityId?: string;
  readonly storeId?: string;
  readonly warehouseId?: string;
  readonly registerId?: string;
  readonly deviceId?: string;
  readonly impersonatorId?: string;
}

export interface TokenVerifier { verify(token: string): Promise<VerifiedIdentity> }

export class DevelopmentTokenVerifier implements TokenVerifier {
  constructor(private readonly enabled: boolean) {}
  async verify(token: string): Promise<VerifiedIdentity> {
    if (!this.enabled) throw new PlatformError("AUTHENTICATION_REQUIRED", "No identity provider is configured", 401);
    try {
      const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token), (character) => character.charCodeAt(0)))) as unknown;
      if (typeof payload !== "object" || payload === null) throw new Error("invalid payload");
      const record = payload as Record<string, unknown>;
      if (typeof record.userId !== "string" || typeof record.tenantId !== "string" || !Array.isArray(record.permissions)) throw new Error("missing identity fields");
      return {
        userId: record.userId,
        tenantId: record.tenantId,
        permissions: record.permissions.filter((value): value is string => typeof value === "string"),
        ...(typeof record.legalEntityId === "string" ? { legalEntityId: record.legalEntityId } : {}),
        ...(typeof record.storeId === "string" ? { storeId: record.storeId } : {}),
        ...(typeof record.warehouseId === "string" ? { warehouseId: record.warehouseId } : {}),
        ...(typeof record.registerId === "string" ? { registerId: record.registerId } : {}),
        ...(typeof record.deviceId === "string" ? { deviceId: record.deviceId } : {}),
        ...(typeof record.impersonatorId === "string" ? { impersonatorId: record.impersonatorId } : {}),
      };
    } catch {
      throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token is invalid", 401);
    }
  }
}

export function bearerToken(request: Request): string {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token is required", 401);
  return value.slice(7);
}
