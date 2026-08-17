# Validation Record

Target candidate: **v1.1.1 for Microsoft Edge Add-ons**

Candidate date: 2026-08-17

This record separates the current local v1.1.1 candidate from the historical v1.1.0 GitHub release, the user-accepted v0.3.1 browser fix, and the historical v1.0.0 GitHub/Partner Center submission. GitHub publication, Partner Center submission, certification, and public Microsoft Edge Add-ons availability are separate states.

## v1.1.1 Candidate State

Version 1.1.1 is currently a local release candidate. It is **not recorded here as committed for release, tagged, published to GitHub Releases, submitted to Microsoft, certified, or live in Microsoft Edge Add-ons**.

The candidate corrects two status/lifecycle defects observed on Windows after the automatic fix had already succeeded. First, opening the toolbar action popup can temporarily give native focus to the popup rather than the underlying Edge window. The older popup path could therefore discard a valid SAP Report Center tab. Second, the popup's one-shot status request waited behind service-worker startup/recovery work and treated Edge's advisory `tab.status === "loading"` as stronger than an already-verified allowance or durable replay result. It could appear frozen, open late, and then tell the user to reopen the popup even while the Story had already rendered.

Candidate scope:

- resolve the popup and its explicit **Fix this report** action against Edge's last-focused normal window, even while the toolbar popup owns native focus;
- validate the active tab's URL locally against the existing exact SAP Report Center scope instead of relying on a filtered tab query;
- keep strict `focused: true` validation for unsolicited automatic recovery, so this correction does not broaden background refresh eligibility;
- render **Checking this report…** immediately and use bounded, non-overlapping live polling so the same popup follows state changes without a reopen;
- keep the read-only popup status lane independent of service-worker startup/recovery queues and return a bounded unavailable result when a browser API does not answer;
- share active popup status work, replace one stalled snapshot automatically, cap uncancellable browser status calls at two, and bound the exact-document continuation response to five seconds while preserving durable-commit precedence;
- report exact verified allowance or durable one-use continuation evidence ahead of Edge's advisory loading value;
- allow a safe supported loading tab to expose the manual fallback and to receive the same guarded one-time automatic recovery probe/refresh;
- observe the trusted IAS document for its lifetime, using mutation-scheduled checks so delayed hidden or activated exact structures are not lost after ten seconds, then stop observation/timers after the first report;
- retain the v1.1.0 lifecycle recovery, one-refresh guard, manual-request revalidation, bounded exact-pair allowance, and at-most-once continuation behavior; and
- keep **Open SAP help article** fixed to `https://userapps.support.sap.com/sap/support/knowledge/en/3039244` without appended data.

For this candidate, **Access fix applied** means either that the exact extension-owned browser setting is currently verified as effective for the active SuccessFactors site or that the extension durably recorded the local one-use continuation step for that tab. It is not evidence of network delivery, SAP authentication, authorization, or Story rendering.

### v1.1.1 Candidate Evidence

- Source commit: **PENDING — fill with the reviewed full commit SHA**
- Source verifier: **PASS**
- Full automated suite: **PASS — 138/138 tests with Node.js 24.19.0**
- ZIP: `release/story-reports-access-helper-for-sap-v1.1.1-microsoft-edge-addons.zip`
- ZIP byte size: **124,333 bytes**
- ZIP member count: **12**
- ZIP SHA-256: `b9c7bea01ae8cfe011fe6a5fc99c1c1ed4d1cd0c0a985d872bb725ecb23a59ae`
- Source-loaded Microsoft Edge acceptance: **PASS — all six smoke phases with Microsoft Edge 151.0.4129.86 on macOS 26.5.2 arm64**
- Exact-ZIP loaded Microsoft Edge acceptance: **PASS — all six smoke phases against the checksum-verified archive with Microsoft Edge 151.0.4129.86 on macOS 26.5.2 arm64**
- Live supported-SAP acceptance on Windows, including the real toolbar-popup focus transition: **PENDING**
- Annotated tag `v1.1.1`: **PENDING — do not create until exact acceptance is complete**
- GitHub Release URL and workflow run: **PENDING — not published**
- Microsoft Edge Add-ons v1.1.1 state: **PENDING — not submitted**
- Public Store version verification: **PENDING — do not mark live until the public listing offers v1.1.1**

