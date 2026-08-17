# Microsoft Edge Production Acceptance Plan

This acceptance plan is a release gate. Unit tests prove local invariants; they do not prove that current Microsoft Edge, enterprise policy, and a live SAP tenant will accept the temporary browser allowance or render a Story Report.

## Prerequisites

- Use the exact checksum-verified v1.1.0 Microsoft Edge Add-ons ZIP.
- Use a dedicated normal Microsoft Edge profile with a valid SAP test account. Do not use Guest or InPrivate.
- Disable every older or duplicate installation.
- Test only approved standard SAP-hosted IAS and SuccessFactors hostnames listed in the README. Customer-configured IAS custom domains are outside this build.
- Keep authentication traffic confidential. Never retain cookies, SAML values, RelayState, CSRF values, credentials, report content, or employee data.

## Required Test Matrix

### 1. Pre-Install Or Re-Enabled Report Center

1. With the extension absent, leave one Report Center page active. Test both the home route and a reproducibly blocked Story route.
2. Install and enable the exact v1.1.0 candidate.
3. Observe that page, then open the same Story. In a separate run, navigate from Report Center home to the Story in the same tab without switching tabs.

Expected:

- at most one ordinary, cache-preserving refresh occurs on that exact active Report Center page;
- background tabs and unrelated tabs do not refresh;
- a page that was still loading at install is evaluated after completion;
- a same-tab SAP route change is evaluated without requiring tab switching;
- the refreshed page receives the current v1.1.0 marker;
- returning to the page again does not trigger a second refresh; and
- the Story attempt reaches the automatic exact-pair flow without user configuration.

Repeat with the extension disabled while Report Center remains open, then re-enable it. Confirm that a same-build service-worker start or the next eligible tab activation, URL change, or page-completion event covers the active page without requiring the user to understand extension injection timing. Separately simulate a version transition and confirm that it records the new build but skips the immediate generic startup scan so it cannot disrupt an older exact-document continuation.

### 2. End-User Popup

Open the toolbar popup in supported, unsupported, loading, working, prepared, completed, failure, and status-unavailable states.

Expected:

- one clear, nontechnical status card that distinguishes not-yet-applied, working, page-prepared, applied, and stopped states;
- no tenant, company, account, URL, hostname, policy, cookie, or mode input;
- no pause, clear, resume, advanced-settings, or technical controls;
- an animated **Checking this page…** state while the contextual check runs;
- **Fix this report** only when the supported active page can be retried, hidden when the page is unsupported/loading/prepared/working/fixed, and shown as a safe fallback if the availability check itself cannot complete;
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

In DevTools, observe only method, sanitized host/path, status, timing, and `Sec-Fetch-Storage-Access`. Verify at most one continuation POST and no automatic loop. Do not inspect or save its body.

**Fix applied** means that the exact extension-owned browser setting is currently verified as effective for the active SuccessFactors site or that the extension durably recorded the local one-use continuation step for that tab. Record observed network delivery, SAP authentication, and final Story rendering separately.

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
- storage initialization, ledger write, alarm, or effective-setting verification failure.

Visit SAP's top-level `/ui/storageAccess/interact` helper directly. The extension must not intercept, alter, or synthesize its Confirm action.

### 7. Policy And Browser Protections

Repeat on a managed test profile with the intended Microsoft Edge cookie policies and, separately, Strict Tracking Prevention where approved.

Expected:

- the extension verifies the effective exact setting after writing it;
- a policy override, unavailable API, ineffective setting, inactive storage, or storage failure results in **Fix not applied**;
- the extension does not weaken a broader privacy setting, open repeated helper tabs, or claim Story success; and
- missing or expired SAP authentication remains an SAP sign-in outcome, not an extension success.

### 8. Supported-Host Boundary

Test representative tenants across the standard SAP host families claimed in the Store listing. Separately verify that a customer-configured IAS custom domain remains unsupported and inert. Do not add `<all_urls>`, trust a hostname from console text, or copy a host from an error message.

## Evidence To Retain

- exact extension version, ZIP filename, byte size, member count, and SHA-256;
- Microsoft Edge and operating-system versions;
- sanitized SAP host-family classification only;
- whether the exact pair was written, effective, reused, and expired;
- whether the trusted-local current-build marker contained only the expected v1.1.0 build/version and the same-build/version-transition scans followed the documented boundary;
- whether the durable barrier was reached and whether one continuation POST was separately observed;
- whether the Story rendered, as a distinct downstream result;
- popup status and sanitized browser policy/Tracking Prevention state for failures; and
- the fixed SAP KBA URL opened by the help button.

Do not retain or distribute passwords, MFA codes, cookies, raw HAR files, request/response bodies, headers containing tokens, SAML material, RelayState, CSRF values, report names, report screenshots, employee data, customer names, or tenant-specific hostnames.

## Acceptance Criteria

- Every positive and negative case passes in current Stable Microsoft Edge using the exact packaged ZIP.
- A first eligible blocked flow requires no tenant input or technical setup.
- A pre-install or re-enabled active Report Center page receives at most one safe automatic refresh and then follows the normal automatic path.
- A same-tab route change and a page that completed after installation are both covered without requiring a manual tab switch.
- The explicit manual action is restricted to the active supported Report Center page, refuses in-flight work and attempts inside the 30-second guard, displays its result before any accepted refresh, and performs at most one refresh per accepted click.
- Only exact validated HTTPS `:443` IAS-primary/SuccessFactors-secondary pairs are created, with a hard non-renewing maximum age of 60 minutes and a maximum ledger size of twenty.
- No cookie values or SAP form values are read.
- Each IAS document can release at most one continuation after the durable barrier; failures never create a helper-tab or retry loop.
- Expiry, startup, policy-conflict, and crash-recovery behavior is verified.
- The popup remains simple, includes only the bounded manual fix and fixed SAP help actions, and does not claim that SAP authentication or Story rendering succeeded.
- The exact ZIP passes all source/package checks and matches the recorded SHA-256.
- Listing text, permission declarations, public support/privacy URLs, and artwork match the exact v1.1.0 package.
