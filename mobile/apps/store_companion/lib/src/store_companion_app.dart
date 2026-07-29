import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:store_companion_app_core/store_companion_app_core.dart';
import 'package:store_companion_design_system/store_companion_design_system.dart';

/// Root Store Companion application.
final class StoreCompanionApp extends StatelessWidget {
  /// Creates the application with an explicit bootstrap snapshot.
  const StoreCompanionApp({required this.bootstrap, super.key});

  /// Initial client context. M1 uses a clearly labelled synthetic fixture.
  final CompanionBootstrap bootstrap;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Store Companion',
    debugShowCheckedModeBanner: false,
    theme: OperationsLedgerTheme.light(),
    localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    supportedLocales: const <Locale>[
      Locale('en'),
      Locale('bn'),
      Locale('ar'),
      Locale('ja'),
    ],
    home: _CompanionShell(bootstrap: bootstrap),
  );
}

final class _CompanionShell extends StatefulWidget {
  const _CompanionShell({required this.bootstrap});

  final CompanionBootstrap bootstrap;

  @override
  State<_CompanionShell> createState() => _CompanionShellState();
}

final class _CompanionShellState extends State<_CompanionShell> {
  late String _activeWorkspaceId = widget.bootstrap.activeWorkspaceId;
  int _selectedDestination = 0;

  WorkspaceContext get _activeWorkspace => widget.bootstrap.workspaces.firstWhere(
    (WorkspaceContext workspace) => workspace.id == _activeWorkspaceId,
  );

  List<_Destination> get _destinations {
    final workspace = _activeWorkspace;
    final destinations = <_Destination>[
      const _Destination(
        label: 'Home',
        icon: Icons.home_outlined,
        selectedIcon: Icons.home,
        page: _HomePage(),
      ),
    ];

    if (workspace.can('inventory.balance.read') ||
        workspace.can('procurement.purchase_order.read') ||
        workspace.can('procurement.receipt.create')) {
      destinations.add(
        const _Destination(
          label: 'Work',
          icon: Icons.inventory_2_outlined,
          selectedIcon: Icons.inventory_2,
          page: _WorkPage(),
        ),
      );
    }

    if (workspace.can('approval.inbox.read')) {
      destinations.add(
        const _Destination(
          label: 'Approvals',
          icon: Icons.fact_check_outlined,
          selectedIcon: Icons.fact_check,
          page: _ApprovalsPage(),
        ),
      );
    }

    if (workspace.can('finance.close_readiness.read')) {
      destinations.add(
        const _Destination(
          label: 'Finance',
          icon: Icons.account_balance_outlined,
          selectedIcon: Icons.account_balance,
          page: _FinancePage(),
        ),
      );
    }

    return destinations;
  }

  void _selectWorkspace(String? workspaceId) {
    if (workspaceId == null || workspaceId == _activeWorkspaceId) {
      return;
    }
    setState(() {
      _activeWorkspaceId = workspaceId;
      _selectedDestination = 0;
    });
  }

  void _selectDestination(int index) {
    setState(() {
      _selectedDestination = index;
    });
  }

  @override
  Widget build(BuildContext context) {
    final destinations = _destinations;
    final safeIndex = _selectedDestination.clamp(0, destinations.length - 1);
    final workspace = _activeWorkspace;

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final useRail = constraints.maxWidth >= 840;
        final content = destinations[safeIndex].page;

        return Scaffold(
          body: SafeArea(
            child: Column(
              children: <Widget>[
                _ContextBand(
                  bootstrap: widget.bootstrap,
                  activeWorkspace: workspace,
                  onWorkspaceChanged: _selectWorkspace,
                ),
                Expanded(
                  child: useRail
                      ? Row(
                          children: <Widget>[
                            NavigationRail(
                              selectedIndex: safeIndex,
                              onDestinationSelected: _selectDestination,
                              labelType: NavigationRailLabelType.all,
                              destinations: destinations
                                  .map(
                                    (_Destination destination) =>
                                        NavigationRailDestination(
                                          icon: Icon(destination.icon),
                                          selectedIcon: Icon(
                                            destination.selectedIcon,
                                          ),
                                          label: Text(destination.label),
                                        ),
                                  )
                                  .toList(growable: false),
                            ),
                            const VerticalDivider(width: 1),
                            Expanded(
                              child: _PageFrame(
                                workspace: workspace,
                                child: content,
                              ),
                            ),
                          ],
                        )
                      : _PageFrame(workspace: workspace, child: content),
                ),
              ],
            ),
          ),
          bottomNavigationBar: useRail
              ? null
              : NavigationBar(
                  selectedIndex: safeIndex,
                  onDestinationSelected: _selectDestination,
                  destinations: destinations
                      .map(
                        (_Destination destination) => NavigationDestination(
                          icon: Icon(destination.icon),
                          selectedIcon: Icon(destination.selectedIcon),
                          label: destination.label,
                        ),
                      )
                      .toList(growable: false),
                ),
        );
      },
    );
  }
}

