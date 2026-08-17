# Microsoft Edge Production Acceptance Plan

This acceptance plan is a release gate. Unit tests prove local invariants; they do not prove that current Microsoft Edge, enterprise policy, and a live SAP tenant will accept the temporary browser allowance or render a Story Report.

## Prerequisites

- Use the exact checksum-verified v1.1.1 Microsoft Edge Add-ons ZIP.
- Use a dedicated normal Microsoft Edge profile with a valid SAP test account. Do not use Guest or InPrivate.
- Disable every older or duplicate installation.
- Test only approved standard SAP-hosted IAS and SuccessFactors hostnames listed in the README. Customer-configured IAS custom domains are outside this build.
- Keep authentication traffic confidential. Never retain cookies, SAML values, RelayState, CSRF values, credentials, report content, or employee data.

## Required Test Matrix

### 1. Pre-Install Or Re-Enabled Report Center

1. With the extension absent, leave one Report Center page active. Test both the home route and a reproducibly blocked Story route.
2. Install and enable the exact v1.1.1 candidate.
3. Observe that page, then open the same Story. In a separate run, navigate from Report Center home to the Story in the same tab without switching tabs.

Expected:

- at most one ordinary, cache-preserving refresh occurs on that exact active Report Center page;
- background tabs and unrelated tabs do not refresh;
- a safe matching page that Edge still labels as loading can be probed and receives at most the same one guarded refresh without waiting indefinitely for `complete`;
- a same-tab SAP route change is evaluated without requiring tab switching;
- the refreshed page receives the current v1.1.1 marker;
- returning to the page again does not trigger a second refresh; and
- the Story attempt reaches the automatic exact-pair flow without user configuration.

Repeat with the extension disabled while Report Center remains open, then re-enable it. Confirm that a same-build service-worker start or the next eligible tab activation, URL change, or page-completion event covers the active page without requiring the user to understand extension injection timing. Include a tab that stays in Edge's advisory loading state while its SAP UI is already visible. Separately simulate a version transition and confirm that it records the new build but skips the immediate generic startup scan so it cannot disrupt an older exact-document continuation.

### 2. End-User Popup

Open the toolbar popup in supported, unsupported, loading, working, prepared, completed, failure, and status-unavailable states.

Expected:

- one clear, nontechnical status card that distinguishes not-yet-applied, working, page-prepared, applied, and stopped states;
- no tenant, company, account, URL, hostname, policy, cookie, or mode input;
- no pause, clear, resume, advanced-settings, or technical controls;
- an immediate animated **Checking this report…** state before any service-worker response is available;
- bounded status requests that never hold the popup behind service-worker startup or recovery work;
- non-overlapping live polling that updates the same open popup when SAP or extension state changes, with no instruction to close and reopen it;
- the underlying active Report Center tab remains the contextual target when the Edge toolbar popup temporarily owns native focus;
- durable replay evidence or a verified effective exact allowance shown as **Access fix applied** even if Edge still reports the tab as loading;
- **Fix this report** whenever the supported active page can safely be retried, including an otherwise-safe page that remains loading, hidden when the page is unsupported/prepared/working/fixed, and shown as a fail-closed fallback if status itself cannot be confirmed;
- one stable **Open SAP help article** button; and
- no technical workflow codes or claim that the Story itself rendered.

Select **Open SAP help article**.

Expected:

- one new tab opens at exactly `https://userapps.support.sap.com/sap/support/knowledge/en/3039244`;
- no query, fragment, tenant, account, report, or extension-state value is added; and
- repeated clicks create only user-requested navigation, not an automatic loop.

Select **Fix this report** on a supported active Report Center page after the automatic path is complete or stopped.

Expected:

- an active continuation is never interrupted;
- the attempt is recorded before exactly one normal, cache-preserving refresh;
- the accepted or refused result is displayed before any accepted refresh begins;
- no other tab is focused, opened, closed, or refreshed;
- cookies and unrelated settings are not cleared;
- the control reports a short working state and refuses a repeated attempt inside the 30-second guard; and
- the same control is unavailable outside supported Report Center.

Keep the popup open while the background status changes from loading to ready, preparing, applied, and unavailable in separate runs. Confirm each transition appears in that same popup and that a timed-out request is followed by a later successful poll without stale results overwriting newer ones.

### 3. First Blocked Story On A Standard SAP Tenant

1. Start from a profile state that reproduces the blocked embedded IAS flow while retaining the valid SAP authentication state required by the test.
2. Open one Story Report normally.

Expected:

- IAS and SuccessFactors origins are derived from browser-provided frame context;
- exactly one IAS-primary/SuccessFactors-secondary HTTPS `:443` cookie allowance is written and read back as effective;
- no wildcard parent, reversed pair, non-default port, unrelated site, or `<all_urls>` rule is created;
- no helper tab, fresh Report Center tab, or repeated retry is initiated automatically;
- the same IAS document reaches the durable continuation barrier and releases at most one native SAP form submission; and
- popup copy moves through plain-language preparing/completed states.

Repeat with network throttling or an equivalent controlled fixture so the exact IAS storage-access structure is inserted while hidden after at least 30 seconds, and so an activated exact structure appears after at least 15 seconds.

Expected:

- the mutation-driven detector remains attached for the IAS document lifetime rather than stopping after ten seconds;
- the delayed hidden and activated exact structures are each reported once within their bounded detection delay;
- no periodic DOM polling occurs;
- the observer and pending detector timers stop after the first accepted report; and
- malformed delayed structures remain inert under the same exact host, ancestor, DOM, form, and document gates.

