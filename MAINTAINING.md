# Maintaining this private snapshot

This repository is Super-Solution/super-chart and remains private.

Imported version: 0.0.40. Source: ZzyzxLabs/zzyzx-full-repo, main commit de693554a087299df77fbd65be8e1f1f445f9fee, directory frontend/super-chart. The initial tag v0.0.40 identifies this source snapshot; no npm or GitHub Packages publication was performed.

The imported v0.0.40 tag remains the original snapshot. Owner-authorized shared-core development now takes place in this repository on its own branch. The deployed SupWallet/Broker source and dependencies in the old monorepo remain unchanged. Do not automatically mirror either direction or overwrite work here. See docs/SHARED-CORE.md for scope, validation and measurements.

LICENSE and NOTICE retain the upstream Apache-2.0 notices. Private repository visibility does not replace or narrow those license terms.

This snapshot includes source, existing tests, examples and lockfiles. It excludes monorepo history, node_modules, build output and the inherited hosted CI/package-publish workflows. No new pipeline is installed.

For local development, use the existing package scripts with the locked dependencies: bun install --frozen-lockfile --ignore-scripts, bun run build, and relevant existing tests. Run browser checks only when relevant; no package is published by these local commands.

The package name and GitHub Packages publishConfig are retained for compatibility. The repository URL is updated to this repository. Publishing a package, making this repository public, or changing release automation requires a separate owner instruction.
