export interface Versioned { readonly version: bigint }
export function assertVersion(entity: Versioned, expectedVersion: bigint): void {
  if (entity.version !== expectedVersion) throw new Error(`Version conflict: expected ${expectedVersion}, found ${entity.version}`);
}
export function etag(version: bigint): string { return `W/\"v${version.toString()}\"`; }
