# Super Chart agent instructions

Read `MAINTAINING.md` before changing this standalone repository.

The owner requires permission before adding test cases, assertions, fixtures or
snapshot baselines. Run relevant existing validation; do not add a CI pipeline.
Prefer functional and financial correctness checks over text, style or visual
snapshot assertions.

The owned Pro and rendering-engine replacement is described in
`docs/OWNED-ENGINE.md`. The owner chose a new API with a migration guide instead
of compatibility with upstream internals. All public package entries must use
the owned engine and have no KLineCharts or Solid runtime/peer dependency.
Document intentionally retired features in `docs/OWNED-API-MIGRATION.md`; do not
provide silent no-op compatibility methods or claim complete legacy parity.

Work in this repository; do not mirror changes into the SupWallet monorepo.
Retain applicable third-party notices. Follow the owner's current authorization
for pushing, merging and publishing; a local build does not authorize a release.

Packages are layered core <- superscript, core <- web <- chat-plugin (see
`docs/PACKAGES.md`). A package may import only what it declares;
`scripts/check-package.mjs` fails the build otherwise. Do not add a dependency
from core, superscript or web on the plugin protocol or on a UI framework.