Earlier v1.1.1 source/package results and the previously recorded `116,375`-byte / `2ae038…aa7` artifact predate the current dynamic-popup, advisory-loading, delayed-IAS, and bounded-resume changes. They are stale and are not evidence for this candidate. The verifier, 137-test suite, rebuilt package/checksum, source-loaded Edge smoke, and exact-ZIP Edge smoke above are current. Source commit identity, live Windows/SAP acceptance, tag, GitHub Release, workflow, Partner Center submission, and public Store verification remain pending until each stage has actually completed. Passing local and synthetic browser tests does not fill a live-SAP or publication field.

## Historical v1.1.0 GitHub Release And Microsoft State

Version 1.1.0 was published as an immutable GitHub tag and GitHub Release. It was **not submitted to Microsoft Edge Add-ons**. A v1.1.0 update was prepared in Partner Center but remained an unsent draft; the public Microsoft Edge Add-ons version remained v1.0.0.

- Release commit: `6df51839007536aff7b17f347bc1a39fccd5b61c`
- Annotated tag: `v1.1.0`, resolving to the release commit above
- GitHub Release: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/releases/tag/v1.1.0`
- GitHub Release workflow: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/actions/runs/32063678044`
- Release ZIP: `release/story-reports-access-helper-for-sap-v1.1.0-microsoft-edge-addons.zip`
- ZIP size: `115,542 bytes`
- ZIP members: `12`
- ZIP SHA-256: `52b44b251fc557dcfc7e360fa1788923b197efb44b1076512ba8fd853e4a56e1`
- Source verifier: **PASS**
- Full automated suite: **PASS — 118/118 tests with Node.js 24.19.0**
- Exact-ZIP loaded Microsoft Edge acceptance: **PASS — all six smoke phases with Microsoft Edge 151.0.4129.86 on macOS 26.5.2 arm64**
- Partner Center v1.1.0 update: **unsent draft**
- Public Microsoft Edge Add-ons version at this boundary: **v1.0.0**

The later Windows test established that v1.1.0 could transparently repair the report while its popup still displayed the wrong status. The v1.1.1 candidate addresses that popup/manual-context defect without changing the immutable v1.1.0 tag, release, or package.

## Historical Confirmed Live Acceptance Of The Core Fix

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

This historical artifact is superseded and must not be used for a Store submission.

## Historical v1.0.0 Release Scope

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

## Historical v1.0.0 Source Validation

The final v1.0.0 source verifier passed the Manifest V3 contract, synchronized version, exact required permissions, reviewed SAP website families, exact Report Center scope, exact IAS-primary/SuccessFactors-secondary rule construction, protected bounded ledger, hard expiry, one-refresh recovery, at-most-once continuation, legacy-control deletion, compact popup, fixed SAP KBA action, prohibited-API checks, and JavaScript syntax checks.

All **100/100** executable tests passed with Node.js 24.19.0. The suite covers runtime lifecycle and race behavior, trust-boundary rejection, storage and policy failure, deterministic Edge packaging, Store-artwork dimensions and customer-data exclusions, popup accessibility and fixed help action, Edge publisher disclosure/redaction, and Edge-only CI/release workflow invariants.

The same final **100/100** suite passed in **20 consecutive runs** after the exact-ZIP smoke, providing repeatability evidence for the lifecycle and race-sensitive coverage.

## Historical v1.0.0 Exact Artifact

- File: `release/story-reports-access-helper-for-sap-v1.0.0-microsoft-edge-addons.zip`
- Size: `94,258 bytes`
- Members: `12`
- SHA-256: `1577deb996f6679fe570250b621238f78df7fb6e67dacb4aff934c67cc2f9f4e`
- Source identity: the commit resolved by the annotated tag `v1.0.0`
- Annotated tag: `v1.0.0` on the release commit represented by this record

`scripts/verify-edge-package.mjs` verified the archive root, exact package members, packaged manifest/version, byte-for-byte source correspondence, prohibited-file exclusions, and `release/SHA256SUMS.txt`.

