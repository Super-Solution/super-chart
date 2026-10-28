# Maintaining this private snapshot

This repository is Super-Solution/super-chart and remains private.

Imported version: 0.0.40. Source: ZzyzxLabs/zzyzx-full-repo, main commit de693554a087299df77fbd65be8e1f1f445f9fee, directory frontend/super-chart. The initial tag v0.0.40 identifies this source snapshot; no npm or GitHub Packages publication was performed.

The upstream monorepo remains the source of truth for this snapshot. This import does not retarget its existing mirror or change SupWallet/Broker dependencies. There is no automatic sync configured for this repository. Reconcile later changes deliberately rather than overwriting edits.

LICENSE and NOTICE retain the upstream Apache-2.0 notices. Private repository visibility does not replace or narrow those license terms.

This snapshot includes source, existing tests, examples and lockfiles. It excludes monorepo history, node_modules, build output and the inherited hosted CI/package-publish workflows. No new pipeline is installed.

For local development, use the existing package scripts with the locked dependencies: bun install --frozen-lockfile --ignore-scripts, bun run build, and relevant existing tests. Run browser checks only when relevant; no package is published by these local commands.

The package name and GitHub Packages publishConfig are retained for compatibility. The repository URL is updated to this repository. Publishing a package, making this repository public, or changing release automation requires a separate owner instruction.
