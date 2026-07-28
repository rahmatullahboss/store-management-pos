export type Brand<T, B extends string> = T & { readonly __brand: B };
export type TenantId = Brand<string, "TenantId">;
export type LegalEntityId = Brand<string, "LegalEntityId">;
export type StoreId = Brand<string, "StoreId">;
export type WarehouseId = Brand<string, "WarehouseId">;
export type RegisterId = Brand<string, "RegisterId">;
export type UserId = Brand<string, "UserId">;
export type DeviceId = Brand<string, "DeviceId">;
export type EventId = Brand<string, "EventId">;
export type RequestId = Brand<string, "RequestId">;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidV7(now = Date.now(), random = crypto.getRandomValues(new Uint8Array(10))): string {
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError("Timestamp must be a non-negative safe integer");
  if (random.length < 10) throw new RangeError("UUIDv7 requires at least ten random bytes");
  const bytes = new Uint8Array(16);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = 0x70 | (random[0]! & 0x0f);
  bytes[7] = random[1]!;
  bytes[8] = 0x80 | (random[2]! & 0x3f);
  bytes.set(random.slice(3, 10), 9);
  return bytesToUuid(bytes);
}

export function assertUuid(value: string, field = "id"): string {
  if (!UUID_PATTERN.test(value)) throw new TypeError(`${field} must be a UUID`);
  return value.toLowerCase();
}

export function opaqueId(prefix: string, value = uuidV7()): string {
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(prefix)) throw new TypeError("Opaque ID prefix is invalid");
  return `${prefix}_${assertUuid(value).replaceAll("-", "")}`;
}
