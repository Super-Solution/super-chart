import { defineConfig } from "vitest/config";

// Standalone test config (kept separate from the library's vite.config.ts so the
// Solid plugin / lib-build options don't apply to unit tests). The SuperScript and
// AI layers are plain TS and run in a node environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
