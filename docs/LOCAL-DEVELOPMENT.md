# Local workspace dependencies

The four chart packages depend only downwards; the chat plugin additionally uses
`@supersolutions/super-protocol@0.1.0`. That package has been on npm since 2026-11-15
(released from `Super-Solution/super-protocol`), and `package-lock.json` pins it, so
`npm ci` is all you need. The section below is only for building against an unreleased
protocol checkout.

## Building against an unreleased protocol checkout

Use Node 22 or newer and npm. Obtain an authorized checkout of
`https://github.com/Super-Solution/super-chat.git`; it can live anywhere. With the
two repositories beside each other:

```sh
npm run setup:local -- ../super-chat
npm run typecheck
npm run build
npm run lint
npm test
```

The command also accepts the `packages/protocol` directory directly. It checks
the package name/version against the plugin manifest, copies only the protocol
package into ignored `.local-deps/`, and runs its upstream `tsup` build. It then
packs and installs that real package plus the chart workspace tooling, using a
project-local npm cache. After success it removes its generated source/build staging
directory and retains the small tarball and provenance record. It never
writes to the sibling checkout, publishes a package, or changes the plugin's
registry dependency. Existing registry lockfiles are refused rather than rewritten.

The selected source commit and tarball integrity are recorded locally in
`.local-deps/protocol-source.json`. To reproduce the source used for the first
successful setup, use super-chat commit
`cce6aec680d7a59cfdf8530ba455d3f2c959923a`. The setup records a checkout's HEAD; this
is not an assertion that uncommitted source changes are absent. Keep the checkout
clean when reproducing a reviewed build.

No machine-specific tarball or `.local-deps` lockfile is committed. Development
installations resolve the existing manifest version ranges; they are not a
registry lockfile or an npm release qualification. The local protocol package is
extraneous to the root manifest intentionally: rerun this setup after cleaning
`node_modules`, rather than running a registry-only reinstall while protocol is
unpublished. A plain registry-only `npm install` still cannot resolve protocol.

## After the separate protocol publication

Use ordinary `npm install`, review and commit the resulting registry-backed
`package-lock.json`, then use `npm ci`. Publication requires separate owner
authorization; this setup does not perform it. Core, Superscript and Web do not
acquire any dependency on the chat protocol.

## Validation performed on 2026-11-15

With the real protocol source above, Node 24.12.0 and npm 11.6.2:

- `npm run typecheck`: passed for the complete configured workspace.
- `npm run build`: passed for all four ESM/declaration packages, both Web globals,
  existing packed-content checks, and existing DOM-free Node entry imports.
- `npm run lint`: 81 runtime files, 0 errors and 146 warnings; the existing
  380-warning limit was unchanged.

The first dependency installation failed because the pre-existing global npm
cache referenced a missing file. The same already-built protocol tarball was
then installed successfully with the project-local cache. No sibling source,
published manifest, test case or pipeline was changed by this setup.

The runtime TypeScript configuration explicitly uses `types: []`: these portable
modules do not use ambient Node globals, so a development tool's automatically
installed `@types/node` must not select their runtime environment. Explicitly
imported declarations are still checked; `strict: true` and
`skipLibCheck: false` remain in effect. Both declaration generation and npm's
existing dry-run package check now invoke their JavaScript CLI through Node when
running under npm, avoiding Windows executable-shim failures.
