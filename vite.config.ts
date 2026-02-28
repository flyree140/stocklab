import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/stocklab/",   // ★ repo 名稱要一致：stocklab
  plugins: [react()],
});