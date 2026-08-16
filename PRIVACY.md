# Privacy Policy

Effective date: August 16, 2026

Story Reports Access Helper for SAP is a local-first Microsoft Edge extension. It does not sell user data or send extension data to the developer. It has no analytics, advertising, remote configuration, remotely hosted code, or developer-operated backend.

## What The Extension Processes Locally

On a matching SAP SuccessFactors Report Center page, the extension processes the current tab address to verify a supported hostname, the exact Report Center path, and the Story execution route. A tiny DOM-free script answers whether the current extension build is present. It exchanges only the extension build and protocol version with the local extension service worker; it does not inspect the SuccessFactors page DOM, title, report list, report name, report identifier, report contents, or employee data.

Inside a matching SAP Identity Authentication page, the extension checks:

- fixed SAP storage-access element identifiers and containment;
- whether SAP's existing same-origin replay form is connected and uses the expected method, target, encoding, path, and field names/types;
- the browser-provided IAS frame origin and top-level SuccessFactors ancestor origin; and
- read-only browser Storage Access API state.

The extension never reads form values, cookie values, passwords, MFA codes, credentials, authentication tokens, SAML payloads, RelayState, CSRF values, report data, or browsing history.

## Existing-Page Installation Recovery

Microsoft Edge does not retroactively inject a newly installed or re-enabled static content script into a document that was already open. For an active, completed, non-private tab on the exact supported Story execution route, the extension checks whether its current-build marker is present. If the marker is absent, it validates the tab again, records one attempt, and performs one ordinary refresh with normal cache behavior.

The extension never focuses, opens, closes, or refreshes an unrelated or background tab, and it never retries that refresh. Its session-only recovery record contains a tab identifier, extension version, state, and timestamp. It does not contain a URL, title, report identifier, or page content.

## Temporary Exact-Pair Browser Access

The extension requires Microsoft Edge's `contentSettings` permission. Edge describes this permission broadly because the API can control several types of website settings. Story Reports Access Helper uses it only for a temporary cookie allowance whose two sides were validated from the live SAP flow:

- primary: the exact SAP Identity HTTPS/default-port (`:443`) request and cookie origin; and
- secondary: the exact matching SuccessFactors HTTPS/default-port (`:443`) top-level origin.

It never creates parent-domain wildcard rules, arbitrary-site rules, or `<all_urls>` rules. It never uses the Cookies API and does not create, read, or modify any cookie value. The allowance only lets SAP use its own existing sign-in state in that exact embedding context.

Every allowance has a hard, non-renewing maximum lifetime of 60 minutes. Expired rules are removed through browser alarms and startup reconciliation. A reused allowance keeps its original expiry; use does not extend the 60-minute limit.

Rules use Edge's `regular` profile scope. Edge may inherit a regular-profile rule into an InPrivate profile when not overridden there, even though this extension itself is not allowed to execute in InPrivate windows. Any inherited rule still expires within the same hard limit.

## SAP Continuation

After the exact allowance is verified, the extension can continue the same already-started SAP IAS document once. Before releasing that action, it records an opaque, document-bound attempt in session storage. The browser then serializes SAP's existing same-origin form directly to SAP. The extension does not read, copy, reconstruct, store, log, or transmit any form value.

The recorded state proves only that one continuation was authorized. It does not prove network delivery, authentication success, or Story rendering. If the browser setting is ineffective, enterprise policy blocks it, the source document changes, or the durable barrier cannot be completed, the extension stops without retrying or broadening access.

## Local Storage And Retention

`chrome.storage.session` contains bounded workflow metadata only:

- browser tab, window, frame, and document identifiers;
- validated IAS and SuccessFactors origins;
- timestamps, status codes, and an opaque continuation-attempt identifier; and
- bounded one-refresh records containing only a tab identifier, build version, state, and timestamp.

Workflow and recent-result records expire after ten minutes. A terminal one-refresh record lasts only for the browser session so the same tab is not automatically refreshed twice; it is removed when the tab closes. Session records clear with the browser session.

`chrome.storage.local`, restricted to trusted extension contexts, contains a bounded cleanup ledger with at most twenty entries:

- validated IAS and SuccessFactors origins;
- their derived exact HTTPS `:443` content-setting patterns; and
- creation and expiry timestamps.

It contains no cookie values, form values, account identifiers, report data, or authentication payloads. Expired entries and their extension-owned browser rules are removed automatically. The browser provides its standard extension-management controls; the extension has no user profile, cloud account, or developer-held copy of local data.

## SAP Help Article

The popup's **Open SAP help article** button opens this fixed public SAP URL in a new tab:

`https://userapps.support.sap.com/sap/support/knowledge/en/3039244`

The extension does not add a tenant, account, report, or tracking value to that URL. Loading the page connects directly to SAP, which processes the visit under SAP's own terms and privacy practices. The public page is a KBA preview; SAP may require authentication for full article content.

## Website Scope

The Microsoft Edge build supports tenant subdomains under the standard SAP SuccessFactors and Identity Authentication parent domains listed in the [README](README.md). Arbitrary customer-configured custom hostnames are not silently trusted. Supporting one requires a separately validated exact allowlist or enterprise policy.

## Data Sharing

Story Reports Access Helper does not send extension data to the developer, an analytics provider, an advertising network, or another third party. SAP's existing sign-in request and the optional user-opened SAP KBA page go directly from the browser to SAP. The extension does not insert developer-controlled data into either request.

## Contact

Privacy questions and public support requests may be submitted through the [GitHub issue tracker](https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/issues). Follow [SUPPORT.md](SUPPORT.md) and remove all customer, employee, report, credential, cookie, and authentication data before posting.