## Historical v1.0.0 Exact-ZIP Microsoft Edge Acceptance

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

## Historical v1.0.0 GitHub Publication Evidence

- Public repository: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP`
- Release: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/releases/tag/v1.0.0`
- Release commit: `216dffc189b99e65558558251e6fbf492a224ac0`
- Annotated tag: `v1.0.0`, resolving to the release commit above
- CI run for the release commit: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/actions/runs/31956797117`
- GitHub Release workflow: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/actions/runs/31956876222`
- Release ZIP and checksum were downloaded from the public Release and compared byte-for-byte with the exact locally accepted artifact.
- Active repository rulesets require pull requests and the `verify` CI check for `main`, and prevent deletion or non-fast-forward updates of `v*` release tags.
- GitHub private vulnerability reporting is enabled.

## Historical v1.0.0 Microsoft Edge Add-ons Submission Evidence

Submitted through Microsoft Partner Center on **2026-08-16 at approximately 18:16 UTC**.

- Product: `Story Reports Access Helper for SAP`
- Version: `1.0.0`
- Product ID: `7388eb01-8627-440f-aaf6-3ca300362ff9`
- Store ID: `0RDCKFT1CDT4`
- CRX ID: `bcmdpclnmpflaollgfjamioigkbpdmdc`
- Partner Center state recorded on 2026-08-16: **In review**
- Visibility: **Public**
- Category: **Productivity**
- Language: **English (United States)**
- Markets: all 241 currently offered markets, including future markets
- Public Store URL: not yet available; Partner Center reports that it will be assigned after publication

Partner Center verified the exact ZIP identified above and displayed version `1.0.0` as complete. It issued one non-blocking package warning that the optional manifest `short_name` value `Story Access Helper` exceeds the 12-character recommendation. The full product name, package validation, and submission were accepted; no package bytes were changed after the immutable GitHub Release.

The submitted listing includes the original 300 x 300 logo, both promotional tiles, four synthetic 1280 x 800 screenshots, the public repository and privacy URLs, conservative website-content data-use disclosure, and certification notes that contain no credentials, customer data, tenant details, reports, cookies, or authentication payloads.

At submission time, Partner Center stated that Microsoft was reviewing the submission and expected to respond within seven business days. **In review was not live.** No later v1.0.0 certification or public-availability result is asserted by this historical record.

## Historical v1.0.0 Verification Scope

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

## v1.1.1 Candidate Publication Gates

- Commit the reviewed v1.1.1 source without ignored local QA or historical release artifacts.
- Complete the current [production acceptance plan](PILOT_TEST.md) against the exact checksum-verified v1.1.1 ZIP, including installation, same-build re-enable/startup, tab activation, URL-change/page-completion, immediate and live popup updates, bounded status failure/recovery, advisory-loading precedence, delayed IAS structures, the real Windows toolbar-popup focus transition, manual result-before-refresh, the 30-second repeat guard, and live Story outcomes.
- Fill every pending v1.1.1 evidence field above before tagging or uploading.
- Create the annotated `v1.1.1` tag on the reviewed public commit and confirm that the tag resolves to that commit.
- Confirm the public repository contains no customer or employer names, branding, tenant URLs, accounts, report data, HR data, HAR files, screenshots, or secrets.
- Confirm all `RobinMJD/Story-Reports-Access-Helper-for-SAP` support, privacy, security, and Issues URLs resolve publicly.
- Verify every Store asset is original fictional artwork with the documented dimensions.
- Complete Partner Center publisher/trader, permission, privacy, remote-code, availability, listing, and certification fields.
- Publish the immutable GitHub Release from that tag and verify that its ZIP/checksum match the filled v1.1.1 values above.
- Submit those exact verified v1.1.1 bytes to the existing Microsoft Edge Add-ons product only after the immutable public commit/tag/Release are established and an update is explicitly authorized.
- Record Partner Center submission and certification as non-live states until the public Microsoft Edge Add-ons listing offers v1.1.1.

Customer-configured IAS custom domains remain unsupported in this public build. Supporting them safely requires a separately validated exact allowlist or enterprise policy; broad website access and console/debugger-based hostname trust are deliberately excluded.
