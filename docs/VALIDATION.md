# Validation Record

Target release: **v1.0.0 for Microsoft Edge Add-ons**

Date: 2026-08-16

This record separates the user-accepted v0.3.1 browser fix from the final v1.0.0 release package. GitHub publication, Partner Center submission, certification, and public Microsoft Edge Add-ons availability are separate states and are recorded independently below.

## Confirmed Live Acceptance Of The Core Fix

The user completed a live Microsoft Edge acceptance test with v0.3.1:

1. The user opened the affected Story page before installing the extension and confirmed that it failed.
2. The user installed and enabled the extension while that page remained open.
3. The extension immediately refreshed the eligible active Story page once.
4. The user selected the Story Report.
5. The report loaded immediately.

This directly validates the end-to-end outcome that motivated the pre-existing-page recovery: the extension handled the missing retroactive content-script lifecycle, the subsequent SAP browser-storage path completed, and a previously failing live Story rendered in that signed-in Edge profile.

It does not establish universal tenant, device, browser-policy, custom-domain, or future SAP compatibility. No customer name, tenant-specific hostname, account, report name, report content, employee data, cookie, form value, credential, or authentication payload is included in this record.

## v0.3.1 Exact-Package Evidence

The exact v0.3.1 ZIP was loaded into a temporary normal Microsoft Edge profile on macOS arm64 with Microsoft Edge `151.0.4129.86`. The profile began with third-party cookies blocked. A local HTTPS fixture used supported SAP host families, a nested analytics document, and a hidden exact IAS interstitial. All form values were synthetic, and the smoke test discarded each POST body without parsing it.

Passed checks included:

- a Story execution document and IAS frame loaded before the current extension worker, reproducing the missing-retroactive-content-script condition;
- update/reload did not immediately disrupt the active Story;
- returning to that exact tab caused one ordinary, cache-preserving, route-preserving refresh;
- the new build marker completed the pending-to-terminal recovery handoff and retained the one-refresh guard;
- one exact temporary allowance became effective for the validated IAS/SuccessFactors pair;
- the durable continuation record existed before one native IAS POST;
- exactly one POST occurred in the same IAS frame, with no helper tab, new tab, duplicate request, cache bypass, or delayed loop;
- refocusing the Story caused no second refresh or POST;
- top-level SAP helper, unapproved ancestor, stale document, and malformed interstitial cases remained inert; and
- extension-owned rules expired/cleaned up without changing unrelated settings.

Historical v0.3.1 local artifact (superseded and never intended for the v1 Edge submission):

- Size: `107,238 bytes`
- Members: `12`
- SHA-256: `7db2c31a348a417ddc95574a9c3c3cb07117531bf38909c46dc4e77d91387f20`

This historical artifact is superseded and must not be submitted as v1.0.0.

## v1.0.0 Release Scope

Version 1.0.0 preserves the accepted automatic fix while presenting a production end-user experience:

- one simple popup status card;
- no tenant, company, account, hostname, URL, mode, pause, clear, or resume control;
- one fixed **Open SAP help article** button for SAP KBA 3039244;
- startup migration that removes the legacy v0.3.x paused marker so an upgrade cannot remain unintentionally inactive;
- exact standard-SAP host-family support with no customer-specific data or hardcoded instance;
- one safe refresh for an eligible active Story document that predates installation/re-enablement;
- exact IAS-primary/SuccessFactors-secondary temporary access with a hard, non-renewing 60-minute lifetime;
- document-bound, at-most-once SAP continuation; and
- automatic alarm/startup cleanup with no telemetry, remote code, or developer backend.

The SAP help action must open exactly:

`https://userapps.support.sap.com/sap/support/knowledge/en/3039244`

It must not append a tenant, account, report, query, fragment, or extension-state value.

## v1.0.0 Source Validation

The final v1.0.0 source verifier passed the Manifest V3 contract, synchronized version, exact required permissions, reviewed SAP website families, exact Report Center scope, exact IAS-primary/SuccessFactors-secondary rule construction, protected bounded ledger, hard expiry, one-refresh recovery, at-most-once continuation, legacy-control deletion, compact popup, fixed SAP KBA action, prohibited-API checks, and JavaScript syntax checks.

All **100/100** executable tests passed with Node.js 24.19.0. The suite covers runtime lifecycle and race behavior, trust-boundary rejection, storage and policy failure, deterministic Edge packaging, Store-artwork dimensions and customer-data exclusions, popup accessibility and fixed help action, Edge publisher disclosure/redaction, and Edge-only CI/release workflow invariants.

The same final **100/100** suite passed in **20 consecutive runs** after the exact-ZIP smoke, providing repeatability evidence for the lifecycle and race-sensitive coverage.

## v1.0.0 Exact Artifact

- File: `release/story-reports-access-helper-for-sap-v1.0.0-microsoft-edge-addons.zip`
- Size: `94,258 bytes`
- Members: `12`
- SHA-256: `1577deb996f6679fe570250b621238f78df7fb6e67dacb4aff934c67cc2f9f4e`
- Source identity: the commit resolved by the annotated tag `v1.0.0`
- Annotated tag: `v1.0.0` on the release commit represented by this record

`scripts/verify-edge-package.mjs` verified the archive root, exact package members, packaged manifest/version, byte-for-byte source correspondence, prohibited-file exclusions, and `release/SHA256SUMS.txt`.

## v1.0.0 Exact-ZIP Microsoft Edge Acceptance

The exact ZIP identified above passed the loaded-browser smoke on Microsoft Edge `151.0.4129.86` for macOS arm64.

Passed checks included:

