import { defineConfig } from "vitest/config";

// Existing portable correctness cases retained for the owned API. Legacy Pro
// suites still in the source archive target retired upstream/private contracts;
// they are not silently counted as passing validation of the new engine.
// See docs/OWNED-API-MIGRATION.md. No new test cases or pipeline are introduced.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/DefaultDatafeed.test.ts",
      "src/ai/*.test.ts",
      "src/charttypes/geometry.test.ts",
      "src/common/object.test.ts",
      "src/data/*.test.ts",
      "src/draw-by-holding/recognizer.test.ts",
      "src/drawing-editor/{history,magnet}.test.ts",
      "src/extension/{fairValueGaps,fibLevels,orderBlocks,previousRangeHighLow,volumeProfile}.test.ts",
      "src/i18n/numbers.test.ts",
      "src/period/parsePeriod.test.ts",
      "src/widget/symbol-search-modal/nav.test.ts",
      "src/replay/controller.test.ts",
      "src/canvas/countdown.test.ts",
      "src/superscript-entry.test.ts",
      "src/superscript/*.test.ts",
      "src/ta/*.test.ts",
      "src/time/{formatBarDate,resolveTz}.test.ts",
      "scripts/entry-file-name.test.ts",
    ],
  },
});
