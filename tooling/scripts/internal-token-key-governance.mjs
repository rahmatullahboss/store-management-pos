const KEY_ID = /^[A-Za-z0-9._-]{8,80}$/u;
const MAX_REVOKED_KEYS = 8;
const MAX_VERIFICATION_KEYS = 2;

export const INTERNAL_TOKEN_KEY_GOVERNANCE_SCHEMA_VERSION = 1;
export const INTERNAL_TOKEN_KEY_ALGORITHM = "RS256";

function fail(message) {
  throw new Error(`Internal-token key governance: ${message}`);
}

function integer(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} is invalid`);
  return value;
}

function kid(value, name) {
  if (typeof value !== "string" || !KEY_ID.test(value)) fail(`${name} is invalid`);
  return value;
}

function descriptor(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} is invalid`);
  }
  if (value.algorithm !== INTERNAL_TOKEN_KEY_ALGORITHM) {
    fail(`${name} algorithm must be RS256`);
  }
  const notBefore = integer(value.notBefore, `${name} not-before`);
  const signUntil = integer(value.signUntil, `${name} signing expiry`);
  const verifyUntil = integer(value.verifyUntil, `${name} verification expiry`);
  if (signUntil <= notBefore || verifyUntil < signUntil) {
    fail(`${name} lifecycle is invalid`);
  }
  return Object.freeze({
    kid: kid(value.kid, `${name} kid`),
    algorithm: INTERNAL_TOKEN_KEY_ALGORITHM,
    notBefore,
    signUntil,
    verifyUntil,
  });
}

function revoked(value) {
  if (!Array.isArray(value) || value.length > MAX_REVOKED_KEYS) {
    fail("revoked-key list is invalid");
  }
  const output = [];
  for (const [index, item] of value.entries()) {
    const valueKid = kid(item, `revoked kid ${index + 1}`);
    if (output.includes(valueKid)) fail("revoked-key IDs must be unique");
    output.push(valueKid);
  }
  return output;
}

export function normalizeInternalTokenKeyState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("state is invalid");
  }
  const active = descriptor(input.active, "active key");
  const previous = input.previous === null || input.previous === undefined
    ? null
    : descriptor(input.previous, "previous key");
  if (previous?.kid === active.kid) fail("active and previous keys must differ");
  const revokedKids = revoked(input.revokedKids ?? []);
  if (revokedKids.includes(active.kid)) fail("active key cannot be revoked");
  return Object.freeze({
    schemaVersion: INTERNAL_TOKEN_KEY_GOVERNANCE_SCHEMA_VERSION,
    algorithm: INTERNAL_TOKEN_KEY_ALGORITHM,
    active,
    previous,
    revokedKids: Object.freeze(revokedKids),
  });
}

function rotationInputs(options) {
  const state = normalizeInternalTokenKeyState(options.state);
  const candidate = descriptor(options.candidate, "candidate key");
  const now = integer(options.now, "clock");
  const maximumTokenLifetimeSeconds = integer(
    options.maximumTokenLifetimeSeconds,
    "maximum token lifetime",
  );
  const clockSkewSeconds = integer(options.clockSkewSeconds, "clock skew");
  const overlapSeconds = integer(options.overlapSeconds, "rotation overlap");
  if (overlapSeconds < maximumTokenLifetimeSeconds + clockSkewSeconds) {
    fail("rotation overlap is shorter than token lifetime plus clock skew");
  }
  if (candidate.kid === state.active.kid || candidate.kid === state.previous?.kid) {
    fail("candidate key ID must be new");
  }
  if (state.revokedKids.includes(candidate.kid)) fail("candidate key is revoked");
  if (now < candidate.notBefore || now > candidate.signUntil) {
    fail("candidate key is outside its signing window");
  }
  if (candidate.verifyUntil < candidate.signUntil + maximumTokenLifetimeSeconds) {
    fail("candidate verification window is too short");
  }
  return {
    state,
    candidate,
    now,
    maximumTokenLifetimeSeconds,
    overlapSeconds,
  };
}

function previousFromActive(active, now, overlapSeconds) {
  return Object.freeze({
    ...active,
    verifyUntil: Math.max(active.verifyUntil, now + overlapSeconds),
  });
}

export function planScheduledInternalTokenKeyRotation(options) {
  const { state, candidate, now, overlapSeconds } = rotationInputs(options);
  if (state.previous && now <= state.previous.verifyUntil) {
    fail("an unexpired previous key blocks scheduled rotation");
  }
  return normalizeInternalTokenKeyState({
    active: candidate,
    previous: previousFromActive(state.active, now, overlapSeconds),
    revokedKids: state.revokedKids,
  });
}

export function planEmergencyInternalTokenKeyRotation(options) {
  const { state, candidate, now, overlapSeconds } = rotationInputs(options);
  const compromisedKid = kid(options.compromisedKid, "compromised kid");
  if (compromisedKid !== state.active.kid && compromisedKid !== state.previous?.kid) {
    fail("compromised key is not active or previous");
  }
  const revokedKids = [...state.revokedKids, compromisedKid];
  if (new Set(revokedKids).size !== revokedKids.length) {
    fail("compromised key is already revoked");
  }
  if (revokedKids.length > MAX_REVOKED_KEYS) fail("revoked-key list is full");
  let previous = null;
  if (compromisedKid === state.previous?.kid) {
    previous = previousFromActive(state.active, now, overlapSeconds);
  } else if (
    state.previous &&
    now <= state.previous.verifyUntil &&
    !revokedKids.includes(state.previous.kid)
  ) {
    previous = state.previous;
  }
  return normalizeInternalTokenKeyState({
    active: candidate,
    previous,
    revokedKids,
  });
}

export function retireExpiredPreviousInternalTokenKey(stateInput, nowInput) {
  const state = normalizeInternalTokenKeyState(stateInput);
  const now = integer(nowInput, "clock");
  if (!state.previous || now <= state.previous.verifyUntil) return state;
  return normalizeInternalTokenKeyState({
    active: state.active,
    previous: null,
    revokedKids: state.revokedKids,
  });
}

export function summarizeInternalTokenKeyGovernance(stateInput, nowInput) {
  const state = normalizeInternalTokenKeyState(stateInput);
  const now = integer(nowInput, "clock");
  const activeSigningKeyCount =
    now >= state.active.notBefore && now <= state.active.signUntil ? 1 : 0;
  const activeVerificationKeyCount =
    !state.revokedKids.includes(state.active.kid) && now <= state.active.verifyUntil ? 1 : 0;
  const previousVerificationKeyCount =
    state.previous &&
    !state.revokedKids.includes(state.previous.kid) &&
    now <= state.previous.verifyUntil
      ? 1
      : 0;
  const publishedKeyCount = activeVerificationKeyCount + previousVerificationKeyCount;
  if (publishedKeyCount > MAX_VERIFICATION_KEYS) fail("published-key count is invalid");
  return Object.freeze({
    schemaVersion: INTERNAL_TOKEN_KEY_GOVERNANCE_SCHEMA_VERSION,
    algorithm: INTERNAL_TOKEN_KEY_ALGORITHM,
    activeSigningKeyCount,
    activeVerificationKeyCount,
    previousVerificationKeyCount,
    publishedKeyCount,
    revokedKeyCount: state.revokedKids.length,
    privateKeyMaterialIncluded: false,
    keyIdentifiersIncluded: false,
  });
}
