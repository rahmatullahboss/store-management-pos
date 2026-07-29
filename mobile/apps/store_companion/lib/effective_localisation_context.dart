/// Fail-closed presentation resolver for mobile bootstrap and MOD-F metadata.
library;

import 'package:store_companion_api_client/mobile_effective_localisation_contract.dart';
import 'package:store_companion_api_client/store_companion_api_client.dart';

/// One internally consistent localisation snapshot used by presentation code.
///
/// This snapshot never replaces server authorization or country-pack rules. It
/// only prevents the client from presenting inconsistent locale, currency, or
/// business-day metadata.
final class EffectiveLocalisationContext {
  /// Resolves bootstrap metadata against one effective MOD-F configuration.
  factory EffectiveLocalisationContext.resolve({
    required MobileLocalisationContract bootstrap,
    required MobileEffectiveLocalisationContract effective,
  }) {
    final businessDate = _parseIsoDate(bootstrap.businessDate);
    if (businessDate.isBefore(effective.effectiveFrom) ||
        (effective.effectiveTo != null &&
            businessDate.isAfter(effective.effectiveTo!))) {
      throw const MobileContractException(
        'Bootstrap business date is outside the effective country-pack window.',
      );
    }

    final currency = effective.currencyFor(bootstrap.currency);
    if (currency.metadataVersion != bootstrap.currencyMetadataVersion) {
      throw MobileContractException(
        'Bootstrap currency metadata version '
        '${bootstrap.currencyMetadataVersion} does not match effective version '
        '${currency.metadataVersion}.',
      );
    }

    final boundary = effective.businessDayBoundaryFor(bootstrap.timezone);
    return EffectiveLocalisationContext._(
      bootstrap: bootstrap,
      effective: effective,
      businessDate: businessDate,
      currency: currency,
      businessDayBoundary: boundary,
    );
  }

  const EffectiveLocalisationContext._({
    required this.bootstrap,
    required this.effective,
    required this.businessDate,
    required this.currency,
    required this.businessDayBoundary,
  });

  /// Workspace bootstrap localisation selected by the server.
  final MobileLocalisationContract bootstrap;

  /// Effective country-pack metadata returned by MOD-F.
  final MobileEffectiveLocalisationContract effective;

  /// Parsed UTC calendar date used for effective-window checks only.
  final DateTime businessDate;

  /// Exact currency metadata matching the bootstrap currency and version.
  final MobileEffectiveCurrencyContract currency;

  /// Exact business-day boundary matching the bootstrap timezone.
  final MobileEffectiveBusinessDayContract businessDayBoundary;

  /// Client-side regulated presentation gate.
  ///
  /// The server remains authoritative for every legal or fiscal operation.
  bool get allowsRegulatedPresentation =>
      effective.allowsRegulatedPresentation;

  /// Whether the active interface direction is right-to-left.
  bool get isRightToLeft => bootstrap.rtl;
}

final RegExp _datePattern = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');

DateTime _parseIsoDate(String value) {
  final match = _datePattern.firstMatch(value);
  if (match == null) {
    throw const MobileContractException(
      'Bootstrap business date must use YYYY-MM-DD.',
    );
  }
  final year = int.parse(match.group(1)!);
  final month = int.parse(match.group(2)!);
  final day = int.parse(match.group(3)!);
  final parsed = DateTime.utc(year, month, day);
  if (parsed.year != year || parsed.month != month || parsed.day != day) {
    throw const MobileContractException(
      'Bootstrap business date is not a valid calendar date.',
    );
  }
  return parsed;
}
