# Maintaining this private snapshot

This repository is Super-Solution/super-chart and remains private.

Imported version: 0.0.40. Source: ZzyzxLabs/zzyzx-full-repo, main commit de693554a087299df77fbd65be8e1f1f445f9fee, directory frontend/super-chart. The initial tag v0.0.40 identifies this source snapshot; no npm or GitHub Packages publication was performed.

The imported v0.0.40 tag remains the original snapshot. Owner-authorized shared-core development now takes place in this repository on its own branch. The deployed SupWallet/Broker source and dependencies in the old monorepo remain unchanged. Do not automatically mirror either direction or overwrite work here. See docs/SHARED-CORE.md, docs/SHARED-LOADER.md and docs/NATIVE-LIFECYCLE.md and docs/AXIS-KEY-PERFORMANCE.md and docs/LATEST-HIT-PERFORMANCE.md and docs/SHARED-CANDLE-TRANSFORM.md for scope, validation and measurements.

LICENSE and NOTICE retain the upstream Apache-2.0 notices. Private repository visibility does not replace or narrow those license terms.

This snapshot includes source, existing tests, examples and lockfiles. It excludes monorepo history, node_modules, build output and the inherited hosted CI/package-publish workflows. No new pipeline is installed.

For local development, use the existing package scripts with the locked dependencies: bun install --frozen-lockfile --ignore-scripts, bun run build, and relevant existing tests. Run browser checks only when relevant; no package is published by these local commands.

The package name and GitHub Packages publishConfig are retained for compatibility. The repository URL is updated to this repository. Publishing a package, making this repository public, or changing release automation requires a separate owner instruction.

See docs/NORMALIZATION-BUFFER.md for the subsequent normalization buffer optimization.

See docs/REALTIME-SERIES.md for the opt-in batch sink and incremental native indicators.

See docs/REALTIME-VIEW.md for stable viewport subscriptions and incremental Heikin Ashi.

See docs/REALTIME-INSPECTION.md for visible geometry, cursor inspection and time navigation.

See docs/REALTIME-DEMO.md for the offline interactive shared-core development demo.

See docs/BOUNDED-TA-STORAGE.md for shared TA auxiliary-memory bounds and measured trade-offs.

See docs/PIVOT-PERFORMANCE.md for large-window pivot complexity and measured trade-offs.
