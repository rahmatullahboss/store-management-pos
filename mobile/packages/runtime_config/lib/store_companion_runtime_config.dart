/// Fail-closed deployment environment and endpoint configuration for Store
/// Companion.
///
/// This package contains no credentials and does not permit a user-selected API
/// host. Native build flavours inject reviewed values into this model.
library;

/// Raised when a mobile runtime configuration violates an environment boundary.
final class RuntimeConfigurationException implements Exception {
  /// Creates a safe configuration failure.
  const RuntimeConfigurationException(this.message);

  /// Safe diagnostic message.
  final String message;

  @override
  String toString() => 'RuntimeConfigurationException: $message';
}

/// Supported Store Companion deployment environment.
enum MobileEnvironment {
  /// Developer and synthetic integration builds.
  development,

  /// Internal, QA, and closed-pilot builds.
  staging,

  /// Reviewed production builds only.
  production,
}

/// Immutable runtime configuration supplied by one reviewed native flavour.
final class MobileRuntimeConfig {
  /// Creates and validates a runtime configuration.
  MobileRuntimeConfig({
    required this.environment,
    required this.applicationId,
    required this.displayName,
    required this.apiBaseUri,
    required this.authorizationEndpoint,
    required this.redirectUri,
    required Set<String> allowedDeepLinkHosts,
  }) : allowedDeepLinkHosts = Set<String>.unmodifiable(
         allowedDeepLinkHosts.map((String host) => host.toLowerCase()),
       ) {
    _validate();
  }

  /// Resolves compile-time flavour values without accepting a runtime host.
  ///
  /// Development and staging use deterministic `.test` endpoints when no
  /// explicit values are supplied. Production requires all reviewed values and
  /// fails before the application shell is created when any value is missing.
  factory MobileRuntimeConfig.fromEnvironment({
    String environmentName = const String.fromEnvironment('APP_ENVIRONMENT'),
    String apiBaseUri = const String.fromEnvironment('APP_API_BASE_URI'),
    String authorizationEndpoint = const String.fromEnvironment(
      'APP_AUTHORIZATION_ENDPOINT',
    ),
    String redirectUri = const String.fromEnvironment('APP_REDIRECT_URI'),
    String deepLinkHosts = const String.fromEnvironment('APP_DEEP_LINK_HOSTS'),
  }) {
    final environment = switch (environmentName) {
      'development' => MobileEnvironment.development,
      'staging' => MobileEnvironment.staging,
      'production' => MobileEnvironment.production,
      _ => throw const RuntimeConfigurationException(
        'APP_ENVIRONMENT must be development, staging, or production.',
      ),
    };

    final supplied = <String>[
      apiBaseUri,
      authorizationEndpoint,
      redirectUri,
      deepLinkHosts,
    ];
    final hasAnyReviewedValue = supplied.any(
      (String value) => value.trim().isNotEmpty,
    );
    final hasAllReviewedValues = supplied.every(
      (String value) => value.trim().isNotEmpty,
    );

    if (!hasAnyReviewedValue) {
      return switch (environment) {
        MobileEnvironment.development =>
          MobileRuntimeConfig.syntheticDevelopment(),
        MobileEnvironment.staging => MobileRuntimeConfig.syntheticStaging(),
        MobileEnvironment.production =>
          throw const RuntimeConfigurationException(
            'Production requires explicit reviewed endpoint configuration.',
          ),
      };
    }
    if (!hasAllReviewedValues) {
      throw const RuntimeConfigurationException(
        'Runtime endpoint configuration must be supplied as one complete set.',
      );
    }

    final identity = _identityFor(environment);
    return MobileRuntimeConfig(
      environment: environment,
      applicationId: identity.applicationId,
      displayName: identity.displayName,
      apiBaseUri: Uri.parse(apiBaseUri),
      authorizationEndpoint: Uri.parse(authorizationEndpoint),
      redirectUri: Uri.parse(redirectUri),
      allowedDeepLinkHosts: deepLinkHosts
          .split(',')
          .map((String host) => host.trim())
          .where((String host) => host.isNotEmpty)
          .toSet(),
    );
  }

  /// Creates a deterministic synthetic development configuration.
  factory MobileRuntimeConfig.syntheticDevelopment() => MobileRuntimeConfig(
    environment: MobileEnvironment.development,
    applicationId: 'com.ozzyl.storecompanion.dev',
    displayName: 'Store Companion Dev',
    apiBaseUri: Uri.parse('https://api.store-companion.dev.test/v1/'),
    authorizationEndpoint: Uri.parse(
      'https://identity.store-companion.dev.test/authorize',
    ),
    redirectUri: Uri.parse('com.ozzyl.storecompanion.dev://oauth/callback'),
    allowedDeepLinkHosts: const <String>{'links.store-companion.dev.test'},
  );

  /// Creates a deterministic synthetic staging configuration.
  factory MobileRuntimeConfig.syntheticStaging() => MobileRuntimeConfig(
    environment: MobileEnvironment.staging,
    applicationId: 'com.ozzyl.storecompanion.staging',
    displayName: 'Store Companion Staging',
    apiBaseUri: Uri.parse('https://api.store-companion.staging.test/v1/'),
    authorizationEndpoint: Uri.parse(
      'https://identity.store-companion.staging.test/authorize',
    ),
    redirectUri: Uri.parse('com.ozzyl.storecompanion.staging://oauth/callback'),
    allowedDeepLinkHosts: const <String>{'links.store-companion.staging.test'},
  );

