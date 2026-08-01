const guidedWalkthroughStyles = `<style data-store-walkthrough-styles>
.store-guide-launcher{position:fixed;inset-inline-end:1rem;inset-block-end:1rem;z-index:2147482998;min-block-size:44px;padding:.65rem .9rem;border:2px solid #f0d36d;border-radius:999px;background:#14251e;color:#fff;font:800 .82rem/1 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 10px 28px rgba(20,37,30,.24);cursor:pointer}
.store-guide-launcher:hover{background:#20372d}.store-guide-launcher:focus-visible{outline:3px solid #e09a13;outline-offset:3px}
.store-guide[hidden]{display:none}.store-guide{position:fixed;inset:0;z-index:2147483000;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.store-guide__scrim{position:absolute;inset:0;background:rgba(10,24,19,.58)}
.store-guide__card{position:fixed;inset-inline-end:1rem;inset-block-end:1rem;z-index:2147483003;width:min(27rem,calc(100vw - 2rem));max-block-size:min(36rem,calc(100vh - 2rem));overflow:auto;padding:1rem;border:1px solid #aab6af;border-radius:14px;background:#fffefa;color:#17231e;box-shadow:0 18px 48px rgba(10,24,19,.32)}
.store-guide__eyebrow{margin:0 0 .35rem;color:#15523d;font-size:.7rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.store-guide__card h2{margin:0;font-size:1.35rem;line-height:1.15;letter-spacing:-.02em}.store-guide__copy{margin:.65rem 0 0;color:#405049;font-size:.9rem;line-height:1.55}.store-guide__progress{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin:.9rem 0 0;color:#59675f;font-size:.74rem;font-weight:750}.store-guide__actions,.store-guide__welcome-actions{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;margin-top:1rem}.store-guide__actions button,.store-guide__welcome-actions button{min-block-size:42px;padding:.55rem .75rem;border:1px solid #aab6af;border-radius:9px;background:#fff;color:#17231e;font:800 .78rem/1 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}.store-guide__actions button:hover,.store-guide__welcome-actions button:hover{background:#eef1ed}.store-guide__actions [data-guide-next],.store-guide__welcome-actions [data-guide-full]{border-color:#1f6a51;background:#1f6a51;color:#fff}.store-guide__actions [data-guide-next]:hover,.store-guide__welcome-actions [data-guide-full]:hover{background:#15523d}.store-guide__actions [data-guide-skip]{margin-inline-start:auto;border-color:transparent;background:transparent;color:#59675f}.store-guide__actions [data-guide-skip]:hover{background:#f1f2ed;color:#17231e}.store-guide__card button:focus-visible{outline:3px solid #e09a13;outline-offset:2px}
.store-guide-highlight{position:relative!important;z-index:2147483002!important;outline:4px solid #f0d36d!important;outline-offset:5px!important;box-shadow:0 0 0 9px rgba(255,254,250,.92)!important}
@media(max-width:620px){.store-guide-launcher{inset-inline-end:.75rem;inset-block-end:calc(.75rem + env(safe-area-inset-bottom))}.store-guide__card{inset-inline:.65rem;inset-block-end:calc(.65rem + env(safe-area-inset-bottom));width:auto;max-block-size:58vh}.store-guide__actions button,.store-guide__welcome-actions button{flex:1 1 auto}.store-guide__actions [data-guide-skip]{margin-inline-start:0}}
@media(prefers-reduced-motion:reduce){.store-guide *{scroll-behavior:auto!important;transition:none!important}}
@media print{.store-guide-launcher,.store-guide{display:none!important}}
</style>`;

