import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const PRELOAD_MARK = "data-game-preload";
/**
 * The game is lazy-loaded so /admin/ never downloads it. For players, preload the
 * game chunks from the HTML so they download in parallel with the entry script.
 */
function gamePreload(): Plugin {
  return {
    name: "game-preload",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return [];
        const app = Object.values(bundle).find(
          (item) => item.type === "chunk" && item.name === "App",
        );
        if (!app || app.type !== "chunk") return [];
        // The entry script is already in the page; preload only what it will import.
        const files = [app.fileName, ...app.imports].filter((file) => {
          const chunk = bundle[file];
          return !(chunk?.type === "chunk" && chunk.isEntry);
        });
        return files.map((file) => ({
          tag: "link",
          attrs: { rel: "modulepreload", href: "/" + file, [PRELOAD_MARK]: "" },
          injectTo: "head" as const,
        }));
      },
    },
  };
}
export default defineConfig({
  plugins: [
    react(),
    gamePreload(),
    {
      name: "admin-entry",
      apply: "build",
      closeBundle() {
        mkdirSync("dist/admin", { recursive: true });
        writeFileSync(
          "dist/admin/index.html",
          readFileSync("dist/index.html", "utf8")
            .replace(
              "<head>",
              '<head><meta name="robots" content="noindex,nofollow">',
            )
            // The admin panel must not fetch the game bundle or game fonts.
            .replace(new RegExp(`\\s*<link[^>]*${PRELOAD_MARK}[^>]*>`, "g"), ""),
        );
      },
    },
  ],
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
