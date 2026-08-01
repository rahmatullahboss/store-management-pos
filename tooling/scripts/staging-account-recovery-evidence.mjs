import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const TENANT_CODE = "synthetic-beta";
const SESSION_COOKIE = "ozzyl_staging_session";

function hash(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function responseCookies(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";", 1)[0]);
}

function cookieToken(cookie, name) {
  for (const entry of String(cookie || "").split(";")) {
    const [candidate, ...parts] = entry.trim().split("=");
    if (candidate === name) return parts.join("=");
  }
  return "";
}

function normalizedLocation(value, baseUrl) {
  if (!value) return "";
  const url = new URL(value, baseUrl);
  return `${url.pathname}${url.search}`;
}

async function postForm(baseUrl, pathname, fields, cookie = "") {
  return await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      ...(cookie ? { cookie } : {}),
      "content-type": "application/x-www-form-urlencoded",
      origin: baseUrl,
      "sec-fetch-site": "same-origin",
      "user-agent": "Ozzyl-Staging-Recovery-Evidence/1.0",
      "x-request-id": `recovery-${randomUUID()}`,
    },
    body: new URLSearchParams(fields),
  });
}

async function getPage(baseUrl, pathname, cookie = "") {
  return await fetch(`${baseUrl}${pathname}`, {
    redirect: "manual",
    headers: {
      ...(cookie ? { cookie } : {}),
      "user-agent": "Ozzyl-Staging-Recovery-Evidence/1.0",
    },
  });
}

async function signIn(baseUrl, email, password) {
  const response = await postForm(baseUrl, "/auth/sign-in", {
    email,
    password,
    returnTo: "/admin",
  });
  return {
    response,
    cookie: responseCookies(response).find((value) =>
      value.startsWith(`${SESSION_COOKIE}=`)
    ) ?? "",
  };
}

async function issueActionToken(
  client,
  { email, purpose, rawToken, expiresAt, requestId },
) {
  const result = await client.query(
    `SELECT * FROM platform.custom_auth_request_action_token(
       $1::text,$2::text,$3::text,$4::uuid,$5::text,$6::timestamptz,
       $7::text,$8::text,$9::text,$10::text
     )`,
    [
      email,
      TENANT_CODE,
      purpose,
      randomUUID(),
      hash(rawToken),
      expiresAt,
      hash(`rate:${purpose}:${randomUUID()}`),
      requestId,
      hash(`ip:${randomUUID()}`),
      hash(`ua:${randomUUID()}`),
    ],
  );
  const row = result.rows[0];
  if (row?.issued !== true || row?.email_normalized !== email) {
    throw new Error(`Synthetic ${purpose} token was not issued`);
  }
}

async function createOutstandingStepUp(client, oldSessionHash) {
  const result = await client.query(
    `INSERT INTO platform.auth_step_up_grants(
       id, session_id, user_id, tenant_id, factor_id,
       token_hash, permission_scope, expires_at
     )
     SELECT
       $1::uuid, session_row.id, session_row.user_id, session_row.tenant_id,
       factor.id, $2::text, 'inventory.reservation.manage', now() + interval '4 minutes'
     FROM platform.auth_sessions AS session_row
     JOIN platform.auth_mfa_factors AS factor
       ON factor.user_id = session_row.user_id
      AND factor.status = 'active'
     WHERE session_row.token_hash = $3::text
       AND session_row.revoked_at IS NULL
       AND session_row.expires_at > now()
     ORDER BY factor.confirmed_at DESC
     LIMIT 1
     RETURNING id::text`,
    [randomUUID(), hash(randomToken()), oldSessionHash],
  );
  if (result.rowCount !== 1) {
    throw new Error("Synthetic outstanding step-up grant could not be prepared");
  }
  return result.rows[0].id;
}