final class _Destination {
  const _Destination({
    required this.label,
    required this.icon,
    required this.selectedIcon,
    required this.page,
  });

  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final Widget page;
}

final class _ContextBand extends StatelessWidget {
  const _ContextBand({
    required this.bootstrap,
    required this.activeWorkspace,
    required this.onWorkspaceChanged,
  });

  final CompanionBootstrap bootstrap;
  final WorkspaceContext activeWorkspace;
  final ValueChanged<String?> onWorkspaceChanged;

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: OperationsLedgerColors.rail,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: <Widget>[
          const Icon(Icons.storefront, color: Colors.white),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  activeWorkspace.tenantLabel,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: Colors.white70,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: activeWorkspace.id,
                    isDense: true,
                    isExpanded: true,
                    dropdownColor: OperationsLedgerColors.railSoft,
                    iconEnabledColor: Colors.white,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                    ),
                    items: bootstrap.workspaces
                        .map(
                          (WorkspaceContext workspace) => DropdownMenuItem<String>(
                            value: workspace.id,
                            child: Text(
                              '${workspace.label} — ${workspace.scopeLabel}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(growable: false),
                    onChanged: onWorkspaceChanged,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          _SyncChip(
            health: bootstrap.syncHealth,
            lastSuccessfulSync: bootstrap.lastSuccessfulSync,
          ),
        ],
      ),
    ),
  );
}

final class _SyncChip extends StatelessWidget {
  const _SyncChip({required this.health, required this.lastSuccessfulSync});

  final SyncHealth health;
  final DateTime? lastSuccessfulSync;

  @override
  Widget build(BuildContext context) {
    final (label, icon, background, foreground) = switch (health) {
      SyncHealth.current => (
        'Current',
        Icons.cloud_done_outlined,
        OperationsLedgerColors.accentSoft,
        OperationsLedgerColors.accentStrong,
      ),
      SyncHealth.refreshing => (
        'Refreshing',
        Icons.sync,
        OperationsLedgerColors.accentSoft,
        OperationsLedgerColors.accentStrong,
      ),
      SyncHealth.stale => (
        'Stale',
        Icons.history,
        OperationsLedgerColors.attentionSoft,
        OperationsLedgerColors.attention,
      ),
      SyncHealth.offline => (
        'Offline',
        Icons.cloud_off_outlined,
        OperationsLedgerColors.attentionSoft,
        OperationsLedgerColors.attention,
      ),
      SyncHealth.blocked => (
        'Blocked',
        Icons.block_outlined,
        OperationsLedgerColors.dangerSoft,
        OperationsLedgerColors.danger,
      ),
    };

    final semantics = lastSuccessfulSync == null
        ? label
        : '$label. Last successful sync ${lastSuccessfulSync!.toUtc().toIso8601String()}.';

    return Semantics(
      label: semantics,
      child: Container(
        constraints: const BoxConstraints(minHeight: 44),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 18, color: foreground),
            const SizedBox(width: 6),
            Text(
              label,
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                color: foreground,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

final class _PageFrame extends StatelessWidget {
  const _PageFrame({required this.workspace, required this.child});

  final WorkspaceContext workspace;
  final Widget child;

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: OperationsLedgerColors.paper,
    child: FocusTraversalGroup(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              workspace.scopeLabel,
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                color: OperationsLedgerColors.muted,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Expanded(child: child),
          ],
        ),
      ),
    ),
  );
}

final class _HomePage extends StatelessWidget {
  const _HomePage();

