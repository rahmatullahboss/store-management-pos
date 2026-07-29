/// Versioned first-party Store Companion transport contracts.
///
/// These models describe the approved client boundary from CCR-0003. They do
/// not grant authority and do not imply that the server routes are deployed.
library;

/// Raised when a transport payload violates the declared mobile contract.
final class MobileContractException implements FormatException {
  /// Creates a contract parsing failure.
  const MobileContractException(this.message, [this.source, this.offset]);

  @override
  final String message;

  @override
  final Object? source;

  @override
  final int? offset;

  @override
  String toString() => 'MobileContractException: $message';
}

/// Stable server error envelope used by the mobile client.
final class MobileApiError {
  /// Creates an immutable API error.
  MobileApiError({
    required this.code,
    required this.message,
    required this.traceId,
    required this.retryable,
    required this.recovery,
    required Map<String, Object?> details,
  }) : details = Map<String, Object?>.unmodifiable(details);

  /// Parses a standard `{ "error": { ... } }` response.
  factory MobileApiError.fromEnvelope(Map<String, Object?> envelope) {
    final error = _requiredMap(envelope, 'error');
    return MobileApiError(
      code: _requiredString(error, 'code'),
      message: _requiredString(error, 'message'),
      traceId: _requiredString(error, 'trace_id'),
      retryable: _requiredBool(error, 'retryable'),
      recovery: _optionalString(error, 'recovery'),
      details: _optionalMap(error, 'details') ?? const <String, Object?>{},
    );
  }

  /// Stable machine-readable code.
  final String code;

  /// Safe localized or fallback human-readable message.
  final String message;

  /// Server trace reference for authorised support diagnostics.
  final String traceId;

  /// Whether the server classified the failure as retryable.
  final bool retryable;

  /// Optional stable recovery hint.
  final String? recovery;

  /// Safe structured details only.
  final Map<String, Object?> details;
}

/// One server-approved tenant/location/persona context.
final class MobileWorkspaceContract {
  /// Creates an immutable workspace contract.
  MobileWorkspaceContract({
    required this.contextId,
    required this.tenantId,
    required this.label,
    required this.persona,
    required this.capabilitiesVersion,
    required this.legalEntityId,
    required this.storeId,
    required this.warehouseId,
  });

  /// Parses one workspace from `mobile-bootstrap.v1`.
  factory MobileWorkspaceContract.fromJson(Map<String, Object?> json) =>
      MobileWorkspaceContract(
        contextId: _requiredString(json, 'context_id'),
        tenantId: _requiredString(json, 'tenant_id'),
        label: _requiredString(json, 'label'),
        persona: _requiredString(json, 'persona'),
        capabilitiesVersion: _requiredString(json, 'capabilities_version'),
        legalEntityId: _optionalString(json, 'legal_entity_id'),
        storeId: _optionalString(json, 'store_id'),
        warehouseId: _optionalString(json, 'warehouse_id'),
      );

  /// Opaque server-issued workspace reference.
  final String contextId;

  /// Opaque tenant reference.
  final String tenantId;

  /// Human-readable workspace label.
  final String label;

  /// Presentation persona string. Server capabilities remain authoritative.
  final String persona;

  /// Version of the effective capability snapshot.
  final String capabilitiesVersion;

  /// Optional legal-entity reference.
  final String? legalEntityId;

  /// Optional store reference.
  final String? storeId;

  /// Optional warehouse reference.
  final String? warehouseId;
}

/// Effective localisation and business-time context.
final class MobileLocalisationContract {
  /// Creates immutable effective localisation metadata.
  MobileLocalisationContract({
    required this.uiLocale,
    required List<String> fallbackLocales,
    required this.timezone,
    required this.businessDate,
    required this.currency,
    required this.currencyMetadataVersion,
    required this.countryPack,
    required this.rtl,
  }) : fallbackLocales = List<String>.unmodifiable(fallbackLocales);

  /// Parses localisation metadata from `mobile-bootstrap.v1`.
  factory MobileLocalisationContract.fromJson(Map<String, Object?> json) =>
      MobileLocalisationContract(
        uiLocale: _requiredString(json, 'ui_locale'),
        fallbackLocales: _requiredStringList(json, 'fallback_locales'),
        timezone: _requiredString(json, 'timezone'),
        businessDate: _requiredString(json, 'business_date'),
        currency: _requiredString(json, 'currency'),
        currencyMetadataVersion: _requiredString(
          json,
          'currency_metadata_version',
        ),
        countryPack: _requiredString(json, 'country_pack'),
        rtl: _requiredBool(json, 'rtl'),
      );

