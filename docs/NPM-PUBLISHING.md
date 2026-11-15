# Public npm publishing

> **Package split (draft, nothing published).** The single package `@super-solution/super-chart` (latest 0.0.53) is replaced by five packages under `@supersolutions`: `super-chart-core`, `-superscript`, `-web`, `-react`, `-chat-plugin`. 0.1.0 shipped the first four; 0.2.0 adds `-react` and moves every package to 0.2.0 (`super-protocol` keeps its own version). Each needs its own trusted publisher entry on npm with the same fields below, and `@supersolutions/super-protocol` must be published first (the plugin depends on it). The workflow publishes in dependency order. The old package would then be deprecated pointing at the new names. None of this has been done; it waits for the owner. `@supersolutions/super-protocol@0.1.0` is on the registry and `package-lock.json` is committed, so the workflow installs with `npm ci`.

**New package, new trust.** `@supersolutions/super-chart-react` has never been on
npm. Before the first release the owner reserves the name (a placeholder version)
and adds the trusted publisher entry in the table below for it, exactly as for the
other packages; otherwise the workflow's publish step fails for that package. The
workflow publishes in dependency order: core, superscript, web, react, chat-plugin.

The original text below describes the old single package.

The previous single package was `@super-solution/super-chart` (see the split note above); the GitHub repository is now public.
The owner authorized a manual Trusted Publishing workflow. It does not run on
pushes or pull requests, upload Actions artifacts, or use an npm token.

## One-time npm setup

The initial public version 0.0.53 was staged and approved by the owner on
2026-11-04; the registry's latest tag now points to 0.0.53. The package therefore
exists and can be configured for Trusted Publishing without another release.

In the package's npm settings, add this GitHub Actions trusted publisher:

| Field | Value |
| --- | --- |
| Organization | `Super-Solution` |
| Repository | `super-chart` |
| Workflow filename | `npm-publish.yml` |
| Environment | Leave empty |
| Allowed action | Enable direct `npm publish` |

Creating this relationship requires account 2FA; a bypass-2FA granular token
cannot configure it. Configure it when the next release is ready: a new trust
configuration expires if not used successfully within two days. After the first
successful OIDC release, revoke unused publishing tokens and disable token-based
publishing in npm package settings.

## Subsequent releases

Merge the reviewed release version and this workflow to `main`. In GitHub Actions,
run **Publish npm package** on `main`, entering the exact package version. The
workflow uses a GitHub-hosted runner, locked dependencies, and the existing build
and package-consumer checks. It publishes the resulting tarball directly using
short-lived OIDC credentials. Already-published versions cannot be overwritten;
the first workflow release must use a version newer than the initial release.

No additional test suite or CI trigger is introduced. The repository is public, so
hosted runner minutes are free. npm does not support these trusted publishers on
self-hosted runners. Because the source is public, each release is published with
provenance (`--provenance`); every package's `repository.url` must keep pointing at
this repository or npm rejects the publish.

The version must be `X.Y.Z` (published to `latest`) or `X.Y.Z-next.N` (published to `next`);
anything else fails before the build. The workflow derives the tag from the version and
passes it to `npm publish --tag`, which overrides each manifest's `publishConfig.tag`
(`latest`), so a prerelease can never reach `latest`. Publishing by hand without `--tag`
would still use the manifest's `latest`: do not.

Confirm the released version and `latest` tag in the public registry after a run.
If publishing fails, inspect that run before dispatching again.

References: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
and [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).
