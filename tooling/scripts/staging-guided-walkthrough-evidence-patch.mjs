const ADMIN_FOCUS_ANCHOR = `      if (scenario.kind === "admin") {
        await sessionPage.keyboard.press("Home");
        await sessionPage.keyboard.press("Tab");
        await sessionPage.keyboard.press("Enter");
        metrics.skipFocusedMain = await sessionPage.evaluate(() => document.activeElement?.id === "main");
      }`;

const ADMIN_FOCUS_REPLACEMENT = `      if (scenario.kind === "admin") {
        metrics.walkthrough = await sessionPage.evaluate(() => {
          const guide = document.querySelector("[data-store-walkthrough]");
          if (!guide || guide.hasAttribute("hidden")) {
            return { offered: false, modal: false, dismissed: true, persistedDismissal: true };
          }
          const modal = guide.getAttribute("role") === "dialog"
            && guide.getAttribute("aria-modal") === "true";
          const dismiss = guide.querySelector("[data-guide-dismiss]");
          if (dismiss instanceof HTMLElement) dismiss.click();
          return {
            offered: true,
            modal,
            dismissed: guide.hasAttribute("hidden"),
            persistedDismissal: false,
          };
        });
        if (metrics.walkthrough.offered === true) {
          await sessionPage.reload({ waitUntil: "networkidle0" });
          metrics.walkthrough.persistedDismissal = await sessionPage.evaluate(() => {
            const guide = document.querySelector("[data-store-walkthrough]");
            return !guide || guide.hasAttribute("hidden");
          });
        }
        await sessionPage.keyboard.press("Home");
        await sessionPage.keyboard.press("Tab");
        await sessionPage.keyboard.press("Enter");
        metrics.skipFocusedMain = await sessionPage.evaluate(() => document.activeElement?.id === "main");
      }`;

const EVIDENCE_ANCHOR = `            skipFocusedMain: metrics.skipFocusedMain ?? null,`;
const EVIDENCE_REPLACEMENT = `            skipFocusedMain: metrics.skipFocusedMain ?? null,
            walkthroughOffered: metrics.walkthrough?.offered ?? null,
            walkthroughModal: metrics.walkthrough?.modal ?? null,
            walkthroughDismissed: metrics.walkthrough?.dismissed ?? null,
            walkthroughPersistedDismissal: metrics.walkthrough?.persistedDismissal ?? null,`;

const PASS_ANCHOR = `(scenario.kind !== "admin" || metrics.skipFocusedMain === true),`;
const PASS_REPLACEMENT = `(scenario.kind !== "admin" || metrics.skipFocusedMain === true)
            && (scenario.id !== "admin-dashboard-desktop"
              || (metrics.walkthrough?.offered === true
                && metrics.walkthrough?.modal === true
                && metrics.walkthrough?.dismissed === true
                && metrics.walkthrough?.persistedDismissal === true)),`;

export function addGuidedWalkthroughBrowserEvidence(source) {
  if (source.includes("walkthroughPersistedDismissal: metrics.walkthrough?.persistedDismissal")) return source;
  for (const [label, anchor] of [
    ["Admin focus", ADMIN_FOCUS_ANCHOR],
    ["scenario evidence", EVIDENCE_ANCHOR],
    ["scenario pass gate", PASS_ANCHOR],
  ]) {
    if (!source.includes(anchor)) {
      throw new Error(`Guided walkthrough staging ${label} patch target is missing`);
    }
  }

  return source
    .replace(ADMIN_FOCUS_ANCHOR, ADMIN_FOCUS_REPLACEMENT)
    .replace(EVIDENCE_ANCHOR, EVIDENCE_REPLACEMENT)
    .replace(PASS_ANCHOR, PASS_REPLACEMENT);
}
