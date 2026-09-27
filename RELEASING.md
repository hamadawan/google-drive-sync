# Publishing GitHub releases

Distribution uses the public [hamadawan/google-drive-sync](https://github.com/hamadawan/google-drive-sync) repository, immutable version tags, and an installable tarball attached to each GitHub release. An npm account is not required for GitHub installs.

## Install v0.1.0

Run in each consuming app:

```sh
npm install github:hamadawan/google-drive-sync#v0.1.0
npm run typecheck
npm test
```

Commit the manifest and lockfile. The lockfile pins the resolved commit. App postinstall scripts copy the package's web authorization helper. Both ProSpend and Noor-e-Qalb use this package.

## Publish a new version

Sign in with `gh auth login`. Update the version in `package.json` and its lockfile, and add release notes to `CHANGELOG.md`. Then:

```sh
npm ci
npm test
npm pack
git diff --exit-code -- dist
```

If source changed, commit the matching rebuilt `dist/` files along with source and metadata before continuing. Review source, README, LICENSE, and the archive. Never include app credentials, databases, or user records in the package.

For example, to release version 0.2.0 after preparing and committing it:

```sh
git push origin main
git tag -a v0.2.0 -m 'Release v0.2.0'
git push origin v0.2.0
gh release create v0.2.0 hamadawan-google-drive-sync-0.2.0.tgz --verify-tag --title 'v0.2.0' --notes-file CHANGELOG.md
```

Check the GitHub Actions result and test an installation from the new tag before updating consuming apps. Do not move existing release tags. Publishing happens manually; CI only checks and packages the code.

## Optional npm publication

```sh
npm login
npm publish --access public
```

This requires an npm account with permission for the `@hamadawan` scope and any required two-factor authentication. npm name/scope availability has not been verified. GitHub publication does not publish to the npm registry.
