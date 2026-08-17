# Microsoft Edge Add-ons Listing Source

This file is the source of truth for the English Microsoft Edge Add-ons listing, Privacy page, Properties page, and certification notes for version 1.1.1. Review it against the exact upload ZIP before submission.

**Release-state boundary:** prepared listing copy is not proof of Partner Center submission, certification, approval, or live Microsoft Edge Add-ons availability.

## Listing Identity

**Name**

`Story Reports Access Helper for SAP`

**Manifest/short description**

`Helps supported SAP SuccessFactors Story Reports load when browser storage access is blocked.`

**Category**

`Productivity`

**Language**

`English (United States)`

**Pricing**

`Free`

**Search terms**

- `SAP SuccessFactors`
- `Story Reports`
- `People Analytics`
- `blank report`
- `browser access`

## Detailed Description

Some SAP SuccessFactors Story Reports can remain blank when Microsoft Edge prevents the embedded SAP sign-in service from using its existing sign-in state. Story Reports Access Helper handles the compatible browser step automatically.

Install the extension once, then open Story Reports normally. There is no tenant, company, account, or URL to configure.

What it does:

- Detects SAP's exact storage-access flow only inside a supported SuccessFactors Story Report.
- Prepares a temporary browser allowance only for the matching SAP Identity Authentication and SuccessFactors sites.
- Verifies that exact setting before allowing the already-started SAP sign-in to continue once.
- Detects an older active Report Center document after installation, a same-build service-worker start (including re-enablement), tab activation, page completion, or same-tab SAP navigation, and refreshes that exact page once when its current extension marker is missing, including when Edge still labels a safe matching tab as loading.
- Opens immediately on **Checking this report…**, uses bounded live checks, and updates the same popup as the page or fix state changes.
- Provides **Fix this report** when a safe retry is applicable, including a supported page that remains loading, with a fail-closed fallback if status cannot be confirmed.
- Shows whether automatic help is ready, the extension is working, the page is prepared, or the browser fix was applied; users are never instructed to reopen the popup for an update.
- Opens SAP KBA 3039244 from a dedicated help button when additional guidance is needed.
- Removes extension-owned temporary allowances automatically after a hard, non-renewing maximum of 60 minutes.

The extension does not read cookie values, credentials, passwords, MFA codes, SAP authentication form values, report names, report identifiers, report content, employee data, or browsing history. It has no telemetry, advertising, remote code, remote configuration, or developer backend.

Automatic support covers tenant subdomains under reviewed standard SAP-hosted SuccessFactors and Identity Authentication parent domains. Customer-configured custom hostnames require a separately validated exact allowlist or enterprise browser policy and are not silently trusted by this public build.

Microsoft Edge policy, Strict Tracking Prevention, an expired SAP session, missing report permission, and SAP-side changes remain authoritative. If the exact setting cannot be established, the helper stops without weakening a broader browser setting or entering a retry loop.

SAP describes the related blank-screen/browser-settings symptom in KBA 3039244, “Unable to access Story Reports due to Browser Settings - MS Edge & Google Chrome.” The popup opens the public SAP preview directly without adding tenant, account, report, or tracking values to the URL.

Story Reports Access Helper is an independent compatibility project. It is not an SAP product and is not affiliated with, sponsored by, or endorsed by SAP or Microsoft.

## Public URLs

- Website: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP`
- Support: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/blob/main/SUPPORT.md`
- Issue tracker: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/issues`
- Privacy policy: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/blob/main/PRIVACY.md`
- Security model: `https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/blob/main/SECURITY.md`
- SAP KBA: `https://userapps.support.sap.com/sap/support/knowledge/en/3039244`

All GitHub URLs must resolve publicly before the Partner Center submission is sent for certification.

## Partner Center Privacy Page

### Single purpose

Prepare the exact temporary browser-storage context required by SAP Identity Authentication when it is embedded in a supported SAP SuccessFactors Story Report, then allow that already-started SAP sign-in flow to continue at most once.

### Permission justifications

**`contentSettings` — required**

Microsoft Edge displays a broad warning because this API can control several categories of website settings. The extension uses only `chrome.contentSettings.cookies`, and only after validating a live SAP IAS-in-SuccessFactors pair. Every rule has the exact IAS HTTPS/default-port request/cookie origin as primary, the exact matching SuccessFactors HTTPS/default-port top-level origin as secondary, regular-profile scope, and a hard non-renewing maximum lifetime of 60 minutes. The effective setting is read back and verified. No cookie value is read or changed, and no wildcard-parent, arbitrary-site, or `<all_urls>` rule is created.

**`storage` — required**