  static final RegExp _applicationIdPattern = RegExp(
    r'^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$',
  );
  static final RegExp _ipv4Pattern = RegExp(r'^\d{1,3}(\.\d{1,3}){3}$');

  /// Build environment represented by this configuration.
  final MobileEnvironment environment;

  /// Android application ID and iOS bundle-identifier authority.
  final String applicationId;

  /// Environment-specific user-visible application name.
  final String displayName;

  /// Fixed versioned API base URI.
  final Uri apiBaseUri;

  /// Fixed OIDC/OAuth authorization endpoint.
  final Uri authorizationEndpoint;

  /// Exact reviewed OAuth callback URI.
  final Uri redirectUri;

  /// Reviewed HTTPS app/universal-link hosts.
  final Set<String> allowedDeepLinkHosts;

  /// Whether this configuration represents production.
  bool get isProduction => environment == MobileEnvironment.production;

  /// Resolves a reviewed relative API path without permitting host override.
  Uri resolveApiPath(String relativePath) {
    final path = Uri.parse(relativePath);
    if (!relativePath.startsWith('/') ||
        path.hasScheme ||
        path.hasAuthority ||
        path.hasQuery ||
        path.hasFragment ||
        path.pathSegments.contains('..')) {
      throw const RuntimeConfigurationException(
        'API path must be an absolute-path reference without traversal.',
      );
    }
    return apiBaseUri.resolve(relativePath.substring(1));
  }

  /// Whether an incoming HTTPS deep link uses a reviewed environment host.
  bool acceptsDeepLink(Uri uri) =>
      uri.scheme == 'https' &&
      uri.userInfo.isEmpty &&
      allowedDeepLinkHosts.contains(uri.host.toLowerCase());

  void _validate() {
    if (!_applicationIdPattern.hasMatch(applicationId)) {
      throw const RuntimeConfigurationException(
        'Application ID must use a reviewed reverse-domain identifier.',
      );
    }
    if (displayName.trim().isEmpty) {
      throw const RuntimeConfigurationException('Display name is required.');
    }

    switch (environment) {
      case MobileEnvironment.development:
        if (!applicationId.endsWith('.dev')) {
          throw const RuntimeConfigurationException(
            'Development application ID must end with .dev.',
          );
        }
      case MobileEnvironment.staging:
        if (!applicationId.endsWith('.staging')) {
          throw const RuntimeConfigurationException(
            'Staging application ID must end with .staging.',
          );
        }
      case MobileEnvironment.production:
        if (applicationId.endsWith('.dev') ||
            applicationId.endsWith('.staging')) {
          throw const RuntimeConfigurationException(
            'Production application ID cannot use a non-production suffix.',
          );
        }
    }

    _validateHttpsEndpoint(apiBaseUri, 'API base URI');
    _validateHttpsEndpoint(authorizationEndpoint, 'Authorization endpoint');
    if (!apiBaseUri.path.endsWith('/')) {
      throw const RuntimeConfigurationException(
        'API base URI path must end with a slash.',
      );
    }

    if (redirectUri.scheme != applicationId ||
        redirectUri.userInfo.isNotEmpty ||
        redirectUri.host != 'oauth' ||
        redirectUri.hasPort ||
        redirectUri.path != '/callback' ||
        redirectUri.hasQuery ||
        redirectUri.hasFragment) {
      throw const RuntimeConfigurationException(
        'OAuth redirect must exactly match <application-id>://oauth/callback.',
      );
    }

    if (allowedDeepLinkHosts.isEmpty ||
        allowedDeepLinkHosts.any(
          (String host) => host.trim().isEmpty || host != host.toLowerCase(),
        )) {
      throw const RuntimeConfigurationException(
        'At least one lowercase reviewed deep-link host is required.',
      );
    }

    if (isProduction) {
      final hosts = <String>{
        apiBaseUri.host.toLowerCase(),
        authorizationEndpoint.host.toLowerCase(),
        ...allowedDeepLinkHosts,
      };
      if (hosts.any(_isUnsafeProductionHost)) {
        throw const RuntimeConfigurationException(
          'Production configuration cannot use placeholder, local, or IP hosts.',
        );
      }
    }
  }

  static ({String applicationId, String displayName}) _identityFor(
    MobileEnvironment environment,
  ) => switch (environment) {
    MobileEnvironment.development => (
      applicationId: 'com.ozzyl.storecompanion.dev',
      displayName: 'Store Companion Dev',
    ),
    MobileEnvironment.staging => (
      applicationId: 'com.ozzyl.storecompanion.staging',
      displayName: 'Store Companion Staging',
    ),
    MobileEnvironment.production => (
      applicationId: 'com.ozzyl.storecompanion',
      displayName: 'Store Companion',
    ),
  };

  static void _validateHttpsEndpoint(Uri uri, String label) {
    if (uri.scheme != 'https' ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment) {
      throw RuntimeConfigurationException('$label must be a clean HTTPS URI.');
    }
  }

  static bool _isUnsafeProductionHost(String host) =>
      host == 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.test') ||
      host.endsWith('.invalid') ||
      host.endsWith('.example') ||
      host.contains('example.') ||
      _ipv4Pattern.hasMatch(host) ||
      host.contains(':');
}
