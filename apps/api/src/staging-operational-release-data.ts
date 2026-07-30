import {
  loadStagingOperationalData,
  type StagingOperationalData,
} from "./staging-operational-data.js";
import type { StagingReadContext } from "./staging-read-context.js";

const BENGALI_DIGITS: Readonly<Record<string, string>> = {
  "০": "0",
  "১": "1",
  "২": "2",
  "৩": "3",
  "৪": "4",
  "৫": "5",
  "৬": "6",
  "৭": "7",
  "৮": "8",
  "৯": "9",
};

function asciiDigits(value: string): string {
  return [...value]
    .map((character) => BENGALI_DIGITS[character] ?? character)
    .join("");
}

function exactMinorFromDisplay(value: string): bigint {
  const digits = asciiDigits(value).replace(/[^0-9]/gu, "");
  if (!digits) {
    throw new Error("Operational POS price does not contain exact minor units");
  }
  return BigInt(digits);
}

export async function loadReleaseCandidateOperationalData(
  connectionString: string,
  context: StagingReadContext,
): Promise<StagingOperationalData> {
  const data = await loadStagingOperationalData(connectionString, context);
  const catalog = data.catalog.map((item) => ({
    ...item,
    price: asciiDigits(item.price),
    available: asciiDigits(item.available),
    inventoryValue: asciiDigits(item.inventoryValue),
  }));
  const lines = data.pos.lines.map((line, index) => {
    const source = data.catalog[index];
    if (!source) return line;
    return {
      ...line,
      variant: asciiDigits(line.variant),
      lineTotalMinor: exactMinorFromDisplay(source.price),
    };
  });
  const subtotalMinor = lines.reduce(
    (total, line) => total + line.lineTotalMinor,
    0n,
  );
  return {
    ...data,
    catalog,
    dashboard: {
      ...data.dashboard,
      availableUnits: asciiDigits(data.dashboard.availableUnits),
      reservedUnits: asciiDigits(data.dashboard.reservedUnits),
      inventoryValue: asciiDigits(data.dashboard.inventoryValue),
      openPurchaseValue: asciiDigits(data.dashboard.openPurchaseValue),
      salesOrderValue: asciiDigits(data.dashboard.salesOrderValue),
      recentOrders: data.dashboard.recentOrders.map((order) => ({
        ...order,
        total: asciiDigits(order.total),
      })),
    },
    inventory: {
      ...data.inventory,
      availableUnits: asciiDigits(data.inventory.availableUnits),
      reservedUnits: asciiDigits(data.inventory.reservedUnits),
      balances: data.inventory.balances.map((balance) => ({
        ...balance,
        sellable: asciiDigits(balance.sellable),
        reserved: asciiDigits(balance.reserved),
        inTransit: asciiDigits(balance.inTransit),
        value: asciiDigits(balance.value),
      })),
      tasks: data.inventory.tasks.map((task) => ({
        ...task,
        quantity: asciiDigits(task.quantity),
      })),
    },
    procurement: {
      ...data.procurement,
      approvedOpenValue: asciiDigits(data.procurement.approvedOpenValue),
      purchaseOrders: data.procurement.purchaseOrders.map((order) => ({
        ...order,
        ordered: asciiDigits(order.ordered),
        received: asciiDigits(order.received),
        value: asciiDigits(order.value),
      })),
    },
    sales: {
      ...data.sales,
      orders: data.sales.orders.map((order) => ({
        ...order,
        total: asciiDigits(order.total),
      })),
    },
    pos: {
      ...data.pos,
      lines,
      subtotalMinor,
      payableMinor: subtotalMinor - data.pos.discountMinor + data.pos.taxMinor,
    },
  };
}