- deletion of the exact legacy v0.3.x pause marker before normal startup reconciliation;
- the compact four-state popup with no configuration or pause/reset UI;
- explicit user navigation to exactly SAP KBA 3039244, without added tenant, account, report, query, fragment, or extension-state data;
- one ordinary cache-preserving recovery refresh for an exact Story document that predates extension loading;
- no second refresh, background-tab refresh, route change, helper-tab loop, or duplicate continuation;
- inert handling of a top-level SAP helper, unapproved ancestor, stale document, and malformed interstitial;
- one exact IAS-primary/SuccessFactors-secondary cookie allowance with the hard one-hour lifetime;
- durable at-most-once native IAS continuation; and
- restart persistence and automatic allowance reconciliation without a legacy control state.

This verifies the packaged browser mechanics in the tested Edge/platform combination. The separate live acceptance above verifies the downstream Story outcome for the accepted v0.3.1 core flow. It does not claim that every tenant or supported host family has been live-tested.

The exact v1.0.0 ZIP is the production artifact used by the public GitHub Release and Microsoft Partner Center submission recorded below. A submitted item in review is not a certified or live Microsoft Edge Add-ons listing.

## GitHub Publication Evidence

- Public repository: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP`
- Release: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/releases/tag/v1.0.0`
- Release commit: `216dffc189b99e65558558251e6fbf492a224ac0`
- Annotated tag: `v1.0.0`, resolving to the release commit above
- CI run for the release commit: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/actions/runs/31956797117`
- GitHub Release workflow: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/actions/runs/31956876222`
- Release ZIP and checksum were downloaded from the public Release and compared byte-for-byte with the exact locally accepted artifact.
- Active repository rulesets require pull requests and the `verify` CI check for `main`, and prevent deletion or non-fast-forward updates of `v*` release tags.
- GitHub private vulnerability reporting is enabled.

## Microsoft Edge Add-ons Submission Evidence

Submitted through Microsoft Partner Center on **2026-08-16 at approximately 18:16 UTC**.

- Product: `Story Reports Access Helper for SAP`
- Version: `1.0.0`
- Product ID: `7388eb01-8627-440f-aaf6-3ca300362ff9`
- Store ID: `0RDCKFT1CDT4`
- CRX ID: `bcmdpclnmpflaollgfjamioigkbpdmdc`
- Current Partner Center state: **In review**
- Visibility: **Public**
- Category: **Productivity**
- Language: **English (United States)**
- Markets: all 241 currently offered markets, including future markets
- Public Store URL: not yet available; Partner Center reports that it will be assigned after publication

Partner Center verified the exact ZIP identified above and displayed version `1.0.0` as complete. It issued one non-blocking package warning that the optional manifest `short_name` value `Story Access Helper` exceeds the 12-character recommendation. The full product name, package validation, and submission were accepted; no package bytes were changed after the immutable GitHub Release.

The submitted listing includes the original 300 x 300 logo, both promotional tiles, four synthetic 1280 x 800 screenshots, the public repository and privacy URLs, conservative website-content data-use disclosure, and certification notes that contain no credentials, customer data, tenant details, reports, cookies, or authentication payloads.

Partner Center states that Microsoft is reviewing the submission and expects to respond within seven business days. **In review is not live.** Live availability must be verified only after the public Store URL offers version 1.0.0.

## Required v1.0.0 Verification

- Manifest V3 contract and version alignment across all version consumers.
- Exact required permissions: `storage`, `alarms`, and `contentSettings` only.
- Reviewed standard SAP IAS and SuccessFactors website-access families only.
- Exact Report Center activation-script path and Story execution route.
- No Cookies API, `tabs` permission, history, `webRequest`, `scripting`, `management`, `webNavigation`, debugger, arbitrary broad host, or `<all_urls>` access.
- Exact HTTPS `:443` IAS-primary/SuccessFactors-secondary rule construction and post-write verification.
- Protected bounded cleanup ledger and hard non-renewing 60-minute expiry.
- Safe one-refresh recovery across install, re-enable, activation, focus/navigation races, lost marker handoff, tab closure, and service-worker restart.
- No duplicate refresh or continuation after durable attempt commit or message-channel loss.
- Legacy pause state migrates to active and no popup/runtime pause action remains.
- SAP help button opens only the fixed KBA URL on explicit user action.
- Popup, support copy, privacy declarations, screenshots, and Store listing match the packaged behavior.
- Exact package members and bytes match reviewed source; checksum file is consistent.
- Loaded Microsoft Edge acceptance uses the exact final ZIP, not an unpackaged source folder.

## Publication Gates

- Create the public repository and commit the reviewed source without ignored local QA or historical release artifacts.
- Create the annotated `v1.0.0` tag on the reviewed public commit and confirm that the tag resolves to that commit.
- Confirm the public repository contains no customer or employer names, branding, tenant URLs, accounts, report data, HR data, HAR files, screenshots, or secrets.
- Confirm all `RobinMJD/Story-Reports-Access-Helper-for-SAP` support, privacy, security, and Issues URLs resolve publicly.
- Verify every Store asset is original fictional artwork with the documented dimensions.
- Complete Partner Center publisher/trader, permission, privacy, remote-code, availability, listing, and certification fields.
- Publish the immutable GitHub Release from that tag and verify that its ZIP/checksum match the values above.
- Submit those exact verified bytes to Microsoft Edge Add-ons only after the immutable public commit/tag/Release are established.
- Record Partner Center submission and certification as non-live states until the public Microsoft Edge Add-ons listing offers v1.0.0.

Customer-configured IAS custom domains remain unsupported in this public build. Supporting them safely requires a separately validated exact allowlist or enterprise policy; broad website access and console/debugger-based hostname trust are deliberately excluded.
