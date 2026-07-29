import type { MoneyV1, ScopeContextV1 } from "../../../packages/contracts/src/v1/common.js";

export type TextDirection = "ltr" | "rtl";
export type CashRoundingMode = "nearest" | "up" | "down";

export interface LocaleProfileV1 {
  readonly schemaVersion: "1.0";
  readonly locale: string;
  readonly fallbackLocales: readonly string[];
  readonly direction: TextDirection;
  readonly numberingSystem?: string;
  readonly calendar?: string;
}

export interface CurrencyMetadataV1 {
  readonly schemaVersion: "1.0";
  readonly currency: string;
  readonly accountingScale: number;
  readonly cashIncrementMinor: string;
  readonly cashRoundingMode: CashRoundingMode;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly metadataVersion: string;
}

export interface BusinessDayBoundaryV1 {
  readonly schemaVersion: "1.0";
  readonly timeZone: string;
  readonly localStartTime: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly boundaryVersion: string;
}

export interface LocalizedMoneySnapshotV1 {
  readonly amount: MoneyV1;
  readonly locale: string;
  readonly currencyMetadataVersion: string;
  readonly formatted: string;
  readonly observedAt: string;
}

export interface TranslationCatalogV1 {
  readonly schemaVersion: "1.0";
  readonly catalogId: string;
  readonly locale: string;
  readonly namespace: string;
  readonly version: string;
  readonly messages: Readonly<Record<string, string>>;
  readonly contentHash: string;
  readonly publishedAt: string;
}

export interface LocalizationContextV1 {
  readonly context: ScopeContextV1;
  readonly localeProfile: LocaleProfileV1;
  readonly currencyMetadata: CurrencyMetadataV1;
  readonly businessDayBoundary: BusinessDayBoundaryV1;
}
