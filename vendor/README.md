# SDK alpha snapshot

`getvatly-sdk-0.3.0-alpha.1.tgz` is built from
`sandervanhooft/vatly-js` revision `e9db0913e42bc507eda896407a53d3e891268b0c`.
SHA256: `578ecb82e2050b1716241bc47187c5f73d63363c5ebebda2f29dd1739cb44f19`.

It is a local `pnpm pack` output, not an npm publication. Regenerate by checking
out that SDK revision, running `pnpm install --frozen-lockfile && pnpm build`,
then `pnpm pack --pack-destination /path/to/this/vendor` and updating the lockfile.
The package includes its MIT license. After registry publication, replace the
development tarball dependency with the corresponding registry version.