  /// BCP 47 user-interface locale.
  final String uiLocale;

  /// Ordered fallback locale identifiers.
  final List<String> fallbackLocales;

  /// IANA timezone identifier.
  final String timezone;

  /// Effective business date in ISO calendar format.
  final String businessDate;

  /// Three-letter currency code where applicable.
  final String currency;

  /// Exact metadata/version used for currency display.
  final String currencyMetadataVersion;

  /// Effective signed country-pack reference.
  final String countryPack;

  /// Whether the effective interface direction is RTL.
  final bool rtl;
}

/// Supported client/server compatibility window.
final class MobileCompatibilityContract {
  /// Creates compatibility metadata.
  MobileCompatibilityContract({
    required this.minimumClientVersion,
    required this.recommendedClientVersion,
    required List<String> apiVersions,
    required List<String> syncVersions,
    required this.localSchemaMin,
    required this.localSchemaMax,
  }) : apiVersions = List<String>.unmodifiable(apiVersions),
       syncVersions = List<String>.unmodifiable(syncVersions) {
    if (localSchemaMin < 1 || localSchemaMax < localSchemaMin) {
      throw const MobileContractException(
        'Invalid local schema compatibility range.',
      );
    }
  }

  /// Parses compatibility metadata from `mobile-bootstrap.v1`.
  factory MobileCompatibilityContract.fromJson(Map<String, Object?> json) =>
      MobileCompatibilityContract(
        minimumClientVersion: _requiredString(json, 'minimum_client_version'),
        recommendedClientVersion: _requiredString(
          json,
          'recommended_client_version',
        ),
        apiVersions: _requiredStringList(json, 'api_versions'),
        syncVersions: _requiredStringList(json, 'sync_versions'),
        localSchemaMin: _requiredInt(json, 'local_schema_min'),
        localSchemaMax: _requiredInt(json, 'local_schema_max'),
      );

  /// Oldest supported semantic client version.
  final String minimumClientVersion;

  /// Recommended semantic client version.
  final String recommendedClientVersion;

  /// Supported API major/version identifiers.
  final List<String> apiVersions;

  /// Supported sync contract identifiers.
  final List<String> syncVersions;

  /// Oldest compatible local schema version.
  final int localSchemaMin;

  /// Newest compatible local schema version.
  final int localSchemaMax;
}

/// Bounded mobile bootstrap envelope.
final class MobileBootstrapContract {
  /// Creates an immutable bootstrap contract.
  MobileBootstrapContract({
    required this.contractVersion,
    required this.serverTime,
    required List<MobileWorkspaceContract> workspaces,
    required this.activeWorkspace,
    required Set<String> capabilities,
    required this.localisation,
    required this.compatibility,
  }) : workspaces = List<MobileWorkspaceContract>.unmodifiable(workspaces),
       capabilities = Set<String>.unmodifiable(capabilities) {
    if (contractVersion != 'mobile-bootstrap.v1') {
      throw MobileContractException(
        'Unsupported bootstrap contract: $contractVersion.',
      );
    }
    if (workspaces.isEmpty) {
      throw const MobileContractException(
        'Bootstrap must contain at least one workspace.',
      );
    }
    if (!workspaces.any(
      (MobileWorkspaceContract workspace) =>
          workspace.contextId == activeWorkspace,
    )) {
      throw const MobileContractException(
        'Active workspace must reference an available workspace.',
      );
    }
  }

  /// Parses the bounded `mobile-bootstrap.v1` envelope.
  factory MobileBootstrapContract.fromJson(Map<String, Object?> json) =>
      MobileBootstrapContract(
        contractVersion: _requiredString(json, 'contract_version'),
        serverTime: DateTime.parse(_requiredString(json, 'server_time')),
        workspaces: _requiredMapList(json, 'workspaces')
            .map(MobileWorkspaceContract.fromJson)
            .toList(growable: false),
        activeWorkspace: _requiredString(json, 'active_workspace'),
        capabilities: _requiredStringList(json, 'capabilities').toSet(),
        localisation: MobileLocalisationContract.fromJson(
          _requiredMap(json, 'localisation'),
        ),
        compatibility: MobileCompatibilityContract.fromJson(
          _requiredMap(json, 'compatibility'),
        ),
      );

