# Maintaining this snapshot

This repository is Super-Solution/super-chart (public since 2026-11-15).

Imported version: 0.0.40. Source: ZzyzxLabs/zzyzx-full-repo, main commit de693554a087299df77fbd65be8e1f1f445f9fee, directory frontend/super-chart. The initial tag v0.0.40 identifies this source snapshot; no npm or GitHub Packages publication was performed.

The imported v0.0.40 tag remains the original snapshot. Owner-authorized shared-core development now takes place in this repository on its own branch. The deployed SupWallet/Broker source and dependencies in the old monorepo remain unchanged. Do not automatically mirror either direction or overwrite work here. See docs/SHARED-CORE.md, docs/SHARED-LOADER.md and docs/NATIVE-LIFECYCLE.md and docs/AXIS-KEY-PERFORMANCE.md and docs/LATEST-HIT-PERFORMANCE.md and docs/SHARED-CANDLE-TRANSFORM.md for scope, validation and measurements.

The packages are GPL-3.0-or-later (commercial licence available); LICENSE holds the GPL text; NOTICE records provenance. Earlier published versions are not maintained and the licence is not retroactive. ZzyzxLabs is the former internal name of SUPER SOLUTION LABS INC (owner, 2026-11-07), so the SuperScript, AI and shared-core code needs no assignment before relicensing. GPL-3.0-or-later for the core is the default pending the owner's choice between GPL-3.0-or-later, -only and AGPL.

This snapshot includes source, existing tests, examples and lockfiles. It excludes monorepo history, node_modules, build output and the inherited hosted CI/package-publish workflows. The owner subsequently authorized the manual npm Trusted Publishing workflow documented in docs/NPM-PUBLISHING.md; no push/PR test pipeline is installed.

For local development: `npm ci`, then `npm run build`, `npm test`, `npm run typecheck` and `npm run lint`. See [LOCAL-DEVELOPMENT.md](LOCAL-DEVELOPMENT.md) for the real protocol source, prerequisites and installation limitations. The repository is an npm workspace of five packages; `package-lock.json` pins `@supersolutions/super-protocol@0.1.0` from the registry, so a plain `npm ci` works. Run browser checks only when relevant; these commands publish nothing.

Owner authorized public npm publication on 2026-11-03 as @super-solution/super-chart, followed by manual Trusted Publishing automation. publishConfig targets registry.npmjs.org with public access. The owner made the GitHub repository public on 2026-11-15; adding other automation requires separate authorization. Existing original-monorepo consumers are unchanged.

See docs/NORMALIZATION-BUFFER.md for the subsequent normalization buffer optimization.

See docs/REALTIME-SERIES.md for the opt-in batch sink and incremental native indicators.

See docs/REALTIME-VIEW.md for stable viewport subscriptions and incremental Heikin Ashi.

See docs/REALTIME-INSPECTION.md for visible geometry, cursor inspection and time navigation.

See docs/REALTIME-DEMO.md for the offline interactive shared-core development demo.

See docs/BOUNDED-TA-STORAGE.md for shared TA auxiliary-memory bounds and measured trade-offs.

See docs/PIVOT-PERFORMANCE.md for large-window pivot complexity and measured trade-offs.

See docs/MODEL-IDENTITY-PERFORMANCE.md for build-local time-key reuse and measured trade-offs.

The owner has authorized an owned replacement of both the Pro shell and the underlying engine, and explicitly chose a new API with a migration guide over compatibility with upstream internals. The 0.1 package entries use the owned engine. See docs/OWNED-ENGINE.md for implemented behavior and measurements, and docs/OWNED-API-MIGRATION.md for the breaking changes and intentionally retired features. A local candidate version is not a published release.

The owner's testing preference persists: ask before adding test cases, test assertions, fixtures or snapshot baselines. Run relevant existing validation and use bounded manual observations for changed behavior. Do not add CI workflows for this rewrite.

See docs/TRADE-HEADS.md for the planned trade-heads layer (avatars on the candles where people traded): designed, not implemented.
