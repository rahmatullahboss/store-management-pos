// @ts-check
import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

export default defineConfig({
  devToolbar: { enabled: false },
  output: "server",
  compressHTML: true,
  build: {
    inlineStylesheets: "always",
  },
  vite: {
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