In DevTools, observe only method, sanitized host/path, status, timing, and `Sec-Fetch-Storage-Access`. Verify at most one continuation POST and no automatic loop. Do not inspect or save its body.

**Access fix applied** means that the exact extension-owned browser setting is currently verified as effective for the active SuccessFactors site or that the extension durably recorded the local one-use continuation step for that tab. Record observed network delivery, SAP authentication, and final Story rendering separately.

### 4. Reuse And Automatic Expiry

Open the same Story again before the allowance expires.

Expected:

- the existing non-expired exact pair is reused without renewing its original 60-minute lifetime;
- at most one continuation is released for the new IAS document; and
- no helper-tab or retry loop occurs.

Suspend/restart the service worker and browser, then cross the hard 60-minute expiry.

Expected:

- startup/alarm reconciliation removes expired entries and rebuilds the extension-owned rule set without them;
- a continuation durably committed before a restart remains an at-most-once record;
- a pre-commit interruption releases no native submit and does not retry automatically; and
- the next eligible Story may create a new exact pair only after the earlier pair has expired or been removed.

### 5. Second Supported SAP Instance

Repeat with an approved second tenant using different IAS and/or SuccessFactors origins.

Expected:

- the second exact pair is derived automatically without user input;
- the first pair is neither broadened nor reused for the second instance; and
- the bounded ledger contains only exact pairs and their timestamps/patterns.

### 6. Negative Trust-Boundary Cases

Verify that each case stops without creating a rule, submitting a form, or opening an automatic tab:

- IAS embedded under a non-SuccessFactors top-level site;
- bare IAS parent domains, suffix-confusion lookalikes, HTTP, credentials, explicit non-default ports, malformed URLs, or unsupported custom IAS domains;
- malformed or changed IAS interstitial structure;
- form action on a different origin/path, unexpected fields/types, or changed source document;
- duplicate or stale continuation tokens, wrong tab/window/frame/document, or InPrivate context; and
- a never-resolving exact-document response, including a late response or late commit after the five-second deadline; and
- storage initialization, ledger write, alarm, or effective-setting verification failure.

Visit SAP's top-level `/ui/storageAccess/interact` helper directly. The extension must not intercept, alter, or synthesize its Confirm action.

### 7. Policy And Browser Protections

Repeat on a managed test profile with the intended Microsoft Edge cookie policies and, separately, Strict Tracking Prevention where approved.

Expected:

- the extension verifies the effective exact setting after writing it;
- a policy override, unavailable API, ineffective setting, inactive storage, or storage failure results in **Access fix not applied**;
- the extension does not weaken a broader privacy setting, open repeated helper tabs, or claim Story success; and
- missing or expired SAP authentication remains an SAP sign-in outcome, not an extension success.

### 8. Supported-Host Boundary

Test representative tenants across the standard SAP host families claimed in the Store listing. Separately verify that a customer-configured IAS custom domain remains unsupported and inert. Do not add `<all_urls>`, trust a hostname from console text, or copy a host from an error message.

## Evidence To Retain

- exact extension version, ZIP filename, byte size, member count, and SHA-256;
- Microsoft Edge and operating-system versions;
- sanitized SAP host-family classification only;
- whether the exact pair was written, effective, reused, and expired;
- whether the trusted-local current-build marker contained only the expected v1.1.1 build/version and the same-build/version-transition scans followed the documented boundary;
- whether the durable barrier was reached and whether one continuation POST was separately observed;
- whether the Story rendered, as a distinct downstream result;
- popup status and sanitized browser policy/Tracking Prevention state for failures; and
- the fixed SAP KBA URL opened by the help button.

Do not retain or distribute passwords, MFA codes, cookies, raw HAR files, request/response bodies, headers containing tokens, SAML material, RelayState, CSRF values, report names, report screenshots, employee data, customer names, or tenant-specific hostnames.

## Acceptance Criteria

- Every positive and negative case passes in current Stable Microsoft Edge using the exact packaged ZIP.
- A first eligible blocked flow requires no tenant input or technical setup.
- A pre-install or re-enabled active Report Center page receives at most one safe automatic refresh and then follows the normal automatic path.
- A same-tab route change, a page that completed after installation, and a safe matching page that remains in Edge's advisory loading state are covered without requiring a manual tab switch.
- The popup renders immediately, every status request reaches a bounded result or fallback, and the same open popup follows later state changes without requiring a reopen.
- Toolbar-popup focus does not make the active supported Report Center tab appear unsupported, while unsolicited automatic recovery still requires a focused normal window.
- Verified allowance or durable replay evidence overrides the advisory loading label, while loading alone never creates a false applied result.
- The explicit manual action is restricted to the active supported Report Center page, refuses in-flight work and attempts inside the 30-second guard, displays its result before any accepted refresh, and performs at most one refresh per accepted click.
- Only exact validated HTTPS `:443` IAS-primary/SuccessFactors-secondary pairs are created, with a hard non-renewing maximum age of 60 minutes and a maximum ledger size of twenty.
- No cookie values or SAP form values are read.
- Each IAS document can release at most one continuation after the durable barrier; failures never create a helper-tab or retry loop.
- Exact IAS structures that appear after slow loads remain detectable for the document lifetime, while the first report stops further observation and detector timers.
- Expiry, startup, policy-conflict, and crash-recovery behavior is verified.
- The popup remains simple, includes only the bounded manual fix and fixed SAP help actions, and does not claim that SAP authentication or Story rendering succeeded.
- The exact ZIP passes all source/package checks and matches the recorded SHA-256.
- Listing text, permission declarations, public support/privacy URLs, and artwork match the exact v1.1.1 package.
