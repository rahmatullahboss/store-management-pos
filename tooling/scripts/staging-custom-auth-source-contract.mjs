const CUSTOM_AUTH_RELATIONS = Object.freeze([
  "custom_auth_credentials",
  "custom_auth_sessions",
  "custom_auth_rate_limits",
  "custom_auth_events",
]);

const customAuthRelationsPattern = new RegExp(
  CUSTOM_AUTH_RELATIONS.map((relation) => `'${relation}'`).join("\\s*,\\s*"),
  "gu",
);

const canonicalCustomAuthRelations = CUSTOM_AUTH_RELATIONS.map(
  (relation) => `'${relation}'`,
).join(",");

export function normalizeCustomAuthRelationEvidenceSource(source) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("Custom staging deployment source is required");
  }

  const matches = [...source.matchAll(customAuthRelationsPattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Custom staging relation evidence must appear exactly once; found ${matches.length}`,
    );
  }

  return source.replace(customAuthRelationsPattern, canonicalCustomAuthRelations);
}
