/// Platform-neutral authentication, session, and workspace isolation rules for
/// Store Companion.
///
/// This package intentionally stores no access token, refresh credential, PKCE
/// verifier, password, or provider secret. Platform adapters own protected
/// credential storage after their dependency and security reviews.
library;

/// Raised when client state violates a Store Companion security invariant.
final class SessionInvariantException implements Exception {
  /// Creates an invariant failure with a safe diagnostic message.
  const SessionInvariantException(this.message);

  /// Safe diagnostic message that contains no credential material.
  final String message;

  @override
  String toString() => 'SessionInvariantException: $message';
}

/// Client-visible authentication and device-session phase.
enum SessionPhase {
  /// No usable authenticated session exists.
  signedOut,

  /// An external-system-browser authorization flow is active.
  authorizing,

  /// The session is active for ordinary authorised requests.
  active,

  /// A privileged action requires current higher assurance.
  stepUpRequired,

  /// The server or user revoked the session or device.
  revoked,

  /// Compatibility, policy, or recovery prevents authenticated operation.
  blocked,
}

/// Server-reported authentication assurance.
enum SessionAssurance {
  /// No authenticated assurance.
  anonymous,

  /// Ordinary authenticated session.
  aal1,

  /// Higher assurance suitable only where current server policy accepts it.
  aal2,

  /// An additive server assurance value unknown to this client.
  unknown,
}

/// Bounded OAuth authorization request metadata.
///
/// The PKCE verifier is deliberately absent. It belongs in protected transient
/// storage and must never be logged or exposed through this model.
final class AuthorizationRequest {
  /// Creates and validates an authorization-code plus PKCE request.
  AuthorizationRequest({
    required this.authorizationEndpoint,
    required this.clientId,
    required this.redirectUri,
    required List<String> scopes,
    required this.state,
    required this.nonce,
    required this.codeChallenge,
    required Set<Uri> allowedRedirectUris,
  }) : scopes = List<String>.unmodifiable(scopes) {
    if (authorizationEndpoint.scheme != 'https' ||
        authorizationEndpoint.host.isEmpty ||
        authorizationEndpoint.hasQuery ||
        authorizationEndpoint.hasFragment) {
      throw const SessionInvariantException(
        'Authorization endpoint must be a clean HTTPS URI.',
      );
    }
    if (clientId.trim().isEmpty) {
      throw const SessionInvariantException('OAuth client ID is required.');
    }
    if (!allowedRedirectUris.contains(redirectUri) ||
        redirectUri.hasQuery ||
        redirectUri.hasFragment) {
      throw const SessionInvariantException(
        'Redirect URI must exactly match the reviewed allowlist.',
      );
    }
    if (scopes.isEmpty ||
        scopes.any((String scope) => scope.trim().isEmpty) ||
        scopes.toSet().length != scopes.length ||
        !scopes.contains('openid')) {
      throw const SessionInvariantException(
        'OAuth scopes must be unique, non-empty, and include openid.',
      );
    }
    if (state.length < 32 || nonce.length < 32) {
      throw const SessionInvariantException(
        'OAuth state and nonce must contain at least 32 characters.',
      );
    }
    if (!_pkceChallengePattern.hasMatch(codeChallenge)) {
      throw const SessionInvariantException(
        'PKCE S256 challenge must be 43 to 128 base64url characters.',
      );
    }
  }

  static final RegExp _pkceChallengePattern = RegExp(
    r'^[A-Za-z0-9_-]{43,128}$',
  );

  /// Reviewed HTTPS authorization endpoint.
  final Uri authorizationEndpoint;

  /// Public native application client identifier.
  final String clientId;

  /// Exact reviewed app-link, universal-link, or custom-scheme callback.
  final Uri redirectUri;

  /// Requested OAuth/OIDC scopes.
  final List<String> scopes;

  /// Unpredictable correlation value checked on callback.
  final String state;

  /// Unpredictable OIDC replay-correlation value.
  final String nonce;

  /// Base64url SHA-256 PKCE challenge. The verifier is not stored here.
  final String codeChallenge;

  /// Complete URI that may be opened in the external system browser.
  Uri get requestUri => authorizationEndpoint.replace(
    queryParameters: <String, String>{
      'response_type': 'code',
      'client_id': clientId,
      'redirect_uri': redirectUri.toString(),
      'scope': scopes.join(' '),
      'state': state,
      'nonce': nonce,
      'code_challenge': codeChallenge,
      'code_challenge_method': 'S256',
    },
  );
}

/// Validated authorization callback data.
final class AuthorizationCallback {
  /// Creates a callback after strict URI and state validation.
  AuthorizationCallback._({
    required this.authorizationCode,
    required this.state,
  });