  /// Exact contract identifier.
  final String contractVersion;

  /// Server UTC time used for skew/freshness decisions.
  final DateTime serverTime;

  /// Server-approved selectable contexts.
  final List<MobileWorkspaceContract> workspaces;

  /// Opaque active workspace reference.
  final String activeWorkspace;

  /// Effective client capability identifiers.
  final Set<String> capabilities;

  /// Effective localisation/time/currency context.
  final MobileLocalisationContract localisation;

  /// Client/server compatibility window.
  final MobileCompatibilityContract compatibility;

  /// Whether this bootstrap includes a capability in the current snapshot.
  bool can(String capability) => capabilities.contains(capability);
}

/// One queued mobile operation using a task-oriented owning-module command.
final class MobileOperationContract {
  /// Creates an immutable operation envelope.
  MobileOperationContract({
    required this.operationId,
    required this.localSequence,
    required this.operationType,
    required this.schemaVersion,
    required this.createdAtUtc,
    required this.businessDate,
    required this.idempotencyKey,
    required this.payloadHash,
    required Map<String, Object?> payload,
    required List<String> dependencies,
    required this.baseVersion,
  }) : payload = Map<String, Object?>.unmodifiable(payload),
       dependencies = List<String>.unmodifiable(dependencies) {
    if (localSequence < 1 || schemaVersion < 1) {
      throw const MobileContractException(
        'Operation sequence and schema version must be positive.',
      );
    }
  }

  /// Parses one operation from `mobile-operation-batch.v1`.
  factory MobileOperationContract.fromJson(Map<String, Object?> json) =>
      MobileOperationContract(
        operationId: _requiredString(json, 'operation_id'),
        localSequence: _requiredInt(json, 'local_sequence'),
        operationType: _requiredString(json, 'operation_type'),
        schemaVersion: _requiredInt(json, 'schema_version'),
        createdAtUtc: DateTime.parse(_requiredString(json, 'created_at_utc')),
        businessDate: _requiredString(json, 'business_date'),
        idempotencyKey: _requiredString(json, 'idempotency_key'),
        payloadHash: _requiredString(json, 'payload_hash'),
        payload: _requiredMap(json, 'payload'),
        dependencies: _optionalStringList(json, 'dependencies'),
        baseVersion: _optionalString(json, 'base_version'),
      );

  /// Client-generated UUIDv7-style operation identifier.
  final String operationId;

  /// Monotonic sequence inside one device/workspace stream.
  final int localSequence;

  /// Versioned owning-module business intent.
  final String operationType;

  /// Payload schema version.
  final int schemaVersion;

  /// Device-recorded UTC creation time.
  final DateTime createdAtUtc;

  /// Store/legal-entity business date.
  final String businessDate;

  /// Stable idempotency key.
  final String idempotencyKey;

  /// SHA-256-style normalized payload digest.
  final String payloadHash;

  /// Bounded operation payload passed to the owning command adapter.
  final Map<String, Object?> payload;

  /// Operation IDs that must complete first.
  final List<String> dependencies;

  /// Optional optimistic resource version.
  final String? baseVersion;
}

/// One per-operation server result.
final class MobileOperationResultContract {
  /// Creates an immutable operation result.
  MobileOperationResultContract({
    required this.operationId,
    required this.status,
    required this.serverReference,
    required this.serverVersion,
    required this.traceId,
    required this.error,
    required List<Map<String, Object?>> adjustments,
  }) : adjustments = List<Map<String, Object?>>.unmodifiable(
         adjustments.map(Map<String, Object?>.unmodifiable),
       );

  /// Parses one result while preserving unknown additive status values.
  factory MobileOperationResultContract.fromJson(Map<String, Object?> json) =>
      MobileOperationResultContract(
        operationId: _requiredString(json, 'operation_id'),
        status: _requiredString(json, 'status'),
        serverReference: _optionalString(json, 'server_reference'),
        serverVersion: _optionalString(json, 'server_version'),
        traceId: _requiredString(json, 'trace_id'),
        error: switch (json['error']) {
          null => null,
          final Map<Object?, Object?> value => MobileApiError.fromEnvelope(
            <String, Object?>{'error': _stringKeyedMap(value)},
          ),
          _ => throw const MobileContractException(
            'Expected operation error to be an object or null.',
          ),
        },
        adjustments: _optionalMapList(json, 'adjustments'),
      );