const guidedWalkthroughUi = `<button type="button" class="store-guide-launcher" data-guide-launcher aria-haspopup="dialog" aria-controls="store-guided-walkthrough">Guide</button><div class="store-guide" id="store-guided-walkthrough" data-store-walkthrough role="dialog" aria-modal="true" aria-labelledby="store-guide-title" aria-describedby="store-guide-copy" hidden><div class="store-guide__scrim" aria-hidden="true"></div><section class="store-guide__card" tabindex="-1"><p class="store-guide__eyebrow" data-guide-eyebrow>Guided walkthrough</p><h2 id="store-guide-title" data-guide-title>Welcome to Store Operating System</h2><p class="store-guide__copy" id="store-guide-copy" data-guide-copy></p><div class="store-guide__progress" data-guide-progress hidden><span data-guide-progress-label></span><span>Esc to exit</span></div><div class="store-guide__welcome-actions" data-guide-welcome-actions><button type="button" data-guide-quick>Quick tour</button><button type="button" data-guide-full>Full walkthrough</button><button type="button" data-guide-dismiss>Skip for now</button></div><div class="store-guide__actions" data-guide-step-actions hidden><button type="button" data-guide-back>Back</button><button type="button" data-guide-next>Next</button><button type="button" data-guide-skip>Exit guide</button></div></section></div>`;