  /// Parses an OAuth callback without retaining its raw URI.
  factory AuthorizationCallback.parse({
    required Uri callback,
    required Uri expectedRedirectUri,
    required String expectedState,
  }) {
    if (!_matchesRedirect(callback, expectedRedirectUri) ||
        callback.hasFragment) {
      throw const SessionInvariantException(
        'Authorization callback did not match the reviewed redirect URI.',
      );
    }

    final states = callback.queryParametersAll['state'] ?? const <String>[];
    if (states.length != 1 || states.single != expectedState) {
      throw const SessionInvariantException(
        'Authorization callback state validation failed.',
      );
    }

    final errors = callback.queryParametersAll['error'] ?? const <String>[];
    if (errors.isNotEmpty) {
      throw const SessionInvariantException(
        'Authorization provider returned an OAuth error.',
      );
    }

    final codes = callback.queryParametersAll['code'] ?? const <String>[];
    if (codes.length != 1 || codes.single.trim().isEmpty) {
      throw const SessionInvariantException(
        'Authorization callback must contain one code.',
      );
    }

    return AuthorizationCallback._(
      authorizationCode: codes.single,
      state: states.single,
    );
  }

  /// One-time authorization code passed to the protected token adapter.
  final String authorizationCode;

  /// Validated state value.
  final String state;

  static bool _matchesRedirect(Uri callback, Uri expected) =>
      callback.scheme == expected.scheme &&
      callback.userInfo == expected.userInfo &&
      callback.host == expected.host &&
      callback.port == expected.port &&
      callback.path == expected.path;
}

/// Credential-free session metadata used to gate client behaviour.
final class SessionSnapshot {
  SessionSnapshot._({
    required this.phase,
    required this.assurance,
    required this.authorizationCorrelationReference,
    required this.sessionReference,
    required this.deviceReference,
    required this.activeWorkspaceContext,
    required this.accessTokenExpiresAtUtc,
    required this.reauthenticationAfterUtc,
    required this.blockReason,
    required this.requiresRestrictedDataPurge,
  }) {
    _validate();
  }

  /// Creates a clean signed-out snapshot.
  factory SessionSnapshot.signedOut() => SessionSnapshot._(
    phase: SessionPhase.signedOut,
    assurance: SessionAssurance.anonymous,
    authorizationCorrelationReference: null,
    sessionReference: null,
    deviceReference: null,
    activeWorkspaceContext: null,
    accessTokenExpiresAtUtc: null,
    reauthenticationAfterUtc: null,
    blockReason: null,
    requiresRestrictedDataPurge: false,
  );

  /// Current lifecycle phase.
  final SessionPhase phase;

  /// Current server-reported assurance.
  final SessionAssurance assurance;

  /// Opaque non-secret correlation reference for an active browser flow.
  final String? authorizationCorrelationReference;

  /// Opaque server session reference; never an access or refresh token.
  final String? sessionReference;

  /// Opaque registered device reference.
  final String? deviceReference;

  /// Opaque server-issued active workspace context.
  final String? activeWorkspaceContext;

  /// Access-token expiry metadata. The access token itself is not stored here.
  final DateTime? accessTokenExpiresAtUtc;

  /// Time after which privileged operations require step-up.
  final DateTime? reauthenticationAfterUtc;

  /// Safe machine-readable block or revocation reason.
  final String? blockReason;

  /// Whether restricted cached data must remain unavailable until purged.
  final bool requiresRestrictedDataPurge;

  /// Starts an external-browser authorization flow.
  SessionSnapshot beginAuthorization({required String correlationReference}) {
    if (phase != SessionPhase.signedOut ||
        correlationReference.trim().isEmpty) {
      throw const SessionInvariantException(
        'Authorization may start only from signed-out state.',
      );
    }
    return SessionSnapshot._(
      phase: SessionPhase.authorizing,
      assurance: SessionAssurance.anonymous,
      authorizationCorrelationReference: correlationReference,
      sessionReference: null,
      deviceReference: null,
      activeWorkspaceContext: null,
      accessTokenExpiresAtUtc: null,
      reauthenticationAfterUtc: null,
      blockReason: null,
      requiresRestrictedDataPurge: false,
    );
  }

