# SDK alpha snapshot

`getvatly-sdk-0.3.0-alpha.1.tgz` is built from
`vatly/vatly-api-js` revision `200a733dea7c7cffc86f7cb9f7d80bbe911edcac`.
SHA256: `4e5d1ec5d3a4a5e46418a70d5e5a3cbedd5d16d533754e82fe875bb6c335f9a3`.

It is a local `pnpm pack` output, not an npm publication. Regenerate by checking
out that SDK revision, running `pnpm install --frozen-lockfile && pnpm build`,
then `pnpm pack --pack-destination /path/to/this/vendor` and updating the lockfile.
The package includes its MIT license. After registry publication, replace the
development tarball dependency with the corresponding registry version.
