# Security Model

## Scope

Story Reports Access Helper for SAP has one purpose: prepare the narrow browser-storage context required by SAP Identity Authentication when it is embedded in a supported SAP SuccessFactors Story Report.

It is not an authentication provider, password manager, report reader, tracking-protection bypass, or general cookie manager. It cannot bypass SAP authorization, enterprise browser policy, MFA, or an expired SAP session, and it does not guarantee report availability.

## Trust Boundary

A workflow is accepted only when all of these conditions hold:

- the IAS document uses HTTPS without credentials or a non-default port;
- the IAS hostname is a tenant subdomain of one of the reviewed SAP Identity parent domains;
- the browser-provided top ancestor is an HTTPS tenant under one of the reviewed SuccessFactors parent domains;
- the IAS page has unique, connected SAP storage-access elements with the expected containment;
- the existing SAP replay form posts to the same IAS origin and exact current path without a query or fragment;
- the form uses the expected method, target, encoding, and exact field-name/type schema; and
- the sender is a regular non-private child frame with exact tab, window, frame, and document binding.

Unknown hosts, malformed documents, duplicate elements, ambiguous state, stale documents, unsupported custom domains, and private windows fail closed.

The IAS detector is mutation-driven and remains attached for the lifetime of the trusted child document so a slow exact structure is not lost after an arbitrary startup window. It does not poll page values. The first accepted report disconnects the observer, clears its detection timers, and preserves the one-report guard.

## Automatic Browser-Setting Change

The required `contentSettings` permission can technically control several types of site setting, which is why Microsoft Edge displays a broad installation warning. The runtime is constrained to `chrome.contentSettings.cookies` and constructs only exact HTTPS/default-port pairs:

- primary: the validated IAS request/cookie origin; and
- secondary: the validated SuccessFactors top-level origin.

No parent-domain wildcard or `<all_urls>` rule is constructed. Each rule uses `regular` profile scope, is verified with an exact post-write read, is represented in a cleanup ledger capped at twenty pairs, and expires after a hard, non-renewing maximum of 60 minutes. Enterprise policy and higher-precedence browser settings remain authoritative; an ineffective rule stops the workflow.

The cleanup ledger is protected with `storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})` before use. If that protection, any state write, or the effective-setting verification cannot be established, the automatic fix stops.

## Pre-Existing Report-Center Recovery

Static content scripts are not retroactively added to a document that predates extension installation or re-enablement. The extension therefore has narrow required host access to reviewed standard SuccessFactors families and a DOM-free top-frame marker on the exact Report Center path. The marker answers a local build/protocol probe and sends only build/protocol readiness when a new document loads.

The background evaluates the exact active Report Center path after installation, on a same-build service-worker start (including re-enablement), on tab activation, and on `tabs.onUpdated` URL-change or page-completion events. It validates HTTPS/default port, approved hostname, exact Report Center path, a safe active regular-tab state, focused normal-window state, and absence of a current workflow or continuation conflict. Edge's `loading` value is advisory: a matching tab can be probed and receive the guarded one-time refresh while that value remains present.

A trusted-local marker contains only the current extension build/version. It allows a same-build service-worker start to scan the active page while a version transition skips that immediate generic startup scan so an older exact-document continuation is not disrupted. A later eligible activation, URL change, or page completion can still evaluate the page.

Only an absent or stale compile-time marker can arm recovery. The tab and focused normal window are re-read and revalidated around a bounded `storage.session` write-ahead record containing only tab ID, build version, state, and timestamp. The extension then performs one ordinary `tabs.reload(tabId, {bypassCache: false})`. The newly loaded marker moves that record to a terminal state, allowing the new IAS document to proceed while preventing a second automatic refresh in that browser session.

No background or unrelated tab is refreshed; no tab is focused, opened, or closed; cache is not bypassed; and the automatic refresh never loops.

The trusted popup renders its local checking state before requesting contextual status. Its requests and background status snapshot are time-bounded, and non-overlapping live polls update the same popup while it remains open. Because opening an Edge toolbar popup can temporarily move native focus away from the browser window, popup-originated status and manual-fix requests resolve the active tab from Edge's last-focused normal window and then revalidate that exact tab; unsolicited automatic recovery retains the stricter focused-window requirement. Durable replay evidence and a verified effective exact allowance take priority over the advisory tab-loading value. **Fix this report** stays hidden for unsupported pages, active work, pending refreshes, and already-fixed states, but may be offered when a safe supported tab can be retried even if Edge still labels it as loading. If status cannot be confirmed, the popup may display the fallback, but the background still fails closed unless independent validation succeeds.