  /// Activates credential-free session metadata after protected token exchange.
  SessionSnapshot activate({
    required String sessionReference,
    required String deviceReference,
    required String workspaceContext,
    required SessionAssurance assurance,
    required DateTime accessTokenExpiresAtUtc,
    required DateTime? reauthenticationAfterUtc,
  }) {
    if (phase != SessionPhase.authorizing ||
        assurance == SessionAssurance.anonymous) {
      throw const SessionInvariantException(
        'Only an authorizing session may become active.',
      );
    }
    return SessionSnapshot._(
      phase: SessionPhase.active,
      assurance: assurance,
      authorizationCorrelationReference: null,
      sessionReference: sessionReference,
      deviceReference: deviceReference,
      activeWorkspaceContext: workspaceContext,
      accessTokenExpiresAtUtc: accessTokenExpiresAtUtc,
      reauthenticationAfterUtc: reauthenticationAfterUtc,
      blockReason: null,
      requiresRestrictedDataPurge: false,
    );
  }

  /// Marks a privileged operation as requiring current higher assurance.
  SessionSnapshot requireStepUp({required String reason}) {
    if (phase != SessionPhase.active || reason.trim().isEmpty) {
      throw const SessionInvariantException(
        'Step-up may be requested only for an active session.',
      );
    }
    return _copy(phase: SessionPhase.stepUpRequired, blockReason: reason);
  }

  /// Completes a server-approved step-up without changing session scope.
  SessionSnapshot completeStepUp({required DateTime reauthenticationAfterUtc}) {
    if (phase != SessionPhase.stepUpRequired) {
      throw const SessionInvariantException(
        'Step-up completion requires step-up state.',
      );
    }
    return _copy(
      phase: SessionPhase.active,
      assurance: SessionAssurance.aal2,
      reauthenticationAfterUtc: reauthenticationAfterUtc,
      clearBlockReason: true,
    );
  }

  /// Applies remote or self revocation and immediately blocks restricted data.
  SessionSnapshot revoke({required String reason}) {
    if (reason.trim().isEmpty) {
      throw const SessionInvariantException('Revocation reason is required.');
    }
    return _copy(
      phase: SessionPhase.revoked,
      blockReason: reason,
      requiresRestrictedDataPurge: true,
    );
  }

  /// Blocks operation for compatibility, policy, or explicit recovery.
  SessionSnapshot block({
    required String reason,
    required bool purgeRestrictedData,
  }) {
    if (reason.trim().isEmpty) {
      throw const SessionInvariantException('Block reason is required.');
    }
    return _copy(
      phase: SessionPhase.blocked,
      blockReason: reason,
      requiresRestrictedDataPurge: purgeRestrictedData,
    );
  }

  /// Signs out and requires restricted local data to be purged or locked.
  SessionSnapshot signOut() => SessionSnapshot._(
    phase: SessionPhase.signedOut,
    assurance: SessionAssurance.anonymous,
    authorizationCorrelationReference: null,
    sessionReference: null,
    deviceReference: null,
    activeWorkspaceContext: null,
    accessTokenExpiresAtUtc: null,
    reauthenticationAfterUtc: null,
    blockReason: null,
    requiresRestrictedDataPurge: true,
  );

  /// Records completion of the restricted-cache purge/lock operation.
  SessionSnapshot confirmRestrictedDataPurged() {
    if (!requiresRestrictedDataPurge) {
      throw const SessionInvariantException(
        'No restricted-data purge is pending.',
      );
    }
    return _copy(requiresRestrictedDataPurge: false);
  }

  /// Whether background or foreground synchronisation may run now.
  bool canSynchronizeAt(DateTime nowUtc) =>
      phase == SessionPhase.active &&
      !requiresRestrictedDataPurge &&
      accessTokenExpiresAtUtc!.isAfter(_requireUtc(nowUtc));

  /// Whether the current metadata permits a privileged online attempt.
  ///
  /// The server still authorises the command and assurance independently.
  bool canAttemptPrivilegedActionAt(DateTime nowUtc) {
    final now = _requireUtc(nowUtc);
    return phase == SessionPhase.active &&
        assurance == SessionAssurance.aal2 &&
        !requiresRestrictedDataPurge &&
        accessTokenExpiresAtUtc!.isAfter(now) &&
        (reauthenticationAfterUtc == null ||
            reauthenticationAfterUtc!.isAfter(now));
  }

  SessionSnapshot _copy({
    SessionPhase? phase,
    SessionAssurance? assurance,
    DateTime? reauthenticationAfterUtc,
    String? blockReason,
    bool clearBlockReason = false,
    bool? requiresRestrictedDataPurge,
  }) => SessionSnapshot._(
    phase: phase ?? this.phase,
    assurance: assurance ?? this.assurance,
    authorizationCorrelationReference: authorizationCorrelationReference,
    sessionReference: sessionReference,
    deviceReference: deviceReference,
    activeWorkspaceContext: activeWorkspaceContext,
    accessTokenExpiresAtUtc: accessTokenExpiresAtUtc,
    reauthenticationAfterUtc:
        reauthenticationAfterUtc ?? this.reauthenticationAfterUtc,
    blockReason: clearBlockReason ? null : blockReason ?? this.blockReason,
    requiresRestrictedDataPurge:
        requiresRestrictedDataPurge ?? this.requiresRestrictedDataPurge,
  );

