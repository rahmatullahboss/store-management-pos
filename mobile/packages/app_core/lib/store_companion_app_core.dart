/// Platform-neutral application models and client-side invariants for Store
/// Companion.
library;

/// Operational persona used only to shape client presentation.
///
/// Server-issued capabilities and current scope remain authoritative.
enum WorkspacePersona {
  /// Business owner or director review workspace.
  owner,

  /// Store manager operational workspace.
  storeManager,

  /// Inventory or warehouse execution workspace.
  inventoryOperator,

  /// Purchasing and receiving workspace.
  purchaser,

  /// Customer and sales workspace.
  salesRepresentative,

  /// Finance review workspace.
  financeReviewer,
}

/// Current synchronisation condition presented by the app shell.
enum SyncHealth {
  /// Data is current within the active freshness policy.
  current,

  /// A refresh is running while existing data may remain visible.
  refreshing,

  /// Cached data is available but older than its freshness policy.
  stale,

  /// The client cannot currently reach the authoritative service.
  offline,

  /// Synchronisation is blocked by revocation, incompatibility, or recovery.
  blocked,
}

/// Exact monetary value represented in integer minor units.
///
/// This type deliberately exposes no binary floating-point constructor.
final class ExactMoney {
  /// Creates an exact monetary value.
  ExactMoney({required String currency, required this.minorUnits})
    : currency = _validateCurrency(currency);

  /// Parses a base-10 integer minor-unit string.
  factory ExactMoney.parse({
    required String currency,
    required String minorUnits,
  }) => ExactMoney(currency: currency, minorUnits: BigInt.parse(minorUnits));

  /// ISO-style three-letter currency code.
  final String currency;

  /// Signed integer minor-unit amount.
  final BigInt minorUnits;

  /// Returns a transport-safe base-10 representation.
  String get minorUnitsText => minorUnits.toString();

  /// Adds values that use the same currency.
  ExactMoney operator +(ExactMoney other) {
    if (currency != other.currency) {
      throw ArgumentError(
        'Cannot add $currency and ${other.currency} monetary values.',
      );
    }
    return ExactMoney(currency: currency, minorUnits: minorUnits + other.minorUnits);
  }

  /// Subtracts values that use the same currency.
  ExactMoney operator -(ExactMoney other) {
    if (currency != other.currency) {
      throw ArgumentError(
        'Cannot subtract ${other.currency} from $currency monetary values.',
      );
    }
    return ExactMoney(currency: currency, minorUnits: minorUnits - other.minorUnits);
  }

  @override
  bool operator ==(Object other) =>
      other is ExactMoney &&
      other.currency == currency &&
      other.minorUnits == minorUnits;

  @override
  int get hashCode => Object.hash(currency, minorUnits);

  @override
  String toString() => 'ExactMoney($currency $minorUnits)';

  static String _validateCurrency(String currency) {
    final normalized = currency.toUpperCase();
    if (!RegExp(r'^[A-Z]{3}$').hasMatch(normalized)) {
      throw ArgumentError.value(currency, 'currency', 'Expected three letters.');
    }
    return normalized;
  }
}

/// Server-approved tenant/location/persona context available to the client.
final class WorkspaceContext {
  /// Creates an immutable workspace context.
  WorkspaceContext({
    required this.id,
    required this.label,
    required this.tenantLabel,
    required this.scopeLabel,
    required this.persona,
    required Set<String> capabilities,
  }) : capabilities = Set<String>.unmodifiable(capabilities);

  /// Opaque server-issued workspace reference used by the synthetic fixture.
  final String id;

  /// Human-readable workspace label.
  final String label;

  /// Human-readable tenant label.
  final String tenantLabel;

  /// Store, warehouse, or group scope label.
  final String scopeLabel;

  /// Presentation persona for the workspace.
  final WorkspacePersona persona;

  /// Effective capability identifiers returned by the server.
  final Set<String> capabilities;

  /// Whether the server bootstrap granted a capability in this snapshot.
  ///
  /// The server still authorises every command and query independently.
  bool can(String capability) => capabilities.contains(capability);
}

/// Minimal bootstrap state required to render the initial app shell.
final class CompanionBootstrap {
  /// Creates a bootstrap snapshot.
  CompanionBootstrap({
    required List<WorkspaceContext> workspaces,
    required this.activeWorkspaceId,
    required this.syncHealth,
    required this.lastSuccessfulSync,
    required this.isSynthetic,
  }) : workspaces = List<WorkspaceContext>.unmodifiable(workspaces) {
    if (workspaces.isEmpty) {
      throw ArgumentError.value(workspaces, 'workspaces', 'Must not be empty.');
    }
    if (!workspaces.any(
      (WorkspaceContext workspace) => workspace.id == activeWorkspaceId,
    )) {
      throw ArgumentError.value(
        activeWorkspaceId,
        'activeWorkspaceId',
        'Must reference an available workspace.',
      );
    }
  }

  /// Available server-approved workspaces.
  final List<WorkspaceContext> workspaces;

  /// Active opaque workspace reference.
  final String activeWorkspaceId;

  /// Current synchronisation condition.
  final SyncHealth syncHealth;

  /// Last successful authoritative synchronisation time.
  final DateTime? lastSuccessfulSync;

  /// Whether this bootstrap contains only synthetic development data.
  final bool isSynthetic;

  /// Resolves the active workspace.
  WorkspaceContext get activeWorkspace => workspaces.firstWhere(
    (WorkspaceContext workspace) => workspace.id == activeWorkspaceId,
  );

  /// Creates the deterministic non-production fixture used by M1.
  factory CompanionBootstrap.synthetic() {
    final workspaces = <WorkspaceContext>[
      WorkspaceContext(
        id: 'synthetic-store-manager',
        label: 'Dhanmondi Store',
        tenantLabel: 'Ozzyl Retail — Synthetic',
        scopeLabel: 'Dhanmondi Store',
        persona: WorkspacePersona.storeManager,
        capabilities: const <String>{
          'catalog.barcode.lookup',
          'inventory.balance.read',
          'inventory.count.read',
          'procurement.purchase_order.read',
          'approval.inbox.read',
          'finance.close_readiness.read',
        },
      ),
      WorkspaceContext(
        id: 'synthetic-warehouse',
        label: 'Central Warehouse',
        tenantLabel: 'Ozzyl Retail — Synthetic',
        scopeLabel: 'Central Warehouse',
        persona: WorkspacePersona.inventoryOperator,
        capabilities: const <String>{
          'catalog.barcode.lookup',
          'inventory.balance.read',
          'inventory.count.create',
          'inventory.transfer.receive',
          'procurement.receipt.create',
        },
      ),
    ];

    return CompanionBootstrap(
      workspaces: workspaces,
      activeWorkspaceId: workspaces.first.id,
      syncHealth: SyncHealth.current,
      lastSuccessfulSync: DateTime.utc(2026, 7, 29, 12),
      isSynthetic: true,
    );
  }
}
