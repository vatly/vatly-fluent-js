# Unreleased SDK build for development

`getvatly-sdk-0.3.0-alpha.5-ebb3873.tgz` is `pnpm pack` of `vatly/vatly-api-js`
at revision `ebb38737f5587667b274b43f0023d57460b135d9` (vatly/vatly-api-js#15),
which adds `VatlyClient.addVersionString()`. The tests need it to check the
User-Agent chain.

It is a development dependency only and is not published. Once that SDK change
is on npm, install the SDK from the registry again and delete this directory.
