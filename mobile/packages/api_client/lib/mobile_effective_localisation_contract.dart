/// Strict client contract for the integrated MOD-F effective localisation API.
library;

import 'store_companion_api_client.dart';

/// One exact effective currency metadata record.
final class MobileEffectiveCurrencyContract {
  /// Creates validated effective currency metadata.
  MobileEffectiveCurrencyContract({
    required this.currency,
    required this.accountingScale,
    required this.cashIncrementMinor,
    required this.cashRoundingMode,
    required this.metadataVersion,
  }) {
    if (!RegExp(r'^[A-Z]{3}$').hasMatch(currency)) {
      throw MobileContractException(
        'Effective currency must use three uppercase letters: $currency.',
      );
    }
    if (accountingScale < 0 || accountingScale > 12) {
      throw const MobileContractException(
        'Effective accounting scale must be between 0 and 12.',
      );
    }
    if (cashIncrementMinor <= BigInt.zero) {
      throw const MobileContractException(
        'Effective cash increment must be greater than zero.',
      );
    }
    if (!const <String>{'nearest', 'up', 'down'}.contains(
      cashRoundingMode,
    )) {
      throw MobileContractException(
        'Unsupported effective cash rounding mode: $cashRoundingMode.',
      );
    }
    if (metadataVersion.trim().isEmpty) {
      throw const MobileContractException(
        'Effective currency metadata version is required.',
      );
    }
  }

  /// Parses one currency record from the MOD-F response.
  factory MobileEffectiveCurrencyContract.fromJson(
    Map<String, Object?> json,
  ) {
    final cashIncrementText = _requiredString(json, 'cashIncrementMinor');
    final cashIncrement = BigInt.tryParse(cashIncrementText);
    if (cashIncrement == null) {
      throw MobileContractException(
        'cashIncrementMinor must be a base-10 integer: $cashIncrementText.',
      );
    }
    return MobileEffectiveCurrencyContract(
      currency: _requiredString(json, 'currency'),
      accountingScale: _requiredInt(json, 'accountingScale'),
      cashIncrementMinor: cashIncrement,
      cashRoundingMode: _requiredString(json, 'cashRoundingMode'),
      metadataVersion: _requiredString(json, 'metadataVersion'),
    );
  }

  /// Three-letter currency code.
  final String currency;

  /// Number of accounting fraction digits, from zero through twelve.
  final int accountingScale;

  /// Exact positive cash increment in integer minor units.
  final BigInt cashIncrementMinor;

  /// Effective cash rounding mode.
  final String cashRoundingMode;

  /// Immutable server metadata version used by the current snapshot.
  final String metadataVersion;
}

/// One exact effective business-day boundary record.
final class MobileEffectiveBusinessDayContract {
  /// Creates validated effective business-day metadata.
  MobileEffectiveBusinessDayContract({
    required this.timeZone,
    required this.localStartTime,
    required this.boundaryVersion,
  }) {
    if (timeZone.trim().isEmpty) {
      throw const MobileContractException(
        'Effective business-day timezone is required.',
      );
    }
    if (!_timePattern.hasMatch(localStartTime)) {
      throw MobileContractException(
        'Effective local start time is invalid: $localStartTime.',
      );
    }
    if (boundaryVersion.trim().isEmpty) {
      throw const MobileContractException(
        'Effective business-day boundary version is required.',
      );
    }
  }

  /// Parses one business-day record from the MOD-F response.
  factory MobileEffectiveBusinessDayContract.fromJson(
    Map<String, Object?> json,
  ) => MobileEffectiveBusinessDayContract(
    timeZone: _requiredString(json, 'timeZone'),
    localStartTime: _requiredString(json, 'localStartTime'),
    boundaryVersion: _requiredString(json, 'boundaryVersion'),
  );

  /// IANA timezone identifier.
  final String timeZone;

  /// Local business-day start time returned by PostgreSQL.
  final String localStartTime;

  /// Immutable boundary metadata version.
  final String boundaryVersion;
}

/// Effective country-pack configuration returned by MOD-F.
final class MobileEffectiveLocalisationContract {
  /// Creates a validated, immutable effective configuration.
  MobileEffectiveLocalisationContract({
    required this.activationId,
    required this.packVersionId,
    required this.packId,
    required this.countryCode,
    required this.packVersion,
    required this.supportLevel,
    required this.defaultLocale,
    required this.effectiveFrom,
    required this.effectiveTo,
    required Map<String, Object?> capabilities,
    required List<MobileEffectiveCurrencyContract> currencies,
    required List<MobileEffectiveBusinessDayContract> businessDayBoundaries,
  }) : capabilities = Map<String, Object?>.unmodifiable(capabilities),
       currencies = List<MobileEffectiveCurrencyContract>.unmodifiable(
         currencies,
       ),
       businessDayBoundaries =
           List<MobileEffectiveBusinessDayContract>.unmodifiable(
             businessDayBoundaries,
           ) {
    if (!RegExp(r'^[A-Z]{2}$').hasMatch(countryCode)) {
      throw MobileContractException(
        'Effective country code must use two uppercase letters: $countryCode.',
      );
    }
    if (effectiveTo != null && effectiveTo!.isBefore(effectiveFrom)) {
      throw const MobileContractException(
        'Effective country-pack end date cannot precede its start date.',
      );
    }
    _rejectDuplicateValues(
      currencies.map(
        (MobileEffectiveCurrencyContract value) => value.currency,
      ),
      'currency',
    );
    _rejectDuplicateValues(
      businessDayBoundaries.map(
        (MobileEffectiveBusinessDayContract value) => value.timeZone,
      ),
      'business-day timezone',
    );
  }

