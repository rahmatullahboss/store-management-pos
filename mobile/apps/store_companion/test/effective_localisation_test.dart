import 'package:flutter_test/flutter_test.dart';
import 'package:store_companion/effective_localisation_context.dart';
import 'package:store_companion_api_client/mobile_effective_localisation_contract.dart';
import 'package:store_companion_api_client/store_companion_api_client.dart';

void main() {
  test('resolves exact MOD-F currency and business-day metadata', () {
    final effective = MobileEffectiveLocalisationContract.fromEnvelope(
      _effectiveEnvelope(),
    );
    final context = EffectiveLocalisationContext.resolve(
      bootstrap: _bootstrapLocalisation(),
      effective: effective,
    );

    expect(context.effective.packId, 'country.bd');
    expect(context.currency.currency, 'BDT');
    expect(context.currency.accountingScale, 2);
    expect(context.currency.cashIncrementMinor, BigInt.from(100));
    expect(context.businessDayBoundary.localStartTime, '06:00:00');
    expect(context.businessDate, DateTime.utc(2026, 7, 29));
    expect(context.allowsRegulatedPresentation, isFalse);
    expect(context.isRightToLeft, isFalse);
  });

  test('keeps unknown support levels forward compatible and fail-closed', () {
    final envelope = _effectiveEnvelope();
    final data = envelope['data']! as Map<String, Object?>;
    data['supportLevel'] = 'future_review';

    final effective = MobileEffectiveLocalisationContract.fromEnvelope(
      envelope,
    );

    expect(effective.supportLevel, 'future_review');
    expect(effective.allowsRegulatedPresentation, isFalse);
  });

  test('rejects duplicate currency metadata', () {
    final envelope = _effectiveEnvelope();
    final data = envelope['data']! as Map<String, Object?>;
    final currencies = data['currencies']! as List<Object?>;
    currencies.add(<String, Object?>{
      'currency': 'BDT',
      'accountingScale': 2,
      'cashIncrementMinor': '1',
      'cashRoundingMode': 'nearest',
      'metadataVersion': 'duplicate',
    });

    expect(
      () => MobileEffectiveLocalisationContract.fromEnvelope(envelope),
      throwsA(isA<MobileContractException>()),
    );
  });

  test('rejects inconsistent bootstrap currency metadata version', () {
    final bootstrap = MobileLocalisationContract.fromJson(<String, Object?>{
      'ui_locale': 'bn-BD',
      'fallback_locales': <Object?>['bn', 'en'],
      'timezone': 'Asia/Dhaka',
      'business_date': '2026-07-29',
      'currency': 'BDT',
      'currency_metadata_version': 'stale-version',
      'country_pack': 'country.bd@1.0.0',
      'rtl': false,
    });

    expect(
      () => EffectiveLocalisationContext.resolve(
        bootstrap: bootstrap,
        effective: MobileEffectiveLocalisationContract.fromEnvelope(
          _effectiveEnvelope(),
        ),
      ),
      throwsA(isA<MobileContractException>()),
    );
  });

  test('rejects business date outside the active pack window', () {
    final bootstrap = MobileLocalisationContract.fromJson(<String, Object?>{
      'ui_locale': 'bn-BD',
      'fallback_locales': <Object?>['bn', 'en'],
      'timezone': 'Asia/Dhaka',
      'business_date': '2027-01-01',
      'currency': 'BDT',
      'currency_metadata_version': 'bdt-2026-v1',
      'country_pack': 'country.bd@1.0.0',
      'rtl': false,
    });

    expect(
      () => EffectiveLocalisationContext.resolve(
        bootstrap: bootstrap,
        effective: MobileEffectiveLocalisationContract.fromEnvelope(
          _effectiveEnvelope(effectiveTo: '2026-12-31'),
        ),
      ),
      throwsA(isA<MobileContractException>()),
    );
  });

  test('rejects missing effective business-day boundary', () {
    final bootstrap = MobileLocalisationContract.fromJson(<String, Object?>{
      'ui_locale': 'bn-BD',
      'fallback_locales': <Object?>['bn', 'en'],
      'timezone': 'Asia/Chittagong',
      'business_date': '2026-07-29',
      'currency': 'BDT',
      'currency_metadata_version': 'bdt-2026-v1',
      'country_pack': 'country.bd@1.0.0',
      'rtl': false,
    });

    expect(
      () => EffectiveLocalisationContext.resolve(
        bootstrap: bootstrap,
        effective: MobileEffectiveLocalisationContract.fromEnvelope(
          _effectiveEnvelope(),
        ),
      ),
      throwsA(isA<MobileContractException>()),
    );
  });

  test('retains cash increments beyond JavaScript safe integer range', () {
    final envelope = _effectiveEnvelope();
    final data = envelope['data']! as Map<String, Object?>;
    final currencies = data['currencies']! as List<Object?>;
    final currency = currencies.single as Map<String, Object?>;
    currency['cashIncrementMinor'] = '9007199254740993123456789';

    final effective = MobileEffectiveLocalisationContract.fromEnvelope(
      envelope,
    );

    expect(
      effective.currencies.single.cashIncrementMinor.toString(),
      '9007199254740993123456789',
    );
  });
}

MobileLocalisationContract _bootstrapLocalisation() =>
    MobileLocalisationContract.fromJson(<String, Object?>{
      'ui_locale': 'bn-BD',
      'fallback_locales': <Object?>['bn', 'en'],
      'timezone': 'Asia/Dhaka',
      'business_date': '2026-07-29',
      'currency': 'BDT',
      'currency_metadata_version': 'bdt-2026-v1',
      'country_pack': 'country.bd@1.0.0',
      'rtl': false,
    });

Map<String, Object?> _effectiveEnvelope({String? effectiveTo}) =>
    <String, Object?>{
      'data': <String, Object?>{
        'activationId': '028f0000-0000-7000-8000-000000000010',
        'packVersionId': '028f0000-0000-7000-8000-000000000011',
        'packId': 'country.bd',
        'countryCode': 'BD',
        'packVersion': '1.0.0',
        'supportLevel': 'limited',
        'defaultLocale': 'bn-BD',
        'effectiveFrom': '2026-01-01',
        'effectiveTo': effectiveTo,
        'capabilities': <String, Object?>{'legalReceipts': true},
        'currencies': <Object?>[
          <String, Object?>{
            'currency': 'BDT',
            'accountingScale': 2,
            'cashIncrementMinor': '100',
            'cashRoundingMode': 'nearest',
            'metadataVersion': 'bdt-2026-v1',
          },
        ],
        'businessDayBoundaries': <Object?>[
          <String, Object?>{
            'timeZone': 'Asia/Dhaka',
            'localStartTime': '06:00:00',
            'boundaryVersion': 'bd-boundary-v1',
          },
        ],
      },
    };
