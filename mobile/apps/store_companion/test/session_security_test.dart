import 'package:flutter_test/flutter_test.dart';
import 'package:store_companion_session_core/store_companion_session_core.dart';

void main() {
  test('builds reviewed OAuth authorization request without verifier', () {
    final redirect = Uri.parse('com.ozzyl.storecompanion://oauth/callback');
    final request = AuthorizationRequest(
      authorizationEndpoint: Uri.parse(
        'https://identity.example.test/authorize',
      ),
      clientId: 'store-companion-mobile',
      redirectUri: redirect,
      scopes: const <String>['openid', 'profile', 'offline_access'],
      state: 'state-state-state-state-state-state-12',
      nonce: 'nonce-nonce-nonce-nonce-nonce-nonce-12',
      codeChallenge: List<String>.filled(43, 'a').join(),
      allowedRedirectUris: <Uri>{redirect},
    );

    expect(request.requestUri.scheme, 'https');
    expect(request.requestUri.queryParameters['response_type'], 'code');
    expect(request.requestUri.queryParameters['code_challenge_method'], 'S256');
    expect(
      request.requestUri.queryParameters.containsKey('code_verifier'),
      isFalse,
    );
  });

  test('rejects OAuth redirect outside exact allowlist', () {
    final reviewed = Uri.parse('com.ozzyl.storecompanion://oauth/callback');

    expect(
      () => AuthorizationRequest(
        authorizationEndpoint: Uri.parse(
          'https://identity.example.test/authorize',
        ),
        clientId: 'store-companion-mobile',
        redirectUri: Uri.parse('com.attacker.app://oauth/callback'),
        scopes: const <String>['openid'],
        state: 'state-state-state-state-state-state-12',
        nonce: 'nonce-nonce-nonce-nonce-nonce-nonce-12',
        codeChallenge: List<String>.filled(43, 'a').join(),
        allowedRedirectUris: <Uri>{reviewed},
      ),
      throwsA(isA<SessionInvariantException>()),
    );
  });

  test('validates callback URI and state before exposing code', () {
    final redirect = Uri.parse('com.ozzyl.storecompanion://oauth/callback');
    final callback = AuthorizationCallback.parse(
      callback: Uri.parse(
        'com.ozzyl.storecompanion://oauth/callback?code=one-time&state=expected-state',
      ),
      expectedRedirectUri: redirect,
      expectedState: 'expected-state',
    );

    expect(callback.authorizationCode, 'one-time');
    expect(
      () => AuthorizationCallback.parse(
        callback: Uri.parse(
          'com.ozzyl.storecompanion://oauth/callback?code=one-time&state=wrong',
        ),
        expectedRedirectUri: redirect,
        expectedState: 'expected-state',
      ),
      throwsA(isA<SessionInvariantException>()),
    );
  });

  test('revocation stops sync and requires restricted-data purge', () {
    final now = DateTime.utc(2026, 7, 29, 13);
    final session = SessionSnapshot.signedOut()
        .beginAuthorization(correlationReference: 'authorization-1')
        .activate(
          sessionReference: 'session-1',
          deviceReference: 'device-1',
          workspaceContext: 'workspace-1',
          assurance: SessionAssurance.aal1,
          accessTokenExpiresAtUtc: now.add(const Duration(minutes: 15)),
          reauthenticationAfterUtc: now.add(const Duration(minutes: 5)),
        );

    expect(session.canSynchronizeAt(now), isTrue);
    expect(session.canAttemptPrivilegedActionAt(now), isFalse);

    final steppedUp = session
        .requireStepUp(reason: 'approval_requires_aal2')
        .completeStepUp(
          reauthenticationAfterUtc: now.add(const Duration(minutes: 10)),
        );

    expect(steppedUp.canAttemptPrivilegedActionAt(now), isTrue);

    final revoked = steppedUp.revoke(reason: 'device_revoked');
    expect(revoked.phase, SessionPhase.revoked);
    expect(revoked.canSynchronizeAt(now), isFalse);
    expect(revoked.requiresRestrictedDataPurge, isTrue);
    expect(
      revoked.confirmRestrictedDataPurged().requiresRestrictedDataPurge,
      isFalse,
    );
  });

  test('workspace switch requires scope isolation actions', () {
    final current = WorkspacePartitionKey(
      userReference: 'user-1',
      tenantReference: 'tenant-1',
      workspaceContext: 'store-1',
    );
    final next = WorkspacePartitionKey(
      userReference: 'user-1',
      tenantReference: 'tenant-1',
      workspaceContext: 'warehouse-1',
    );
    final plan = WorkspaceSwitchPlan(current: current, next: next);

    expect(plan.scopeChanges, isTrue);
    expect(plan.stopSyncBeforeSelection, isTrue);
    expect(plan.clearPresentationBeforeSelection, isTrue);
    expect(plan.purgeOrLockPreviousRestrictedCache, isTrue);
    expect(plan.requiresServerValidatedBootstrap, isTrue);
    expect(current.stableKey, isNot(next.stableKey));
  });
}
