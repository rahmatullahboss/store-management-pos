import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../../apps/marketing-web/src/index.html", import.meta.url);
const cssPath = new URL("../../apps/marketing-web/src/styles.css", import.meta.url);
const scriptPath = new URL("../../apps/marketing-web/src/script.js", import.meta.url);

const [html, css, script] = await Promise.all([
  readFile(htmlPath, "utf8"),
  readFile(cssPath, "utf8"),
  readFile(scriptPath, "utf8"),
]);

test("marketing landing page preserves product truth and action hierarchy", () => {
  assert.match(html, /THESIS: A single transaction becomes the page's navigation spine/u);
  assert.match(html, /<main id="main"/u);
  assert.match(html, /<h1 id="hero-title">One sale\. Every operational effect\. Fully traceable\.<\/h1>/u);
  assert.match(html, /Illustrative interface · synthetic data/u);
  assert.match(html, /recommended launch pricing/iu);
  assert.match(html, /id="pricing"/u);
  assert.match(html, /id="questions"/u);
  assert.doesNotMatch(html, /trusted by|customer logo|testimonial/iu);
});

test("pricing is explicit, bounded and marked for validation", () => {
  for (const amount of ["৳2,990", "৳7,990", "৳19,900"]) assert.match(html, new RegExp(amount, "u"));
  assert.match(html, /Final commercial terms should be validated with pilot customers/u);
  assert.match(html, /Hardware, payment-processing fees, VAT, custom integrations, data migration and on-site implementation are quoted separately/u);
});

test("landing page includes responsive and accessible interaction contracts", () => {
  assert.match(css, /:focus-visible/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(css, /@media \(max-width: 620px\)/u);
  assert.doesNotMatch(css, /background-clip:\s*text|-webkit-background-clip:\s*text/iu);
  assert.match(script, /aria-expanded/u);
  assert.match(script, /aria-pressed/u);
  assert.match(script, /IntersectionObserver/u);
});