Holds bounded local workflow and automatic-cleanup metadata. Session state contains browser identifiers, validated origins, timestamps, status codes, opaque one-use continuation identifiers, and a one-refresh record that contains only tab ID, build version, state, and timestamp. Trusted local storage holds one current extension build/version marker, used only to distinguish a same-build service-worker start from a version transition, plus at most twenty validated origin pairs, their exact HTTPS patterns, and creation/expiry timestamps. Nothing is synchronized or sent to the developer.

**`alarms` — required**

Removes extension-owned temporary allowances at expiry and reconciles cleanup after service-worker suspension or browser restart.

**Website access — standard SAP Identity Authentication host families**

The IAS content script is limited to tenant subdomains under:

- `accounts.ondemand.com`
- `accounts400.ondemand.com`
- `accounts.cloud.sap`
- `accounts400.cloud.sap`
- `accounts.sapcloud.cn`

It proceeds only when the browser-provided top ancestor belongs to a reviewed standard SuccessFactors host family. It checks fixed SAP storage-access element identifiers, containment, read-only Storage Access API state, and safe form structure and field names/types. Its mutation-driven observer remains for the IAS document lifetime so an exact structure that appears after a slow load can be detected; it does not poll DOM values and stops its observer and timers after the first report. It never reads form values.

**Website access — standard SAP SuccessFactors host families**

The extension processes only a matching active tab address and a DOM-free build/protocol marker on the exact Report Center path. It evaluates that path after installation, on a same-build service-worker start (including re-enablement), on tab activation, and on Microsoft Edge URL-change or page-completion events. If that Report Center document predates extension loading, or the user reaches it through same-tab SAP navigation, one session-only write-ahead record permits one ordinary cache-preserving refresh. A safe matching tab can be probed and refreshed while Edge still reports it as loading. Background and unrelated tabs are untouched, and the automatic refresh does not loop. A version transition records the new build but skips the immediate generic startup scan so it does not disrupt an older exact-document continuation.

The popup renders a local checking state immediately and requests only a contextual status and capability result. Bounded, non-overlapping polling updates that same popup while it stays open and shares active browser work. One stalled status snapshot can be replaced automatically, while a strict two-snapshot cap prevents an unavailable, uncancellable browser API from accumulating requests. Popup-originated checks resolve the active tab from Edge's last-focused normal window so the toolbar popup taking native focus does not discard the underlying SAP page; automatic background recovery keeps its stricter focused-window gate. Durable replay evidence or a verified effective exact allowance takes priority over Edge's advisory loading state. **Fix this report** is hidden when the page is unsupported, prepared, working, or already fixed, and can be offered when a safe supported page remains loading and can be retried. If status cannot be confirmed, the popup may show the fallback, but the service worker still validates the active supported Report Center page and fails closed when it cannot prove the boundary. An accepted request is durably recorded, its result is returned for display, and then at most one ordinary cache-preserving refresh occurs. A 30-second repeat guard prevents rapid repeated refreshes. The exact-document continuation response also has a five-second fail-closed deadline; durable commit evidence remains authoritative and no ambiguous attempt is retried. The action does not clear cookies or unrelated settings. The extension does not read the page title, report list, report DOM, report identifiers, or report contents.

The reviewed SuccessFactors families include `successfactors.com`, `successfactors.eu`, `successfactors.cn`, `sapsf.com`, `sapsf.eu`, `sapsf.cn`, `hr.cloud.sap`, and `sapcloud.cn`. This is a code-level host-family boundary, not a claim that every tenant in every family has been live-tested.

### Remote code

`No.` All executable code is included in the extension package. There is no remotely hosted code, dynamic code loading, remote configuration, or developer-operated service.

### Data-use declaration

The extension locally processes limited current-page and website context only for its disclosed single purpose. It does not collect or transmit personal data to the developer.

Select **Website content** in Partner Center to conservatively disclose the local inspection of fixed SAP storage-access structure and browser-provided page context. Leave the other user-data categories unselected. This disclosure does not mean that website content is transmitted: the extension reads no page-content values and sends no user data to the developer or a developer-operated service.

It does not read or collect cookie values, credentials, authentication information, report data, employee data, communications, location, financial, payment, or health information. It does not sell, transfer, profile, advertise against, or use data for creditworthiness or any unrelated purpose.

SAP's existing sign-in form is submitted directly by the browser to its existing same-origin SAP endpoint after the durable one-use gate. The extension does not read or reconstruct the form values. The optional help action opens a fixed SAP KBA URL without adding extension data.

Partner Center checkboxes and certifications must be reviewed against the current form wording at submission time. Do not declare collection of authentication information: the extension explicitly does not access passwords, cookies, tokens, SAML payloads, or authentication secrets.

### Privacy-policy URL

`https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/blob/main/PRIVACY.md`