  /// Parses a standard `{ "data": { ... } }` API response.
  factory MobileEffectiveLocalisationContract.fromEnvelope(
    Map<String, Object?> envelope,
  ) => MobileEffectiveLocalisationContract.fromJson(
    _requiredMap(envelope, 'data'),
  );

  /// Parses the effective configuration payload returned by MOD-F.
  factory MobileEffectiveLocalisationContract.fromJson(
    Map<String, Object?> json,
  ) => MobileEffectiveLocalisationContract(
    activationId: _requiredString(json, 'activationId'),
    packVersionId: _requiredString(json, 'packVersionId'),
    packId: _requiredString(json, 'packId'),
    countryCode: _requiredString(json, 'countryCode'),
    packVersion: _requiredString(json, 'packVersion'),
    supportLevel: _requiredString(json, 'supportLevel'),
    defaultLocale: _requiredString(json, 'defaultLocale'),
    effectiveFrom: _requiredIsoDate(json, 'effectiveFrom'),
    effectiveTo: _optionalIsoDate(json, 'effectiveTo'),
    capabilities: _requiredMap(json, 'capabilities'),
    currencies: _requiredMapList(json, 'currencies')
        .map(MobileEffectiveCurrencyContract.fromJson)
        .toList(growable: false),
    businessDayBoundaries:
        _requiredMapList(json, 'businessDayBoundaries')
            .map(MobileEffectiveBusinessDayContract.fromJson)
            .toList(growable: false),
  );

  /// Country-pack activation reference.
  final String activationId;

  /// Immutable country-pack version reference.
  final String packVersionId;

  /// Stable country-pack identifier.
  final String packId;

  /// Two-letter country code.
  final String countryCode;

  /// Human-readable pack version.
  final String packVersion;

  /// Server support classification, preserved for forward compatibility.
  final String supportLevel;

  /// Default BCP 47 locale for this pack.
  final String defaultLocale;

  /// Inclusive effective start date.
  final DateTime effectiveFrom;

  /// Inclusive effective end date, when bounded.
  final DateTime? effectiveTo;

  /// Signed country capability metadata.
  final Map<String, Object?> capabilities;

  /// Effective currencies for the requested business date.
  final List<MobileEffectiveCurrencyContract> currencies;

  /// Effective business-day boundaries for the requested business date.
  final List<MobileEffectiveBusinessDayContract> businessDayBoundaries;

  /// Whether this pack is explicitly validated for regulated presentation.
  bool get allowsRegulatedPresentation => supportLevel == 'validated';

  /// Resolves one exact effective currency or fails closed.
  MobileEffectiveCurrencyContract currencyFor(String currency) {
    for (final value in currencies) {
      if (value.currency == currency) {
        return value;
      }
    }
    throw MobileContractException(
      'No effective currency metadata exists for $currency.',
    );
  }

  /// Resolves one exact effective business-day boundary or fails closed.
  MobileEffectiveBusinessDayContract businessDayBoundaryFor(String timeZone) {
    for (final value in businessDayBoundaries) {
      if (value.timeZone == timeZone) {
        return value;
      }
    }
    throw MobileContractException(
      'No effective business-day boundary exists for $timeZone.',
    );
  }
}

final RegExp _datePattern = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');
final RegExp _timePattern = RegExp(
  r'^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?$',
);

DateTime _requiredIsoDate(Map<String, Object?> json, String key) =>
    _parseIsoDate(_requiredString(json, key), key);

DateTime? _optionalIsoDate(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value == null) {
    return null;
  }
  if (value is! String || value.trim().isEmpty) {
    throw MobileContractException('$key must be a non-empty ISO date.');
  }
  return _parseIsoDate(value, key);
}

DateTime _parseIsoDate(String value, String key) {
  final match = _datePattern.firstMatch(value);
  if (match == null) {
    throw MobileContractException('$key must use YYYY-MM-DD.');
  }
  final year = int.parse(match.group(1)!);
  final month = int.parse(match.group(2)!);
  final day = int.parse(match.group(3)!);
  final parsed = DateTime.utc(year, month, day);
  if (parsed.year != year || parsed.month != month || parsed.day != day) {
    throw MobileContractException('$key is not a valid calendar date.');
  }
  return parsed;
}

String _requiredString(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! String || value.trim().isEmpty) {
    throw MobileContractException('$key must be a non-empty string.');
  }
  return value;
}

int _requiredInt(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! int) {
    throw MobileContractException('$key must be an integer.');
  }
  return value;
}

Map<String, Object?> _requiredMap(
  Map<String, Object?> json,
  String key,
) {
  final value = json[key];
  if (value is! Map<Object?, Object?>) {
    throw MobileContractException('$key must be an object.');
  }
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    final entryKey = entry.key;
    if (entryKey is! String) {
      throw MobileContractException('$key must contain string keys.');
    }
    result[entryKey] = entry.value;
  }
  return result;
}

List<Map<String, Object?>> _requiredMapList(
  Map<String, Object?> json,
  String key,
) {
  final value = json[key];
  if (value is! List<Object?>) {
    throw MobileContractException('$key must be an array.');
  }
  return value
      .map((Object? item) {
        if (item is! Map<Object?, Object?>) {
          throw MobileContractException('$key must contain objects.');
        }
        final result = <String, Object?>{};
        for (final entry in item.entries) {
          final entryKey = entry.key;
          if (entryKey is! String) {
            throw MobileContractException(
              '$key objects must contain string keys.',
            );
          }
          result[entryKey] = entry.value;
        }
        return result;
      })
      .toList(growable: false);
}

void _rejectDuplicateValues(
  Iterable<String> values,
  String description,
) {
  final observed = <String>{};
  for (final value in values) {
    if (!observed.add(value)) {
      throw MobileContractException(
        'Effective configuration contains duplicate $description: $value.',
      );
    }
  }
}
