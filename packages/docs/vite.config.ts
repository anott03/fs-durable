import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { highlight } from "./highlight.js";

export default defineConfig({
  plugins: [react(), tailwindcss(), highlight({ lang: "typescript", theme: "github-dark-default" })],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: "react", test: /\/node_modules\/(react|react-dom|scheduler)\// }],
        },
      },
    },
  },
});
