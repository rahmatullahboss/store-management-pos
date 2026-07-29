// @ts-check
import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

export default defineConfig({
  devToolbar: { enabled: false },
  output: "server",
  compressHTML: true,
  redirects: {
    "/__evidence/storefront": "/evidence/storefront",
  },
  build: {
    inlineStylesheets: "always",
  },
  vite: {
    define: {
      "import.meta.env.STOREFRONT_EVIDENCE_MODE": JSON.stringify(
        process.env.STOREFRONT_EVIDENCE_MODE ?? "0",
      ),
    },
    ssr: {
      resolve: {
        conditions: ["workerd", "worker", "browser"],
      },
    },
    build: {
      cssCodeSplit: true,
      minify: true,
    },
  },
  adapter: cloudflare({
    imageService: "passthrough",
    inspectorPort: 9234,
  }),
});
