import 'package:flutter_test/flutter_test.dart';
import 'package:store_companion_runtime_config/store_companion_runtime_config.dart';

void main() {
  test(
    'synthetic development config keeps environment boundaries explicit',
    () {
      final config = MobileRuntimeConfig.syntheticDevelopment();

      expect(config.environment, MobileEnvironment.development);
      expect(config.applicationId, 'com.ozzyl.storecompanion.dev');
      expect(config.redirectUri.scheme, config.applicationId);
      expect(
        config.resolveApiPath('/mobile/bootstrap').toString(),
        'https://api.store-companion.dev.test/v1/mobile/bootstrap',
      );
      expect(
        config.acceptsDeepLink(
          Uri.parse('https://links.store-companion.dev.test/approvals/opaque'),
        ),
        isTrue,
      );
    },
  );

  test('rejects insecure API endpoint', () {
    expect(
      () => MobileRuntimeConfig(
        environment: MobileEnvironment.development,
        applicationId: 'com.ozzyl.storecompanion.dev',
        displayName: 'Store Companion Dev',
        apiBaseUri: Uri.parse('http://localhost:8787/v1/'),
        authorizationEndpoint: Uri.parse(
          'https://identity.store-companion.dev.test/authorize',
        ),
        redirectUri: Uri.parse('com.ozzyl.storecompanion.dev://oauth/callback'),
        allowedDeepLinkHosts: const <String>{'links.store-companion.dev.test'},
      ),
      throwsA(isA<RuntimeConfigurationException>()),
    );
  });

  test('rejects production placeholder hosts', () {
    expect(
      () => MobileRuntimeConfig(
        environment: MobileEnvironment.production,
        applicationId: 'com.ozzyl.storecompanion',
        displayName: 'Store Companion',
        apiBaseUri: Uri.parse('https://api.example.com/v1/'),
        authorizationEndpoint: Uri.parse(
          'https://identity.example.com/authorize',
        ),
        redirectUri: Uri.parse('com.ozzyl.storecompanion://oauth/callback'),
        allowedDeepLinkHosts: const <String>{'links.example.com'},
      ),
      throwsA(isA<RuntimeConfigurationException>()),
    );
  });

  test('rejects redirect scheme that does not match application ID', () {
    expect(
      () => MobileRuntimeConfig(
        environment: MobileEnvironment.staging,
        applicationId: 'com.ozzyl.storecompanion.staging',
        displayName: 'Store Companion Staging',
        apiBaseUri: Uri.parse('https://api.store-companion.staging.test/v1/'),
        authorizationEndpoint: Uri.parse(
          'https://identity.store-companion.staging.test/authorize',
        ),
        redirectUri: Uri.parse('com.ozzyl.storecompanion://oauth/callback'),
        allowedDeepLinkHosts: const <String>{
          'links.store-companion.staging.test',
        },
      ),
      throwsA(isA<RuntimeConfigurationException>()),
    );
  });

  test('rejects host-changing API path', () {
    final config = MobileRuntimeConfig.syntheticDevelopment();

    expect(
      () => config.resolveApiPath('//attacker.example/path'),
      throwsA(isA<RuntimeConfigurationException>()),
    );
  });
}