For an accepted **Fix this report** request, the background independently locates and revalidates the current active supported Report Center tab, including the safe loading state, refuses an active continuation or any attempt inside the 30-second repeat guard, records a new write-ahead attempt, returns the result so the popup can display it, and then performs at most one cache-preserving refresh. It revalidates the durable claim immediately before that refresh. No URL, tab identifier, origin, or setting is accepted from the popup message. The action does not clear cookies, the allowance ledger, or unrelated browser settings.

## At-Most-Once SAP Continuation

The extension never reads or reconstructs SAP form values. It validates the form shape, then asks the background service worker to durably commit an opaque, document-bound attempt before one closed submission gate is released. The background accepts that commit only for the exact stored tab, window, frame, document, IAS origin, workflow state, and UUID.

If the commit is missing, rejected, interrupted, or ambiguous, no native form submission is released and no retry is attempted. The outer exact-document response has a five-second deadline so a stale Chromium message channel cannot hold service-worker recovery indefinitely; after that deadline, durable commit evidence still wins, otherwise the attempt is tombstoned fail-closed. Once committed, later message-channel loss cannot downgrade the record or authorize a duplicate.

Calling the browser's native `HTMLFormElement.prototype.submit` sends SAP's existing form directly to its existing same-origin endpoint. The extension does not read, copy, log, store, or transmit its values to the developer or another destination.

## Automatic Cleanup

Extension-owned cookie allowances have a hard, non-renewing maximum lifetime of 60 minutes. Browser alarms and startup reconciliation rebuild the owned rule set from the protected, bounded ledger and remove expired entries. An active workflow cannot renew the original expiry.

The runtime removes only rules represented in its own validated ledger. It does not clear or modify a user-created setting, enterprise policy, or another extension's rule. Microsoft Edge owns final cleanup when an extension is disabled or removed.

The extension is not allowed to execute in Incognito/InPrivate. Edge can nevertheless inherit a regular-scope content setting into a private profile until that exact rule expires or is removed, so the Store listing and privacy policy disclose that limitation.

## Data Minimization

The extension does not request the Cookies API, `tabs` permission, `history`, `webRequest`, `scripting`, `management`, `webNavigation`, debugger access, or `<all_urls>`. It has no telemetry, remotely hosted code, remote configuration, or developer backend.

Its reviewed SuccessFactors host access is used only to validate a matching current tab address, probe the DOM-free marker, and perform the bounded one-refresh recovery. No SuccessFactors report DOM or content is read.

Session state is bounded to browser identifiers, validated origins, timestamps, status codes, and opaque attempt IDs. The cleanup ledger is bounded to exact origins, derived exact patterns, and timestamps. No report name, report ID, HR content, credential, SAML value, RelayState, CSRF value, cookie value, or browsing-history record is read or retained.

The fixed **Open SAP help article** action opens only `https://userapps.support.sap.com/sap/support/knowledge/en/3039244` without adding query parameters, tenant information, or extension state.

The popup status **Access fix applied** requires either a currently effective exact extension-owned browser setting for the active SuccessFactors site or a durable local `replay-scheduled` result for that tab. It is not evidence of SAP authentication, authorization, network delivery, or Story rendering.

## Supported Hosts And Custom Domains

Automatic host access is limited to the standard SAP parent domains listed in the README. Tenant labels are dynamic; no customer instance is hardcoded.

SAP IAS also supports arbitrary custom domains. A public extension cannot silently verify ownership of an arbitrary hostname without broad web access, an external trust service, or a customer/admin allowlist. Version 1.1.1 deliberately avoids required `<all_urls>`, remote allowlists, DNS services, and console/debugger access. Custom domains therefore fail closed and require a separately validated exact allowlist or enterprise policy.

## Reporting A Security Issue

For a vulnerability that can be described without customer or authentication data, use the repository's [private vulnerability reporting form](https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/security/advisories/new). If private reporting is not yet available, open a minimal public issue asking for a private contact channel without including vulnerability details or technical secrets.

Never attach credentials, raw HAR authentication bodies, cookie databases, SAML/RelayState values, report content, employee information, or customer screenshots to a public report.

## Release Security Gates

Before Microsoft Edge Add-ons submission:

- all source, unit, package, and loaded-Edge tests must pass against the exact ZIP;
- the exact v1.1.1 package must complete clean-profile, pre-install-page, same-tab route-change, same-build service-worker start/re-enable, advisory-loading, delayed-IAS, live-popup, and manual-fallback acceptance;
- Store text and privacy declarations must match the exact package;
- public support, privacy, and security URLs must resolve from the final public repository;
- GitHub private vulnerability reporting must be enabled for the public repository;
- listing media must contain only fictional interface mockups and no customer data;
- the release tag must be immutable and publisher jobs must use the already verified commit and exact package bytes; and
- GitHub publication, Edge submission, certification, and live Store availability must be reported as separate states.
