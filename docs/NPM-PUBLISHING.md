# Public npm publishing from private source

The package is `@super-solution/super-chart`; the GitHub repository stays private.
The owner authorized a manual Trusted Publishing workflow. It does not run on
pushes or pull requests, upload Actions artifacts, or use an npm token.

## One-time npm setup

The package has not yet been published successfully. Current npm documentation
requires the package to exist before configuring a trusted publisher. Complete
the initial public release with an interactive npm login and the account's 2FA.
Do not retry the blocked token publication or publish a placeholder implicitly.

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

No additional test suite or CI trigger is introduced. Hosted runner usage counts
against the private repository's GitHub Actions allowance; do not enable paid
overage as part of this setup. npm does not support these trusted publishers on
self-hosted runners. The private source repository cannot produce npm public
provenance, so provenance is explicitly disabled; OIDC authentication still applies.

Confirm the released version and `latest` tag in the public registry after a run.
If publishing fails, inspect that run before dispatching again.

References: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
and [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).