## Store Artwork

Upload the tracked files from `store/assets/`:

- Extension logo: `store-icon-300.png` — 300 × 300
- Small promotional tile: `small-promo-440x280.png` — 440 × 280
- Large promotional tile: `large-promo-1400x560.png` — 1400 × 560
- Screenshot 1: `screenshot-01-automatic-fix-1280x800.png` — 1280 × 800
- Screenshot 2: `screenshot-02-simple-status-1280x800.png` — 1280 × 800
- Screenshot 3: `screenshot-03-built-in-help-1280x800.png` — 1280 × 800
- Screenshot 4: `screenshot-04-private-by-design-1280x800.png` — 1280 × 800

Use these files unchanged. They are fictional product artwork and must contain no customer name, customer branding, tenant URL, account, report name, report contents, employee data, or authentication material.

## Certification Notes

Story Reports Access Helper for SAP has one narrow purpose: prepare the exact temporary browser-storage context required when SAP Identity Authentication is embedded in a supported SAP SuccessFactors Story Report.

No customer, tenant, company, account, or report input is required. A real supported SAP test environment may be needed to exercise the complete path.

Suggested review sequence:

1. Install the exact v1.1.1 package in a normal current Microsoft Edge profile and review the required `contentSettings` and standard-SAP website-access permissions.
2. Open a supported SuccessFactors Story Report that reaches SAP's IAS storage-access interstitial.
3. Confirm that the extension creates and verifies only one exact IAS-primary/SuccessFactors-secondary HTTPS/default-port cookie allowance, without reading cookie or SAP form values.
4. Confirm that the same IAS document continues at most once only after a durable document-bound commit.
5. Open Report Center before installing or enabling the extension. Confirm that the active supported page receives at most one ordinary refresh whether it is on Report Center home, is still loading, or later changes route through same-tab SAP navigation. Repeat for a same-build service-worker start, tab activation, URL change, and page completion. Confirm that a version transition skips the immediate generic startup scan.
6. Activate the same page again and confirm no automatic second refresh or duplicate IAS continuation occurs.
7. Open the popup and confirm **Checking this report…** appears immediately. Confirm that the underlying active Report Center tab remains the contextual target while the toolbar popup owns native focus. Keep it open and confirm bounded live polling updates loading, prepared, working, fixed, and unavailable states without asking for a reopen. Confirm verified allowance or durable replay evidence reports **Access fix applied** even while Edge labels the tab as loading. Confirm **Fix this report** is hidden on unsupported, prepared, working, and fixed states, but can be offered for a safe supported loading tab; if status is unavailable, confirm the displayed fallback still fails closed unless background validation succeeds.
8. With a supported Report Center page active and no continuation in progress, select **Fix this report**. Confirm that its result appears before one normal refresh, no cookie clearing or unrelated-tab action occurs, and a repeat inside 30 seconds is refused.
9. Delay insertion of a valid hidden IAS structure beyond 30 seconds and activation of another valid structure beyond 15 seconds. Confirm each is detected once without DOM polling and that observation/timers stop after reporting.
10. Confirm that malformed pages, unsupported hosts, private windows, changed documents, ineffective settings, and policy overrides stop without broadening access or retrying.
11. Confirm that an extension-owned exact allowance expires no later than 60 minutes after creation and is not renewed by reuse.
12. Select **Open SAP help article** and confirm that it opens exactly `https://userapps.support.sap.com/sap/support/knowledge/en/3039244` in a new tab without extension or customer data in the URL.
13. Inspect permissions and source: there is no Cookies API, `tabs` permission, history, `webRequest`, `scripting`, `management`, `webNavigation`, debugger, arbitrary broad host, or `<all_urls>` permission.

The popup status **Access fix applied** means only that the exact extension-owned browser setting is currently verified as effective for the active SuccessFactors site or that the extension durably recorded the local one-use continuation step for that tab. It is not a claim that SAP authentication, authorization, network delivery, or Story rendering succeeded.

Do not include confidential tenant details, accounts, credentials, report names, HR data, or authentication traffic in certification notes.

## Submission Checklist

- Exact v1.1.1 ZIP and SHA-256 recorded in `docs/VALIDATION.md`.
- Source, unit, package, and loaded-Edge verification pass against that exact ZIP.
- Public repository, support, issue, privacy, and security URLs resolve without authentication.
- Manifest name and description match this listing source.
- Artwork matches the tracked files and passes dimension/content checks.
- Publisher and trader declarations are complete and accurate.
- Required permission, website-access, data-use, and remote-code fields match the exact package.
- Certification notes contain no confidential environment information.
- Trademark and independent-project wording reviewed.
- Submission state recorded accurately as draft, submitted, in certification, certified, or live.
