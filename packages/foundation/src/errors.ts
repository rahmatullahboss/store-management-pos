export type ErrorCode =
  | "AUTHENTICATION_REQUIRED" | "PERMISSION_DENIED" | "VALIDATION_FAILED"
  | "NOT_FOUND" | "CONFLICT" | "IDEMPOTENCY_CONFLICT" | "VERSION_CONFLICT"
  | "RATE_LIMITED" | "DATABASE_UNAVAILABLE" | "INTERNAL_ERROR";

export class PlatformError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

export function asPlatformError(error: unknown): PlatformError {
  if (error instanceof PlatformError) return error;
  return new PlatformError("INTERNAL_ERROR", "An internal error occurred", 500);
}

export function errorResponse(error: unknown, requestId: string): Response {
  const safe = asPlatformError(error);
  return Response.json({ error: { code: safe.code, message: safe.message, requestId, ...(safe.details ? { details: safe.details } : {}) } }, { status: safe.status });
}
