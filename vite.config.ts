import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "admin-entry",
      apply: "build",
      closeBundle() {
        mkdirSync("dist/admin", { recursive: true });
        writeFileSync(
          "dist/admin/index.html",
          readFileSync("dist/index.html", "utf8").replace(
            "<head>",
            '<head><meta name="robots" content="noindex,nofollow">',
          ),
        );
      },
    },
  ],
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
