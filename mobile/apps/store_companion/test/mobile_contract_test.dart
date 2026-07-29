import 'package:flutter_test/flutter_test.dart';
import 'package:store_companion_api_client/store_companion_api_client.dart';

void main() {
  test('parses bounded mobile bootstrap contract', () {
    final bootstrap = MobileBootstrapContract.fromJson(<String, Object?>{
      'contract_version': 'mobile-bootstrap.v1',
      'server_time': '2026-07-29T12:00:00Z',
      'workspaces': <Object?>[
        <String, Object?>{
          'context_id': 'workspace-1',
          'tenant_id': 'tenant-1',
          'legal_entity_id': 'entity-1',
          'store_id': 'store-1',
          'warehouse_id': null,
          'label': 'Dhanmondi Store',
          'persona': 'store_manager',
          'capabilities_version': 'capabilities-1',
        },
      ],
      'active_workspace': 'workspace-1',
      'capabilities': <Object?>[
        'catalog.barcode.lookup',
        'inventory.balance.read',
      ],
      'localisation': <String, Object?>{
        'ui_locale': 'bn-BD',
        'fallback_locales': <Object?>['bn', 'en'],
        'timezone': 'Asia/Dhaka',
        'business_date': '2026-07-29',
        'currency': 'BDT',
        'currency_metadata_version': 'currency-bdt-1',
        'country_pack': 'country-bd@0.1.0-limited',
        'rtl': false,
      },
      'compatibility': <String, Object?>{
        'minimum_client_version': '0.1.0',
        'recommended_client_version': '0.1.0',
        'api_versions': <Object?>['v1'],
        'sync_versions': <Object?>['mobile-sync.v1'],
        'local_schema_min': 1,
        'local_schema_max': 1,
      },
    });

    expect(bootstrap.activeWorkspace, 'workspace-1');
    expect(bootstrap.localisation.currency, 'BDT');
    expect(bootstrap.can('catalog.barcode.lookup'), isTrue);
    expect(bootstrap.can('finance.journal.post'), isFalse);
  });

  test('preserves unknown additive operation status', () {
    final result = MobileOperationResultContract.fromJson(<String, Object?>{
      'operation_id': '0198-example',
      'status': 'future_review_state',
      'server_reference': null,
      'server_version': null,
      'trace_id': 'trace-1',
      'error': null,
      'adjustments': <Object?>[],
    });

    expect(result.status, 'future_review_state');
    expect(result.accepted, isFalse);
    expect(result.blocksBlindRetry, isFalse);
  });

  test('marks unknown external state as non-retryable without recovery', () {
    final result = MobileOperationResultContract.fromJson(<String, Object?>{
      'operation_id': '0198-example',
      'status': 'unknown_external_state',
      'server_reference': 'payment-intent-1',
      'server_version': '3',
      'trace_id': 'trace-2',
      'error': <String, Object?>{
        'code': 'payment.external_state_unknown',
        'message': 'Payment status requires recovery.',
        'trace_id': 'trace-2',
        'retryable': false,
        'recovery': 'query_status',
        'details': <String, Object?>{},
      },
      'adjustments': <Object?>[],
    });

    expect(result.blocksBlindRetry, isTrue);
    expect(result.error?.retryable, isFalse);
    expect(result.error?.recovery, 'query_status');
  });

  test('rejects bootstrap with unavailable active workspace', () {
    expect(
      () => MobileBootstrapContract.fromJson(<String, Object?>{
        'contract_version': 'mobile-bootstrap.v1',
        'server_time': '2026-07-29T12:00:00Z',
        'workspaces': <Object?>[
          <String, Object?>{
            'context_id': 'workspace-1',
            'tenant_id': 'tenant-1',
            'legal_entity_id': null,
            'store_id': null,
            'warehouse_id': 'warehouse-1',
            'label': 'Warehouse',
            'persona': 'inventory_operator',
            'capabilities_version': 'capabilities-1',
          },
        ],
        'active_workspace': 'workspace-missing',
        'capabilities': <Object?>[],
        'localisation': <String, Object?>{
          'ui_locale': 'en-GB',
          'fallback_locales': <Object?>['en'],
          'timezone': 'Europe/London',
          'business_date': '2026-07-29',
          'currency': 'GBP',
          'currency_metadata_version': 'currency-gbp-1',
          'country_pack': 'generic@1',
          'rtl': false,
        },
        'compatibility': <String, Object?>{
          'minimum_client_version': '0.1.0',
          'recommended_client_version': '0.1.0',
          'api_versions': <Object?>['v1'],
          'sync_versions': <Object?>['mobile-sync.v1'],
          'local_schema_min': 1,
          'local_schema_max': 1,
        },
      }),
      throwsA(isA<MobileContractException>()),
    );
  });
}
