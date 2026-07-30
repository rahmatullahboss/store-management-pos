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

function exactMinorFromDisplay(value: string): bigint {
  const ascii = [...value]
    .map((character) => BENGALI_DIGITS[character] ?? character)
    .join("");
  const digits = ascii.replace(/[^0-9]/gu, "");
  if (!digits) throw new Error("Operational POS price does not contain exact minor units");
  return BigInt(digits);
}

export async function loadReleaseCandidateOperationalData(
  connectionString: string,
  context: StagingReadContext,
): Promise<StagingOperationalData> {
  const data = await loadStagingOperationalData(connectionString, context);
  const lines = data.pos.lines.map((line, index) => {
    const catalog = data.catalog[index];
    if (!catalog) return line;
    return {
      ...line,
      lineTotalMinor: exactMinorFromDisplay(catalog.price),
    };
  });
  const subtotalMinor = lines.reduce(
    (total, line) => total + line.lineTotalMinor,
    0n,
  );
  return {
    ...data,
    pos: {
      ...data.pos,
      lines,
      subtotalMinor,
      payableMinor: subtotalMinor - data.pos.discountMinor + data.pos.taxMinor,
    },
  };
}
