// @ts-check
import { defineConfig } from "astro/config";
import basicSsl from "@vitejs/plugin-basic-ssl";
import tailwindcss from "@tailwindcss/vite";
import icons from "astro-icon";
import cloudflare from "@astrojs/cloudflare";

import db from "@astrojs/db";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  integrations: [icons(), db({ mode: "web" })],
  vite: {
    plugins: [tailwindcss(), basicSsl()],
  },
});