const guidedWalkthroughScript = `<script data-store-walkthrough-script>
(function(){
  "use strict";
  var root=document.querySelector("[data-store-walkthrough]");
  var launcher=document.querySelector("[data-guide-launcher]");
  var shell=document.querySelector("[data-shell]");
  if(!root||!launcher||!shell||root.getAttribute("data-ready")==="true")return;
  root.setAttribute("data-ready","true");

  var card=root.querySelector(".store-guide__card");
  var eyebrow=root.querySelector("[data-guide-eyebrow]");
  var title=root.querySelector("[data-guide-title]");
  var copy=root.querySelector("[data-guide-copy]");
  var progress=root.querySelector("[data-guide-progress]");
  var progressLabel=root.querySelector("[data-guide-progress-label]");
  var welcomeActions=root.querySelector("[data-guide-welcome-actions]");
  var stepActions=root.querySelector("[data-guide-step-actions]");
  var quickButton=root.querySelector("[data-guide-quick]");
  var fullButton=root.querySelector("[data-guide-full]");
  var dismissButton=root.querySelector("[data-guide-dismiss]");
  var backButton=root.querySelector("[data-guide-back]");
  var nextButton=root.querySelector("[data-guide-next]");
  var skipButton=root.querySelector("[data-guide-skip]");
  var surface=shell.getAttribute("data-shell")==="pos"?"pos":"admin";
  var highlighted=null;
  var activeSteps=[];
  var activeIndex=0;
  var activeMode="";
  var previousFocus=null;
  var storagePrefix="store-os:guided-walkthrough:v1:";

  var adminDescriptions={
    "/":"Start here to read the current operating state, business date, exceptions, and work queues. Open the item that needs attention and use the evidence shown on the page before changing business state.",
    "/catalog":"Manage the sellable catalog here: products, variants, identifiers, units, barcodes, and availability rules. Search first, open the exact record, then verify status and identifiers before editing.",
    "/catalog/products":"Use product detail to review one product and its variants, identifiers, attributes, prices, and sellability. Keep variant-level facts distinct from the parent product.",
    "/catalog/imports":"Use imports for controlled bulk catalog changes. Validate the file and error report first, review the proposed changes, then apply only when the batch is clean.",
    "/catalog/units":"Define units and conversions used by products and inventory. Confirm conversion direction and precision before assigning a unit to sellable variants.",
    "/pricing":"Review price lists, effective dates, channels, and precedence here. Confirm which rule wins for the current store, customer, and business date before publishing a price change.",
    "/pricing/promotions":"Create and review promotions, coupons, eligibility, stacking, and validity windows. Test the intended basket conditions before activating a promotion.",
    "/pricing/discount-approvals":"Handle controlled discount requests here. Check the requested amount, policy limit, requester, and audit trail before approving or rejecting.",
    "/tax":"Configure tax categories, rates, calculation rules, and effective dates. Verify jurisdiction and tax-inclusive or tax-exclusive behavior before enabling a rule.",
    "/tax/exemptions":"Review tax exemptions and their evidence here. Confirm customer, jurisdiction, validity period, and supporting document before accepting an exception.",
    "/inventory":"Use inventory to understand on-hand, available, reserved, and movement history. Trace the location and source document before making a stock correction.",
    "/procurement":"Manage purchase orders, receiving, suppliers, and procurement exceptions. Match ordered, received, and invoiced quantities before completing a receiving flow.",
    "/customers":"Open customer profiles, addresses, consent, credit, and history here. Use the exact customer record and respect consent and data-access boundaries.",
    "/sales":"Follow quotes, orders, invoices, returns, and their state transitions here. Check totals, customer, fulfillment, payment, and audit history before progressing an order.",
    "/fulfillment":"Plan reservation, picking, packing, shipping, pickup, and returns here. Work from the current fulfillment state and resolve shortages or exceptions before advancing.",
    "/finance/payments":"Track payment authorization, capture, refund, settlement, and failures. Reconcile provider references and amounts before retrying or refunding a transaction.",
    "/finance/accounting":"Review journals, receivables, payables, and ledger evidence here. Open the source document and posting trace before making an accounting correction.",
    "/finance/banking":"Import statements and reconcile bank activity here. Match amount, date, counterparty, and reference; leave ambiguous items unresolved instead of forcing a match.",
    "/finance/readiness":"Use finance readiness before close or handoff. Resolve integrity, reconciliation, and recovery warnings until the evidence is complete.",
    "/pos/reconciliation":"Review register sessions, cash differences, offline operations, and sync evidence here. Investigate the source session before accepting a variance.",
    "/localization":"Manage country packs, locales, currencies, business-date behavior, and regional settings here. Review the effective country pack before changing operating rules.",
    "/compliance":"Review fiscal, legal, privacy, retention, and compliance evidence here. Treat missing evidence or expired controls as blockers, not informational notes.",
    "/reporting":"Use reporting for operational metrics, exports, freshness, and reconciliation. Check the report period, source scope, and freshness before making a business decision from a number.",
    "/integrations":"Manage connectors, webhooks, API configuration, and diagnostics here. Verify environment, credentials, delivery status, and retry evidence before changing an integration.",
    "/platform/saas":"Manage plans, subscriptions, usage, incidents, and support controls here. Use explicit approvals for tenant-impacting or billing-sensitive actions."
  };
  var posDescriptions={
    "/":"This is the register workspace. Scan or select the exact item, verify quantity and price, review the cart totals, then choose the permitted checkout action. Offline state is always shown before you commit a sale.",
    "/sync":"Use Sync status to review queued offline operations, last synchronization, conflicts, and recovery state. Resolve conflicts before assuming a sale or stock change reached the server.",
    "/device":"Use Device to confirm this register, location, device identity, and operating health. Device or permission problems should be resolved before starting a selling session."
  };

  function safeGet(storage,key){try{return storage.getItem(key);}catch(_error){return null;}}
  function safeSet(storage,key,value){try{storage.setItem(key,value);}catch(_error){}}
  function safeRemove(storage,key){try{storage.removeItem(key);}catch(_error){}}
  function routeLinks(){
    return Array.prototype.slice.call(document.querySelectorAll(".primary-nav a[href]")).map(function(link){
      var href=link.getAttribute("href")||"/";
      var url;
      try{url=new URL(href,window.location.origin);}catch(_error){return null;}
      if(url.origin!==window.location.origin)return null;
      var path=url.pathname.replace(/\\/+$/u,"")||"/";
      if(surface==="admin"){
        if(path==="/admin")path="/";
        else if(path.indexOf("/admin/")===0)path=path.slice(6)||"/";
      }else if(surface==="pos"){
        if(path==="/pos")path="/";
        else if(path.indexOf("/pos/")===0)path=path.slice(4)||"/";
      }
      return {href:url.pathname+url.search,path:path,label:(link.textContent||path).trim(),element:link};
    }).filter(Boolean);
  }
  function descriptionFor(path){
    var descriptions=surface==="pos"?posDescriptions:adminDescriptions;
    if(descriptions[path])return descriptions[path];
    if(surface==="admin"&&path.indexOf("/catalog/products/")===0)return adminDescriptions["/catalog/products"];
    return "Review this workspace carefully, confirm the current state and evidence, then use only the actions available to your role.";
  }
  function visibleTarget(selector){
    if(!selector)return null;
    var nodes=Array.prototype.slice.call(document.querySelectorAll(selector));
    for(var i=0;i<nodes.length;i+=1){if(nodes[i].getClientRects().length>0)return nodes[i];}
    return null;
  }
  function clearHighlight(){if(highlighted){highlighted.classList.remove("store-guide-highlight");highlighted=null;}}
  function highlight(selector){
    clearHighlight();
    highlighted=visibleTarget(selector);
    if(!highlighted)return;
    highlighted.classList.add("store-guide-highlight");
    highlighted.scrollIntoView({block:"center",inline:"nearest",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
  }
  function signature(){return surface+":"+routeLinks().map(function(route){return route.path;}).join("|");}
  function seenKey(){return storagePrefix+"seen:"+signature();}
  function sessionKey(){return storagePrefix+"session:"+surface;}
  function markSeen(){safeSet(window.localStorage,seenKey(),"1");}
  function saveSession(){safeSet(window.sessionStorage,sessionKey(),JSON.stringify({mode:activeMode,index:activeIndex,signature:signature()}));}
  function clearSession(){safeRemove(window.sessionStorage,sessionKey());}
  function focusable(){return Array.prototype.slice.call(card.querySelectorAll("button:not([hidden]):not([disabled])")).filter(function(node){return node.getClientRects().length>0;});}
  function openDialog(){
    if(root.hidden){previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;root.hidden=false;}
    window.setTimeout(function(){card.focus();},0);
  }
  function closeDialog(){
    clearHighlight();clearSession();root.hidden=true;activeSteps=[];activeIndex=0;activeMode="";
    if(previousFocus&&typeof previousFocus.focus==="function")previousFocus.focus();else launcher.focus();
  }
  function showWelcome(){
    clearHighlight();activeMode="welcome";activeSteps=[];activeIndex=0;
    eyebrow.textContent=surface==="pos"?"POS guide":"Operations guide";
    title.textContent="Welcome to Store Operating System";
    copy.textContent=surface==="pos"?"Choose a quick orientation or walk through every POS area your role can access. You can reopen this guide at any time from the Guide button.":"Choose a quick orientation or walk through every Admin area your role can access. The full walkthrough follows only the navigation your permissions allow, so hidden or restricted functions are never presented as available.";
    progress.hidden=true;welcomeActions.hidden=false;stepActions.hidden=true;openDialog();
  }
  function quickSteps(){
    var steps=[
      {title:"Your workspace",body:"This identifies the operating surface you are using. Admin focuses on back-office operations; POS focuses on the register workflow.",selector:".product-lockup,.shell-rail"},
      {title:"Business context",body:"The top bar shows the tenant, location, signed-in user, and workspace context. Confirm this context before making changes that affect stock, money, customers, or compliance.",selector:".shell-topbar"},
      {title:"Functions available to you",body:"Navigation is permission-filtered. If a function is not shown here, your current role is not presenting it as an available workflow.",selector:".primary-nav"},
      {title:"Current work area",body:"The main work area shows the selected function, its current state, actions, exceptions, and evidence. Read the page state before acting; disabled, empty, conflict, and offline states are intentional information.",selector:"#main,.shell-main"},
      {title:"Guidance whenever you need it",body:"Use the Guide button at any time to restart this orientation or launch the full function-by-function walkthrough.",selector:"[data-guide-launcher]"}
    ];
    return steps;
  }
  function fullSteps(){
    var steps=quickSteps().slice(0,3);
    routeLinks().forEach(function(route){steps.push({title:route.label,body:descriptionFor(route.path),selector:"#main h1,.shell-main h1,.page-heading h1,.pos-heading h1,#main",href:route.href,path:route.path});});
    steps.push({title:"You can return to the guide",body:"The walkthrough is complete. Use Guide whenever you want a refresher; it will always rebuild itself from the functions currently visible to your role.",selector:"[data-guide-launcher]"});
    return steps;
  }
  function samePath(href){
    try{return new URL(href,window.location.origin).pathname.replace(/\\/+$/u,"")===window.location.pathname.replace(/\\/+$/u,"");}catch(_error){return true;}
  }
  function renderStep(){
    if(activeIndex<0)activeIndex=0;
    if(activeIndex>=activeSteps.length){markSeen();closeDialog();return;}
    var step=activeSteps[activeIndex];
    if(step.href&&!samePath(step.href)){saveSession();window.location.assign(step.href);return;}
    welcomeActions.hidden=true;stepActions.hidden=false;progress.hidden=false;
    eyebrow.textContent=activeMode==="full"?"Full walkthrough":"Quick tour";
    title.textContent=step.title;
    copy.textContent=step.body;
    progressLabel.textContent="Step "+String(activeIndex+1)+" of "+String(activeSteps.length);
    backButton.disabled=activeIndex===0;
    nextButton.textContent=activeIndex===activeSteps.length-1?"Finish":"Next";
    highlight(step.selector);
    saveSession();openDialog();
  }
  function start(mode,index){
    activeMode=mode;
    activeSteps=mode==="full"?fullSteps():quickSteps();
    activeIndex=Math.max(0,Math.min(typeof index==="number"?index:0,activeSteps.length-1));
    markSeen();renderStep();
  }
  function resume(){
    var raw=safeGet(window.sessionStorage,sessionKey());
    if(!raw)return false;
    try{
      var saved=JSON.parse(raw);
      if(!saved||saved.signature!==signature()||(saved.mode!=="quick"&&saved.mode!=="full")){clearSession();return false;}
      start(saved.mode,Number.isInteger(saved.index)?saved.index:0);return true;
    }catch(_error){clearSession();return false;}
  }

  launcher.addEventListener("click",showWelcome);
  quickButton.addEventListener("click",function(){start("quick",0);});
  fullButton.addEventListener("click",function(){start("full",0);});
  dismissButton.addEventListener("click",function(){markSeen();closeDialog();});
  skipButton.addEventListener("click",function(){markSeen();closeDialog();});
  backButton.addEventListener("click",function(){if(activeIndex>0){activeIndex-=1;renderStep();}});
  nextButton.addEventListener("click",function(){activeIndex+=1;renderStep();});
  root.addEventListener("click",function(event){if(event.target&&event.target.classList&&event.target.classList.contains("store-guide__scrim")){markSeen();closeDialog();}});
  document.addEventListener("keydown",function(event){
    if(root.hidden)return;
    if(event.key==="Escape"){event.preventDefault();markSeen();closeDialog();return;}
    if(activeMode!=="welcome"&&event.key==="ArrowRight"){event.preventDefault();activeIndex+=1;renderStep();return;}
    if(activeMode!=="welcome"&&event.key==="ArrowLeft"){event.preventDefault();if(activeIndex>0){activeIndex-=1;renderStep();}return;}
    if(event.key!=="Tab")return;
    var items=focusable();if(items.length===0){event.preventDefault();card.focus();return;}
    var first=items[0],last=items[items.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  window.addEventListener("pagehide",function(){clearHighlight();});
  if(!resume()&&safeGet(window.localStorage,seenKey())!=="1")window.setTimeout(showWelcome,350);
})();
</script>`;

export const guidedWalkthroughMarkup = `${guidedWalkthroughStyles}${guidedWalkthroughUi}${guidedWalkthroughScript}`;
