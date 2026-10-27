import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { highlight } from "./highlight.js";

export default defineConfig({
  plugins: [react(), tailwindcss(), highlight({ lang: "typescript", theme: "github-dark-default" })],
  build: {
    rolldownOptions: {
      input: {
        docs: fileURLToPath(new URL("./index.html", import.meta.url)),
        benchmarks: fileURLToPath(new URL("./benchmarks.html", import.meta.url)),
      },
      output: {
        codeSplitting: {
          groups: [{ name: "react", test: /\/node_modules\/(react|react-dom|scheduler)\// }],
        },
      },
    },
  },
});