async function databaseEvidence(
  client,
  {
    email,
    resetTokenHash,
    verificationTokenHash,
    oldSessionHash,
    grantId,
    rawResetToken,
    rawVerificationToken,
  },
) {
  const result = await client.query(
    `SELECT
       credential.email_verified_at IS NOT NULL AS email_verified,
       credential.failed_attempts = 0 AS failed_attempts_cleared,
       credential.locked_until IS NULL AS lockout_cleared,
       (SELECT count(*)::int
          FROM platform.auth_action_tokens
         WHERE token_hash = $2::text
           AND purpose = 'password_recovery'
           AND used_at IS NOT NULL) AS used_reset_tokens,
       (SELECT count(*)::int
          FROM platform.auth_action_tokens
         WHERE token_hash = $3::text
           AND purpose = 'email_verification'
           AND used_at IS NOT NULL) AS used_verification_tokens,
       (SELECT count(*)::int
          FROM platform.auth_action_tokens
         WHERE token_hash IN ($6::text, $7::text)) AS plaintext_token_rows,
       (SELECT count(*)::int
          FROM platform.auth_sessions
         WHERE token_hash = $4::text
           AND revoked_at IS NOT NULL) AS revoked_old_sessions,
       (SELECT count(*)::int
          FROM platform.auth_sessions
         WHERE user_id = user_row.id
           AND revoked_at IS NULL
           AND expires_at > now()) AS active_new_sessions,
       (SELECT count(*)::int
          FROM platform.auth_mfa_factors
         WHERE user_id = user_row.id
           AND status IN ('pending','active')) AS live_mfa_factors,
       (SELECT count(*)::int
          FROM platform.auth_step_up_grants
         WHERE id = $5::uuid
           AND used_at IS NOT NULL) AS consumed_outstanding_grants,
       (SELECT count(*)::int
          FROM platform.auth_events
         WHERE user_id = user_row.id
           AND event_type = 'password_reset_completed'
           AND outcome = 'success') AS password_reset_events,
       (SELECT count(*)::int
          FROM platform.auth_events
         WHERE user_id = user_row.id
           AND event_type = 'email_verified'
           AND outcome = 'success') AS email_verified_events
     FROM platform.users AS user_row
     JOIN platform.auth_credentials AS credential
       ON credential.user_id = user_row.id
     WHERE user_row.email_normalized = $1::text`,
    [
      email,
      resetTokenHash,
      verificationTokenHash,
      oldSessionHash,
      grantId,
      rawResetToken,
      rawVerificationToken,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Account recovery database evidence was not found");
  return {
    emailVerified: row.email_verified === true,
    failedAttemptsCleared: row.failed_attempts_cleared === true,
    lockoutCleared: row.lockout_cleared === true,
    usedResetTokens: Number(row.used_reset_tokens),
    usedVerificationTokens: Number(row.used_verification_tokens),
    plaintextTokenRows: Number(row.plaintext_token_rows),
    revokedOldSessions: Number(row.revoked_old_sessions),
    activeNewSessions: Number(row.active_new_sessions),
    liveMfaFactors: Number(row.live_mfa_factors),
    consumedOutstandingGrants: Number(row.consumed_outstanding_grants),
    passwordResetEvents: Number(row.password_reset_events),
    emailVerifiedEvents: Number(row.email_verified_events),
  };
}

export async function runAccountRecoveryJourney({
  baseUrl,
  sessionCookie,
  oldPassword,
  email,
  connectionString,
  runId,
}) {
  const normalizedEmail = String(email).toLowerCase();
  const oldSessionToken = cookieToken(sessionCookie, SESSION_COOKIE);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(oldSessionToken)) {
    throw new Error("Synthetic recovery journey did not receive a valid session cookie");
  }
  const oldSessionHash = hash(oldSessionToken);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const knownRequest = await postForm(
      baseUrl,
      "/auth/password-recovery/request",
      { email: normalizedEmail },
    );
    const unknownRequest = await postForm(
      baseUrl,
      "/auth/password-recovery/request",
      { email: `missing-${runId || Date.now()}@example.test` },
    );
    const knownLocation = normalizedLocation(
      knownRequest.headers.get("location"),
      baseUrl,
    );
    const unknownLocation = normalizedLocation(
      unknownRequest.headers.get("location"),
      baseUrl,
    );
    if (
      knownRequest.status !== 303 ||
      unknownRequest.status !== 303 ||
      knownLocation !== unknownLocation ||
      knownLocation !== "/forgot-password?requested=1"
    ) {
      throw new Error(
        `Password recovery request response mismatch: ${JSON.stringify({
          knownStatus: knownRequest.status,
          unknownStatus: unknownRequest.status,
          knownLocation,
          unknownLocation,
        })}`,
      );
    }

    const resetToken = randomToken();
    const resetTokenHash = hash(resetToken);
    await issueActionToken(client, {
      email: normalizedEmail,
      purpose: "password_recovery",
      rawToken: resetToken,
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
      requestId: `reset-token-${runId || Date.now()}`,
    });
    const grantId = await createOutstandingStepUp(client, oldSessionHash);

    const resetPage = await getPage(
      baseUrl,
      `/reset-password?token=${encodeURIComponent(resetToken)}`,
    );
    const resetHtml = await resetPage.text();
    if (resetPage.status !== 200 || !resetHtml.includes("Choose a new password")) {
      throw new Error("Valid password recovery page did not render");
    }

    const newPassword = `Recovery-${randomBytes(18).toString("base64url")}`;
    const reset = await postForm(
      baseUrl,
      "/auth/password-recovery/complete",
      {
        token: resetToken,
        password: newPassword,
        confirmPassword: newPassword,
      },
      sessionCookie,
    );
    const resetCookies = responseCookies(reset);
    if (
      reset.status !== 303 ||
      normalizedLocation(reset.headers.get("location"), baseUrl) !==
        "/password-reset-complete" ||
      !resetCookies.some((value) => value.startsWith(`${SESSION_COOKIE}=`)) ||
      !resetCookies.some((value) => value.startsWith("ozzyl_staging_step_up="))
    ) {
      throw new Error("Password reset completion did not clear browser authentication state");
    }

    const revokedSession = await getPage(baseUrl, "/auth/session", sessionCookie);
    if (revokedSession.status !== 401) {
      throw new Error("Password reset did not revoke the original session");
    }

    const oldLogin = await signIn(baseUrl, normalizedEmail, oldPassword);
    if (
      oldLogin.response.status !== 303 ||
      !normalizedLocation(
        oldLogin.response.headers.get("location"),
        baseUrl,
      ).startsWith("/login?error=") ||
      oldLogin.cookie
    ) {
      throw new Error("Old password remained usable after reset");
    }

    const newLogin = await signIn(baseUrl, normalizedEmail, newPassword);
    if (
      newLogin.response.status !== 303 ||
      normalizedLocation(newLogin.response.headers.get("location"), baseUrl) !==
        "/admin" ||
      !newLogin.cookie
    ) {
      throw new Error("New password could not create a fresh session");
    }

    const mfaStatus = await getPage(baseUrl, "/auth/mfa/status", newLogin.cookie);
    const mfaBody = await mfaStatus.json();
    if (mfaStatus.status !== 200 || mfaBody?.enrolled !== false) {
      throw new Error("Password-derived MFA factors were not revoked by reset");
    }

    const replay = await postForm(
      baseUrl,
      "/auth/password-recovery/complete",
      {
        token: resetToken,
        password: newPassword,
        confirmPassword: newPassword,
      },
    );
    if (
      replay.status !== 303 ||
      !normalizedLocation(
        replay.headers.get("location"),
        baseUrl,
      ).startsWith("/reset-password?error=")
    ) {
      throw new Error("Used password recovery token replay was not rejected");
    }

    const verificationToken = randomToken();
    const verificationTokenHash = hash(verificationToken);
    await issueActionToken(client, {
      email: normalizedEmail,
      purpose: "email_verification",
      rawToken: verificationToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      requestId: `verification-token-${runId || Date.now()}`,
    });
    const verificationPage = await getPage(
      baseUrl,
      `/verify-email?token=${encodeURIComponent(verificationToken)}`,
    );
    if (
      verificationPage.status !== 200 ||
      !(await verificationPage.text()).includes("Verify your email")
    ) {
      throw new Error("Valid email verification page did not render");
    }
    const verification = await postForm(
      baseUrl,
      "/auth/email-verification/complete",
      { token: verificationToken },
    );
    if (
      verification.status !== 303 ||
      normalizedLocation(verification.headers.get("location"), baseUrl) !==
        "/email-verification-complete"
    ) {
      throw new Error("Email verification token was not consumed");
    }
    const verificationReplay = await postForm(
      baseUrl,
      "/auth/email-verification/complete",
      { token: verificationToken },
    );
    if (
      verificationReplay.status !== 303 ||
      !normalizedLocation(
        verificationReplay.headers.get("location"),
        baseUrl,
      ).startsWith("/verify-email?error=")
    ) {
      throw new Error("Used email verification token replay was not rejected");
    }

    const database = await databaseEvidence(client, {
      email: normalizedEmail,
      resetTokenHash,
      verificationTokenHash,
      oldSessionHash,
      grantId,
      rawResetToken: resetToken,
      rawVerificationToken: verificationToken,
    });
    if (
      !database.emailVerified ||
      !database.failedAttemptsCleared ||
      !database.lockoutCleared ||
      database.usedResetTokens !== 1 ||
      database.usedVerificationTokens !== 1 ||
      database.plaintextTokenRows !== 0 ||
      database.revokedOldSessions !== 1 ||
      database.activeNewSessions < 1 ||
      database.liveMfaFactors !== 0 ||
      database.consumedOutstandingGrants !== 1 ||
      database.passwordResetEvents < 1 ||
      database.emailVerifiedEvents < 1
    ) {
      throw new Error(
        `Account recovery database evidence failed: ${JSON.stringify(database)}`,
      );
    }

    return {
      report: {
        nonEnumeratingRequest: true,
        tokenHashOnly: database.plaintextTokenRows === 0,
        resetPagePassed: true,
        resetCompleted: true,
        oldSessionRevoked: database.revokedOldSessions === 1,
        oldPasswordRejected: true,
        newPasswordAccepted: true,
        mfaFactorsRevoked: database.liveMfaFactors === 0,
        outstandingStepUpRevoked: database.consumedOutstandingGrants === 1,
        resetReplayRejected: true,
        emailVerificationCompleted: database.emailVerified,
        verificationReplayRejected: true,
        passwordResetEvents: database.passwordResetEvents,
        emailVerifiedEvents: database.emailVerifiedEvents,
        productionEmailDeliveryConfigured: false,
      },
      newSessionCookie: newLogin.cookie,
    };
  } finally {
    await client.end();
  }
}