  void _validate() {
    if (accessTokenExpiresAtUtc?.isUtc == false ||
        reauthenticationAfterUtc?.isUtc == false) {
      throw const SessionInvariantException('Session timestamps must be UTC.');
    }

    switch (phase) {
      case SessionPhase.signedOut:
        if (assurance != SessionAssurance.anonymous ||
            authorizationCorrelationReference != null ||
            sessionReference != null ||
            deviceReference != null ||
            activeWorkspaceContext != null ||
            accessTokenExpiresAtUtc != null ||
            reauthenticationAfterUtc != null) {
          throw const SessionInvariantException(
            'Signed-out state cannot retain authenticated session metadata.',
          );
        }
      case SessionPhase.authorizing:
        if (authorizationCorrelationReference == null ||
            assurance != SessionAssurance.anonymous ||
            sessionReference != null ||
            deviceReference != null ||
            activeWorkspaceContext != null ||
            accessTokenExpiresAtUtc != null) {
          throw const SessionInvariantException(
            'Authorizing state may retain only its correlation reference.',
          );
        }
      case SessionPhase.active:
      case SessionPhase.stepUpRequired:
        if (assurance == SessionAssurance.anonymous ||
            sessionReference == null ||
            sessionReference!.trim().isEmpty ||
            deviceReference == null ||
            deviceReference!.trim().isEmpty ||
            activeWorkspaceContext == null ||
            activeWorkspaceContext!.trim().isEmpty ||
            accessTokenExpiresAtUtc == null ||
            requiresRestrictedDataPurge) {
          throw const SessionInvariantException(
            'Active session state requires bounded authenticated metadata.',
          );
        }
      case SessionPhase.revoked:
      case SessionPhase.blocked:
        if (blockReason == null || blockReason!.trim().isEmpty) {
          throw const SessionInvariantException(
            'Revoked and blocked states require a safe reason.',
          );
        }
    }
  }

  static DateTime _requireUtc(DateTime value) {
    if (!value.isUtc) {
      throw const SessionInvariantException('Current time must be UTC.');
    }
    return value;
  }
}

/// Stable cache and operation partition for one user and workspace context.
final class WorkspacePartitionKey {
  /// Creates a scope-isolated partition key.
  WorkspacePartitionKey({
    required this.userReference,
    required this.tenantReference,
    required this.workspaceContext,
  }) {
    if (userReference.trim().isEmpty ||
        tenantReference.trim().isEmpty ||
        workspaceContext.trim().isEmpty) {
      throw const SessionInvariantException(
        'Workspace partition references must be non-empty.',
      );
    }
  }

  /// Opaque authenticated user reference.
  final String userReference;

  /// Opaque tenant reference.
  final String tenantReference;

  /// Opaque server-issued workspace context.
  final String workspaceContext;

  /// Deterministic local partition identifier.
  String get stableKey => <String>[
    userReference,
    tenantReference,
    workspaceContext,
  ].map(Uri.encodeComponent).join('|');

  @override
  bool operator ==(Object other) =>
      other is WorkspacePartitionKey &&
      other.userReference == userReference &&
      other.tenantReference == tenantReference &&
      other.workspaceContext == workspaceContext;

  @override
  int get hashCode =>
      Object.hash(userReference, tenantReference, workspaceContext);
}

/// Required client actions before changing workspace scope.
final class WorkspaceSwitchPlan {
  /// Creates a defensive switch plan from current and next partitions.
  WorkspaceSwitchPlan({required this.current, required this.next});

  /// Current local partition.
  final WorkspacePartitionKey current;

  /// Requested next local partition.
  final WorkspacePartitionKey next;

  /// Whether the requested context changes local isolation scope.
  bool get scopeChanges => current != next;

  /// Sync must stop before a scope-changing bootstrap request.
  bool get stopSyncBeforeSelection => scopeChanges;

  /// Presentation state must not show the previous workspace while loading.
  bool get clearPresentationBeforeSelection => scopeChanges;

  /// Previous restricted projections must be purged or locked on scope change.
  bool get purgeOrLockPreviousRestrictedCache => scopeChanges;

  /// A fresh server bootstrap is required; selection is never an auth grant.
  bool get requiresServerValidatedBootstrap => scopeChanges;
}
