# Support

Story Reports Access Helper for SAP is designed to work without configuration. Install it from Microsoft Edge Add-ons, then open a supported SAP SuccessFactors Story Report normally.

## If A Story Report Is Still Blank

1. Wait a few seconds, then open the same Story once more.
2. Open the extension popup and check its short status message.
3. Select **Open SAP help article** to view [SAP KBA 3039244: Unable to access Story Reports due to Browser Settings](https://userapps.support.sap.com/sap/support/knowledge/en/3039244).
4. Confirm that the SAP session is still signed in. An expired session, missing Story permission, enterprise browser policy, or SAP-side problem cannot be fixed by the extension.
5. Ask the organization's SAP or browser administrator whether Microsoft Edge policy or Strict Tracking Prevention overrides the required site setting.

The SAP page linked from the popup is a public KBA preview. SAP may require an SAP for Me account for the full article.

## Supported Site Boundary

The public extension supports tenant subdomains under the standard SAP Identity Authentication and SuccessFactors host families listed in the [README](README.md). A customer-configured IAS custom hostname is outside this automatic trust boundary and requires a separately validated enterprise allowlist or browser policy.

## Open A Public Support Issue

If the problem continues, use the [GitHub issue tracker](https://github.com/RobinMJD/Story-Reports-Access-Helper-for-SAP/issues).

Safe details to include:

- extension version shown in the popup;
- Microsoft Edge version and operating system;
- exact popup status text;
- whether the Story page was open before the extension was installed or enabled;
- whether one automatic refresh occurred; and
- the standard SAP parent host family involved, such as `successfactors.eu` or `accounts.cloud.sap`, without the tenant-specific hostname.

Do **not** post:

- a raw HAR file or exported browser profile;
- cookies, request/response bodies, headers containing tokens, SAML, RelayState, or CSRF values;
- passwords, MFA codes, account identifiers, or email addresses;
- report names, report identifiers, report content, employee data, or customer names; or
- screenshots that show customer, tenant, account, report, or employee information.

## Scope Of Support

This project can troubleshoot the extension's Microsoft Edge behavior and supported-host detection. SAP authentication, Story permissions, tenant configuration, report correctness, and SAP service availability remain matters for the relevant SAP administrator or SAP Support.

Story Reports Access Helper is an independent project and is not affiliated with, sponsored by, or endorsed by SAP or Microsoft.
