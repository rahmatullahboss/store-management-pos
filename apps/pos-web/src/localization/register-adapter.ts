import type { CountryPackCapabilityV1, CountrySupportLevel } from "../../../../modules/country-packs/src/contracts.js";
import type { RegisterWorkspaceModel } from "../modules/register/surface.js";

export interface PosLocalizationSnapshot {
  readonly packId: string;
  readonly packVersion: string;
  readonly countryCode: string;
  readonly locale: string;
  readonly direction: "ltr" | "rtl";
  readonly currency: string;
  readonly accountingScale: number;
  readonly supportLevel: CountrySupportLevel;
  readonly capabilities: CountryPackCapabilityV1;
  readonly limitations: readonly string[];
}

export type PosLocalizationBlockCode =
  | "LEGAL_RECEIPTS_UNSUPPORTED"
  | "OFFLINE_LEGAL_UNSUPPORTED"
  | "OFFLINE_CASH_ONLY";

export interface LocalizedRegisterWorkspace {
  readonly model: RegisterWorkspaceModel;
  readonly direction: "ltr" | "rtl";
  readonly packId: string;
  readonly packVersion: string;
  readonly supportLevel: CountrySupportLevel;
  readonly notice: string;
  readonly blockCode?: PosLocalizationBlockCode;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function legalCapabilityLabel(value: CountryPackCapabilityV1["offlineLegalCapability"]): string {
  return value.replaceAll("_", " ");
}

function localizedBlock(
  model: RegisterWorkspaceModel,
  snapshot: PosLocalizationSnapshot,
): { readonly code: PosLocalizationBlockCode; readonly reason: string } | undefined {
  if (!snapshot.capabilities.legalReceipts) {
    return {
      code: "LEGAL_RECEIPTS_UNSUPPORTED",
      reason: `Legal receipts are not supported by ${snapshot.packId} ${snapshot.packVersion}. Checkout must remain blocked.`,
    };
  }
  if (model.online) return undefined;

  if (snapshot.capabilities.offlineLegalCapability === "unsupported") {
    return {
      code: "OFFLINE_LEGAL_UNSUPPORTED",
      reason: `Offline legal checkout is unsupported for ${snapshot.countryCode}. Restore connectivity before completing this sale.`,
    };
  }
  if (snapshot.capabilities.offlineLegalCapability === "cash_only") {
    const hasNonCashTender = model.tenders.some((tender) => tender.kind !== "cash");
    if (hasNonCashTender) {
      return {
        code: "OFFLINE_CASH_ONLY",
        reason: `This country pack permits offline legal checkout for cash only. Remove non-cash tenders or restore connectivity.`,
      };
    }
  }
  return undefined;
}

export function applyPosLocalization(
  model: RegisterWorkspaceModel,
  snapshot: PosLocalizationSnapshot,
): LocalizedRegisterWorkspace {
  if (!/^[A-Z]{3}$/u.test(snapshot.currency)) throw new Error("POS localization currency must be an ISO 4217 code");
  if (!Number.isInteger(snapshot.accountingScale) || snapshot.accountingScale < 0 || snapshot.accountingScale > 12) {
    throw new Error("POS localization accounting scale must be an integer from 0 to 12");
  }

  const block = localizedBlock(model, snapshot);
  const canCheckout = model.canCheckout && block === undefined;
  const checkoutBlockReason = model.canCheckout
    ? block?.reason
    : model.checkoutBlockReason;
  const limitationCopy = snapshot.limitations.length === 0
    ? "No documented operator limitation."
    : `${snapshot.limitations.length} documented limitation${snapshot.limitations.length === 1 ? "" : "s"} apply.`;
  const notice = `${snapshot.countryCode} ${snapshot.packVersion} · ${snapshot.supportLevel} support · Offline legal ${legalCapabilityLabel(snapshot.capabilities.offlineLegalCapability)}. ${limitationCopy}`;

  return Object.freeze({
    model: Object.freeze({
      ...model,
      locale: snapshot.locale,
      currency: snapshot.currency,
      scale: snapshot.accountingScale,
      canCheckout,
      ...(checkoutBlockReason ? { checkoutBlockReason } : {}),
    }),
    direction: snapshot.direction,
    packId: snapshot.packId,
    packVersion: snapshot.packVersion,
    supportLevel: snapshot.supportLevel,
    notice,
    ...(block ? { blockCode: block.code } : {}),
  });
}

export function renderPosLocalizationStatus(localized: LocalizedRegisterWorkspace): string {
  const blocked = localized.blockCode !== undefined;
  const role = blocked ? "alert" : "status";
  const title = blocked ? "Country capability blocks checkout" : "Country capability applied";
  const block = localized.blockCode
    ? `<code>${escapeHtml(localized.blockCode)}</code>`
    : `<span>${escapeHtml(localized.supportLevel)} support</span>`;
  return `<section class="modf-pos-localization${blocked ? " modf-pos-localization--blocked" : ""}" role="${role}" aria-live="polite" dir="${localized.direction}" data-pack-id="${escapeHtml(localized.packId)}" data-pack-version="${escapeHtml(localized.packVersion)}">
    <div><strong>${title}</strong><span>${escapeHtml(localized.notice)}</span></div>${block}
  </section>`;
}

export const MOD_F_POS_LOCALIZATION_STYLES = `
.modf-pos-localization{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;border:1px solid #7f9d90;background:#eff8f3;color:#17231e;padding:11px 13px;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.modf-pos-localization>div{display:grid;gap:3px}.modf-pos-localization span{color:#59675f}.modf-pos-localization>span,.modf-pos-localization code{white-space:nowrap;border:1px solid currentColor;padding:3px 7px;font-size:.72rem;font-weight:900;text-transform:uppercase}.modf-pos-localization--blocked{border-color:#9b2c2c;background:#fff2f0;color:#9b2c2c}.modf-pos-localization--blocked span{color:#6a3a38}.modf-pos-localization code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;background:transparent}@media(max-width:620px){.modf-pos-localization{display:grid}.modf-pos-localization>span,.modf-pos-localization code{justify-self:start}}
`;
