# Microsoft Edge Release Runbook

This project is distributed through Microsoft Edge Add-ons only. Do not create or submit a Chrome Web Store listing.

Build one verified Microsoft Edge ZIP from one reviewed commit. The exact bytes tested locally, attached to the GitHub Release, and uploaded to Microsoft Partner Center must match. A successful upload or certification start is not a live deployment.

## Public Repository

The canonical public repository is:

`https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP`

Before submission, confirm that these unauthenticated URLs resolve:

- repository homepage;
- `README.md`;
- `PRIVACY.md`;
- `SECURITY.md`;
- `SUPPORT.md`; and
- public Issues page.

Protect `main` with reviewed pull requests and required CI. Add a `v*` tag ruleset that restricts creation and blocks update/deletion. Keep release and Partner Center credentials out of the repository and logs.

Enable GitHub private vulnerability reporting so `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/security/advisories/new` provides a non-public disclosure path.

## Every Code Release

1. Update `manifest.json`, `package.json`, and `package-lock.json` together.
2. Reconcile README, privacy, security, support, Store listing, production acceptance, certification notes, tests, and validation evidence with the exact behavior and permission set.
3. Run:

   ```bash
   npm ci
   npm audit --audit-level=low
   npm run verify
   npm run package:edge
   npm run verify:edge-package
   ```

4. Complete [PILOT_TEST.md](PILOT_TEST.md) in current Stable Microsoft Edge using the exact ZIP. Record the candidate hash and clearly separate local continuation scheduling, observed network delivery, SAP authentication, and Story rendering.
5. Confirm the public support, privacy, security, and repository URLs; fictional Store media; certification notes; publisher/trader declarations; and trademark wording.
6. Commit and push through the approved branch workflow; wait for CI on the exact commit.
7. Create and push an annotated `vX.Y.Z` tag matching the manifest version.
8. Verify the GitHub Release workflow:
   - the exact tag belongs to `main`;
   - verification records one full commit SHA and later checkouts use that immutable SHA;
   - source checks, tests, dependency audit, loaded-Edge acceptance, and package verification pass;
   - the GitHub Release contains exactly one Edge ZIP and its checksum; and
   - existing release assets are compared byte-for-byte and never silently overwritten with different content.
9. Upload that exact verified ZIP to Microsoft Partner Center and complete the current submission flow.
10. Record Partner Center state accurately and verify live availability only through the public Microsoft Edge Add-ons listing after certification.

The versioned artifact name is:

```text
release/story-reports-access-helper-for-sap-vX.Y.Z-microsoft-edge-addons.zip
```

## Microsoft Edge Add-ons Manual Submission

Microsoft's publication flow is managed in Partner Center and may change. At submission time, follow the current official [Microsoft Edge publication guide](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension) and recheck the [developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies).

### Package

1. For a first release, create a new extension product in the Edge workspace; for an update, use the existing product.
2. Upload the exact `vX.Y.Z` ZIP recorded as the current candidate in `docs/VALIDATION.md`.
3. Stop if Partner Center reports a manifest, permission, package, or policy error. Do not patch the ZIP manually in a temporary directory; fix source, rebuild, reverify, and repeat acceptance.

### Availability And Properties

- Visibility: Public, unless the owner deliberately chooses a narrower initial rollout.
- Category: Productivity.
- Website: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP`
- Support: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/blob/main/SUPPORT.md`
- Mature content: No.
- Markets: choose deliberately in Partner Center; record the decision in private release evidence.

Do not include customer, employer, tenant, account, or report information in any public field.

### Privacy

Copy the single-purpose, permission justifications, remote-code declaration, and data-use text from [STORE_LISTING.md](STORE_LISTING.md). Use:

`https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/blob/main/PRIVACY.md`

The privacy policy must already be publicly accessible and current. Recheck Partner Center's current checkbox wording instead of assuming that an older form remains unchanged.

### English Store Listing

Use the name, short description, detailed description, search terms, and tracked `store/assets/` files from [STORE_LISTING.md](STORE_LISTING.md). Microsoft currently accepts up to six screenshots at either 640 × 480 or 1280 × 800; this project provides four 1280 × 800 screenshots plus the recommended 300 × 300 logo and optional 440 × 280 and 1400 × 560 promotional tiles.

Do not use a customer screenshot or SAP-copied artwork. The tracked assets must be original project artwork with fictional interface content.

### Certification Notes

Use the certification sequence from [STORE_LISTING.md](STORE_LISTING.md). It must explain:

- the single SAP Story Reports purpose;
- the required broad `contentSettings` warning and exact-pair restriction;
- the hard non-renewing 60-minute expiry;
- the safe one-refresh recovery for an active Report Center page after install, a same-build service-worker start or re-enable, tab activation, URL change, or page completion;
- the contextual popup check and bounded **Fix this report** fallback, including its result-before-refresh behavior, 30-second repeat guard, and no cookie clearing;
- at-most-once SAP continuation;
- the standard SAP host-family boundary and custom-domain exclusion;
- the fixed SAP KBA 3039244 help link;
- no cookies, credentials, form values, report data, telemetry, or remote code; and
- the distinction between extension preparation and downstream SAP/report success.

Never include live credentials, a confidential tenant, report names, employee data, a raw HAR, cookies, tokens, SAML, RelayState, or CSRF values.

### Submit

Review every Partner Center page, then submit for certification. Capture only non-sensitive evidence of:

- product ID;
- package version and Partner Center validation result;
- submission time;
- current certification state; and
- eventual public listing URL and live version.

Do not describe `Draft`, `In certification`, or `Certification passed` as live unless the public listing itself offers the expected version.

## Optional Edge Update API

The Microsoft Edge Add-ons Update REST API can update an existing product package after first publication; it cannot create the product or replace the initial manual listing work. If automated later, keep credentials in a protected GitHub environment named `microsoft-edge-add-ons`:

- `EDGE_ADDONS_CLIENT_ID`
- `EDGE_ADDONS_API_KEY`
- `EDGE_ADDONS_PRODUCT_ID`

Require an independent environment reviewer and restrict deployment to the protected release-tag policy. The publisher must download and verify the immutable GitHub Release ZIP instead of rebuilding it. API keys must never be printed or committed.

## Release-State Language

- **Local candidate:** built and tested locally; not submitted.
- **GitHub Release published:** immutable public artifact exists; not a Store deployment.
- **Partner Center draft:** product/listing work exists but has not been submitted.
- **In certification:** submitted to Microsoft; not live.
- **Certification passed:** Microsoft accepted the submission; verify public propagation separately.
- **Live in Microsoft Edge Add-ons:** the public listing offers the expected version.

A green CI or publication job proves only the stage it actually completed.

## Retry Rules

- Serialize releases per tag.
- Retry only an existing immutable tag and exact verified ZIP.
- Compare existing GitHub assets byte-for-byte and refuse a differing overwrite.
- Never rebuild, edit, or silently change bytes during an upload-only retry.
- If Store metadata or package behavior changes, create a new reviewed version.
