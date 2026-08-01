const LEGACY_CUSTOM_AUTH_RELATIONS = Object.freeze([
  "custom_auth_credentials",
  "custom_auth_sessions",
  "custom_auth_rate_limits",
  "custom_auth_events",
]);

const LIVE_AUTH_RELATIONS = Object.freeze([
  "auth_credentials",
  "auth_sessions",
  "auth_rate_limits",
  "auth_events",
]);

function relationPattern(relations) {
  return new RegExp(
    relations.map((relation) => `'${relation}'`).join("\\s*,\\s*"),
    "gu",
  );
}

function canonicalRelations(relations) {
  return relations.map((relation) => `'${relation}'`).join(",");
}

const legacyPattern = relationPattern(LEGACY_CUSTOM_AUTH_RELATIONS);
const livePattern = relationPattern(LIVE_AUTH_RELATIONS);
const canonicalLegacyRelations = canonicalRelations(LEGACY_CUSTOM_AUTH_RELATIONS);
const canonicalLiveRelations = canonicalRelations(LIVE_AUTH_RELATIONS);
const compatibilityMarker =
  `\n/* asymmetric-patch-relation-contract:${canonicalLegacyRelations} */\n`;

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function assertOneRelationContract(source) {
  const legacyMatches = countMatches(source, legacyPattern);
  const liveMatches = countMatches(source, livePattern);
  if (legacyMatches + liveMatches !== 1) {
    throw new Error(
      "Custom staging relation evidence must contain exactly one complete " +
        `legacy or live contract; found ${legacyMatches + liveMatches}`,
    );
  }
  return { legacyMatches, liveMatches };
}

export function normalizeCustomAuthRelationEvidenceSource(source) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("Custom staging deployment source is required");
  }
  if (source.includes(compatibilityMarker)) {
    throw new Error("Custom staging compatibility marker is not allowed in source");
  }

  const { liveMatches } = assertOneRelationContract(source);
  if (liveMatches === 1) {
    const normalized = source.replace(livePattern, canonicalLiveRelations);
    return `${normalized}${compatibilityMarker}`;
  }
  return source.replace(legacyPattern, canonicalLegacyRelations);
}

export function finalizeCustomAuthRelationEvidenceSource(source) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("Patched custom staging deployment source is required");
  }

  const markerCount = source.split(compatibilityMarker).length - 1;
  if (markerCount > 1) {
    throw new Error(
      `Custom staging compatibility marker must appear at most once; found ${markerCount}`,
    );
  }
  const finalized = source.replace(compatibilityMarker, "");
  assertOneRelationContract(finalized);
  return finalized;
}