  @override
  Widget build(BuildContext context) => ListView(
    children: <Widget>[
      Semantics(
        header: true,
        child: Text(
          'Store Companion',
          style: Theme.of(context).textTheme.headlineMedium?.copyWith(
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      const SizedBox(height: 8),
      Text(
        'Exception-first mobile operations without duplicating the server’s '
        'business rules.',
        style: Theme.of(context).textTheme.bodyLarge?.copyWith(
          color: OperationsLedgerColors.inkSoft,
        ),
      ),
      const SizedBox(height: 16),
      const _SyntheticNotice(),
      const SizedBox(height: 16),
      const _OperationalSignal(),
      const SizedBox(height: 24),
      Text(
        'Needs attention',
        style: Theme.of(context).textTheme.titleLarge?.copyWith(
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 8),
      const _TaskRow(
        icon: Icons.inventory_2_outlined,
        title: 'Receiving and stock work',
        subtitle: 'Assigned work will appear here after contract integration.',
        status: 'Foundation',
      ),
      const _TaskRow(
        icon: Icons.fact_check_outlined,
        title: 'Approval inbox',
        subtitle: 'Decisions remain online, current, and server-authorised.',
        status: 'Contract-gated',
      ),
      const _TaskRow(
        icon: Icons.account_balance_outlined,
        title: 'Finance exceptions',
        subtitle: 'Read-only source trace will consume integrated MOD-E data.',
        status: 'Planned',
      ),
    ],
  );
}

final class _SyntheticNotice extends StatelessWidget {
  const _SyntheticNotice();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: OperationsLedgerColors.attentionSoft,
      border: Border.all(color: OperationsLedgerColors.attention),
      borderRadius: BorderRadius.circular(14),
    ),
    child: const Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Icon(Icons.science_outlined, color: OperationsLedgerColors.attention),
        SizedBox(width: 12),
        Expanded(
          child: Text(
            'Synthetic foundation fixture — no production backend, credentials, '
            'customer data, or mobile contract deployment is implied.',
          ),
        ),
      ],
    ),
  );
}

final class _OperationalSignal extends StatelessWidget {
  const _OperationalSignal();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: OperationsLedgerColors.surface,
      border: Border.all(color: OperationsLedgerColors.line),
      borderRadius: BorderRadius.circular(14),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          'System state',
          style: Theme.of(context).textTheme.labelLarge?.copyWith(
            color: OperationsLedgerColors.muted,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'No pending local operations',
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          'Local success and server acceptance will remain separate states.',
        ),
      ],
    ),
  );
}

final class _TaskRow extends StatelessWidget {
  const _TaskRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.status,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String status;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 8),
    decoration: BoxDecoration(
      color: OperationsLedgerColors.surface,
      border: Border.all(color: OperationsLedgerColors.line),
      borderRadius: BorderRadius.circular(14),
    ),
    child: ListTile(
      minVerticalPadding: 12,
      leading: Icon(icon, color: OperationsLedgerColors.accent),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(subtitle),
      trailing: Text(
        status,
        textAlign: TextAlign.end,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
          color: OperationsLedgerColors.muted,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
  );
}

final class _WorkPage extends StatelessWidget {
  const _WorkPage();

  @override
  Widget build(BuildContext context) => const _PlaceholderPage(
    icon: Icons.inventory_2_outlined,
    title: 'Operational work',
    description:
        'Barcode lookup, receiving, counts, transfers and fulfilment will be '
        'implemented against integrated module contracts.',
  );
}

final class _ApprovalsPage extends StatelessWidget {
  const _ApprovalsPage();

  @override
  Widget build(BuildContext context) => const _PlaceholderPage(
    icon: Icons.fact_check_outlined,
    title: 'Approvals',
    description:
        'The unified inbox will reference owning-module approval state. Push '
        'notifications will never approve an action.',
  );
}

final class _FinancePage extends StatelessWidget {
  const _FinancePage();

  @override
  Widget build(BuildContext context) => const _PlaceholderPage(
    icon: Icons.account_balance_outlined,
    title: 'Finance review',
    description:
        'Payment unknown states, reconciliation exceptions and source/journal '
        'trace will remain read-only in the first mobile release.',
  );
}

final class _PlaceholderPage extends StatelessWidget {
  const _PlaceholderPage({
    required this.icon,
    required this.title,
    required this.description,
  });

  final IconData icon;
  final String title;
  final String description;

  @override
  Widget build(BuildContext context) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 520),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: OperationsLedgerColors.surface,
          border: Border.all(color: OperationsLedgerColors.line),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 40, color: OperationsLedgerColors.accent),
            const SizedBox(height: 16),
            Semantics(
              header: true,
              child: Text(
                title,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(description, textAlign: TextAlign.center),
          ],
        ),
      ),
    ),
  );
}
