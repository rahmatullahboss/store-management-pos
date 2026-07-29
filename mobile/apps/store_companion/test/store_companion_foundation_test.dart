import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_companion/src/store_companion_app.dart';
import 'package:store_companion_app_core/store_companion_app_core.dart';
import 'package:store_companion_design_system/store_companion_design_system.dart';

void main() {
  test('exact money preserves integer minor units', () {
    final first = ExactMoney.parse(currency: 'bdt', minorUnits: '1250');
    final second = ExactMoney.parse(currency: 'BDT', minorUnits: '-250');

    expect((first + second).minorUnitsText, '1000');
    expect(first.currency, 'BDT');
    expect(
      () => first + ExactMoney.parse(currency: 'GBP', minorUnits: '1'),
      throwsArgumentError,
    );
  });

  test('synthetic workspace capabilities remain explicit', () {
    final bootstrap = CompanionBootstrap.synthetic();

    expect(bootstrap.isSynthetic, isTrue);
    expect(bootstrap.activeWorkspace.can('catalog.barcode.lookup'), isTrue);
    expect(bootstrap.activeWorkspace.can('inventory.count.post'), isFalse);
  });

  testWidgets('foundation shell exposes context and synthetic warning', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      StoreCompanionApp(bootstrap: CompanionBootstrap.synthetic()),
    );

    expect(find.text('Store Companion'), findsOneWidget);
    expect(find.textContaining('Synthetic foundation fixture'), findsOneWidget);
    expect(find.text('Current'), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.text('Approvals'), findsWidgets);
  });

  testWidgets('Operations Ledger tokens are applied', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: OperationsLedgerTheme.light(),
        home: const Scaffold(body: Text('Theme proof')),
      ),
    );

    final context = tester.element(find.text('Theme proof'));
    final theme = Theme.of(context);

    expect(theme.scaffoldBackgroundColor, OperationsLedgerColors.paper);
    expect(theme.colorScheme.primary, OperationsLedgerColors.accent);
    expect(theme.colorScheme.error, OperationsLedgerColors.danger);
  });
}