  /// Original operation ID.
  final String operationId;

  /// Raw versioned/additive status string.
  final String status;

  /// Optional authoritative source/result reference.
  final String? serverReference;

  /// Optional authoritative resource version.
  final String? serverVersion;

  /// Trace reference for support and reconciliation.
  final String traceId;

  /// Optional stable server error.
  final MobileApiError? error;

  /// Safe explicit server adjustments.
  final List<Map<String, Object?>> adjustments;

  /// Whether the status indicates an accepted business result.
  bool get accepted =>
      status == 'accepted' ||
      status == 'accepted_with_adjustment' ||
      status == 'duplicate_replay';

  /// Whether the client must avoid blind automatic retry.
  bool get blocksBlindRetry =>
      status == 'unknown_external_state' ||
      status == 'requires_online_confirmation';
}

Map<String, Object?> _requiredMap(
  Map<String, Object?> source,
  String key,
) {
  final value = source[key];
  if (value case final Map<Object?, Object?> map) {
    return _stringKeyedMap(map);
  }
  throw MobileContractException('Expected "$key" to be an object.', source);
}

Map<String, Object?>? _optionalMap(
  Map<String, Object?> source,
  String key,
) {
  final value = source[key];
  if (value == null) {
    return null;
  }
  if (value case final Map<Object?, Object?> map) {
    return _stringKeyedMap(map);
  }
  throw MobileContractException('Expected "$key" to be an object.', source);
}

List<Map<String, Object?>> _requiredMapList(
  Map<String, Object?> source,
  String key,
) {
  final value = source[key];
  if (value case final List<Object?> values) {
    return values.map((Object? item) {
      if (item case final Map<Object?, Object?> map) {
        return _stringKeyedMap(map);
      }
      throw MobileContractException(
        'Expected every "$key" item to be an object.',
        source,
      );
    }).toList(growable: false);
  }
  throw MobileContractException('Expected "$key" to be a list.', source);
}

List<Map<String, Object?>> _optionalMapList(
  Map<String, Object?> source,
  String key,
) {
  if (!source.containsKey(key) || source[key] == null) {
    return const <Map<String, Object?>>[];
  }
  return _requiredMapList(source, key);
}

String _requiredString(Map<String, Object?> source, String key) {
  final value = source[key];
  if (value is String && value.isNotEmpty) {
    return value;
  }
  throw MobileContractException(
    'Expected "$key" to be a non-empty string.',
    source,
  );
}

String? _optionalString(Map<String, Object?> source, String key) {
  final value = source[key];
  if (value == null) {
    return null;
  }
  if (value is String && value.isNotEmpty) {
    return value;
  }
  throw MobileContractException(
    'Expected "$key" to be a non-empty string or null.',
    source,
  );
}

bool _requiredBool(Map<String, Object?> source, String key) {
  final value = source[key];
  if (value is bool) {
    return value;
  }
  throw MobileContractException('Expected "$key" to be a boolean.', source);
}

int _requiredInt(Map<String, Object?> source, String key) {
  final value = source[key];
  if (value is int) {
    return value;
  }
  if (value is String) {
    final parsed = int.tryParse(value);
    if (parsed != null) {
      return parsed;
    }
  }
  throw MobileContractException('Expected "$key" to be an integer.', source);
}

List<String> _requiredStringList(
  Map<String, Object?> source,
  String key,
) {
  final value = source[key];
  if (value case final List<Object?> values) {
    final result = <String>[];
    for (final item in values) {
      if (item is! String || item.isEmpty) {
        throw MobileContractException(
          'Expected every "$key" item to be a non-empty string.',
          source,
        );
      }
      result.add(item);
    }
    return List<String>.unmodifiable(result);
  }
  throw MobileContractException('Expected "$key" to be a list.', source);
}

List<String> _optionalStringList(
  Map<String, Object?> source,
  String key,
) {
  if (!source.containsKey(key) || source[key] == null) {
    return const <String>[];
  }
  return _requiredStringList(source, key);
}

Map<String, Object?> _stringKeyedMap(Map<Object?, Object?> source) {
  final result = <String, Object?>{};
  for (final entry in source.entries) {
    if (entry.key case final String key) {
      result[key] = entry.value;
    } else {
      throw MobileContractException(
        'Expected every JSON object key to be a string.',
        source,
      );
    }
  }
  return result;
}
