# Publish v0.1.0 to GitHub

The package is prepared locally; it has not been published. GitHub authentication and initial publication were deferred by the owner. No npm account or registry publication is required for a GitHub dependency.

From this directory, after signing in with `gh auth login`:

```sh
npm ci
npm test
npm pack
# The prepared checkout is already a Git repository with an initial commit.
gh repo create hamadawan/google-drive-sync --public --source=. --remote=origin --push
git tag -a v0.1.0 -m 'Release v0.1.0'
git push origin v0.1.0
gh release create v0.1.0 hamadawan-google-drive-sync-0.1.0.tgz --title 'v0.1.0' --notes-file CHANGELOG.md
```

Review source, README, LICENSE, and the archive before publishing. The repository contains only the package, generic tests, and documentation; it does not contain either app's `.env`, OAuth IDs, databases, or user records. If you modify source before release, rebuild and commit the matching `dist/` files, then regenerate the archive.

After publication, run in **each app**:

```sh
npm install github:hamadawan/google-drive-sync#v0.1.0
npm run typecheck
npm test
```

The package-lock pins the resolved commit. Commit both manifests and the lockfile. Remove the obsolete `vendor/hamadawan-google-drive-sync-0.1.0.tgz` after the dependency has changed. App postinstall scripts copy the package's web authorization helper.

Future releases: update `package.json` and lockfile, build/test, update changelog, commit source and `dist/`, and tag/publish a new version. Do not move existing release tags.

Optional later npm publication:

```sh
npm login
npm publish --access public
```

This requires an npm account with permission for the `@hamadawan` scope and any required two-factor authentication. The package name is prepared; npm name/scope availability has not been verified.
