import { guidedWalkthroughMarkup } from "./guided-walkthrough.js";

export const directionSupportStyles = `<style>
html[dir="rtl"] .app-shell,html[dir="rtl"] .shell-topbar,html[dir="rtl"] .shell-rail,html[dir="rtl"] .shell-main,html[dir="rtl"] .workspace,html[dir="rtl"] .page-heading,html[dir="rtl"] .pos-heading,html[dir="rtl"] .signal-band,html[dir="rtl"] .operations-layout,html[dir="rtl"] .checkout-layout{min-inline-size:0;max-inline-size:100%}
html[dir="rtl"] .primary-nav,html[dir="rtl"] .table-wrap{min-inline-size:0;max-inline-size:100%;contain:inline-size}
</style>${guidedWalkthroughMarkup}`;
