import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchTextWithPolicy } from "./http-request.mjs";

const API_BASE = "https://api.addons.microsoftedge.microsoft.com/v1";
const DEFAULT_EDGE_CERTIFICATION_NOTES = [
  "Story Reports Access Helper for SAP is an independent compatibility helper for embedded SuccessFactors Story Reports.",
  "The required contentSettings permission is essential to its automatic single purpose and produces Microsoft Edge's broad website-settings warning; executable code uses only the cookies content-setting surface.",
  "For a validated live SAP flow, it creates only temporary exact HTTPS default-port (:443) cookie-allow pairs with the detected IAS request/cookie origin as primary and the matching SuccessFactors top-level origin as secondary.",
  "Each pair is tracked in a protected bounded ledger of at most twenty entries, has a hard non-renewing maximum lifetime of 60 minutes, and is removed through browser alarms or startup reconciliation.",
  "The extension runs automatically with no tenant entry or configuration UI. Extension-owned exact-pair allowances are removed through their hard expiry, browser alarms, startup reconciliation, or extension removal.",
  "The rules use the regular profile and Microsoft Edge may inherit them into InPrivate even though the extension is not allowed to run there.",
  "The extension does not call the Cookies API and never reads cookie values, form values, credentials, authentication payloads, or report content; it has no telemetry or developer backend.",
  "Enterprise policy can override the allowance, Edge Strict Tracking Prevention can block IAS independently of cookies, and missing or expired SAP authentication can still prevent the report from loading.",
  "Before one native submit is released, an exact document-bound continuation intent and replay-scheduled tombstone are durably committed. The outer exact-document response has a five-second fail-closed deadline so a stale browser message channel cannot hold startup recovery indefinitely; durable commit evidence remains authoritative and an ambiguous attempt is never retried. The popup status Access fix applied means either that the exact browser setting is currently verified as effective for the active SuccessFactors site or that this local replay-scheduled step was durably recorded for the tab; it does not prove network delivery, SAP authentication, authorization, or Story rendering. A pre-commit interruption releases no native submit and no automatic retry occurs.",
  "Automatic host access is restricted to listed standard SAP-hosted IAS tenant families and approved SuccessFactors suffixes. Arbitrary customer-configured custom domains are not silently trusted, and the extension requests neither all-URL access nor a remote allowlist.",
  "On the exact active Report Center path only, a DOM-free current-build marker answers a local probe and sends only build/protocol readiness. The active page is evaluated after installation, on a same-build service-worker start including re-enablement, on tab activation, and on Microsoft Edge URL-change or page-completion events. The marker probe and guarded one-time recovery may run when a safe exact matching tab still has Microsoft Edge's advisory loading status. One trusted-local marker stores only the current extension build/version so a same-build worker start can be distinguished from a version transition; a version transition skips the immediate generic startup scan. A session write-ahead record permits at most one ordinary cache-preserving automatic refresh without inspecting report content, refreshing background or unrelated tabs, or changing focus.",
  "The popup paints a local Checking this report state immediately, then uses short time-bounded, non-overlapping status checks to update that same open window. A verified exact allowance or durable continuation record takes priority over Microsoft Edge's advisory tab-loading value. Fix this report is hidden when the page is unsupported, prepared, working, or already fixed, but may be offered for a safe supported loading page or as a fail-closed fallback when status cannot be confirmed. The service worker independently revalidates every accepted request and durably records it; the result is returned for display before at most one cache-preserving refresh. It enforces a 30-second repeat guard. The action never clears browser cookies, the allowance ledger, or unrelated settings.",
  "Inside a validated IAS child document, mutation-driven detection remains available for that document's lifetime so slow SAP instances are not excluded by an arbitrary ten-second cutoff. It disconnects and clears its timers immediately after the first accepted report and never polls report values.",
  "The popup has one optional help action that opens exactly https://userapps.support.sap.com/sap/support/knowledge/en/3039244 in a new tab without adding tenant, account, report, or extension-state values."
].join(" ");
const REQUIRED_ENV = [
  "EDGE_ADDONS_CLIENT_ID",
  "EDGE_ADDONS_API_KEY",
  "EDGE_ADDONS_PRODUCT_ID",
  "EDGE_ADDONS_ZIP",
  "EDGE_ADDONS_CERTIFICATION_NOTES"
];

export function getMissingEdgeConfig(env = process.env) {
  return REQUIRED_ENV.filter((key) => !String(env[key] || "").trim());
}

export function normalizeEdgeCredential(value) {
  return String(value || "").replace(/[\r\n]+/g, "").trim();
}

export function readEdgeConfig(env = process.env) {
  const releaseSpecificNotes = String(env.EDGE_ADDONS_CERTIFICATION_NOTES || "").trim();
  return {
    clientId: normalizeEdgeCredential(env.EDGE_ADDONS_CLIENT_ID),
    apiKey: normalizeEdgeCredential(env.EDGE_ADDONS_API_KEY),
    productId: normalizeEdgeCredential(env.EDGE_ADDONS_PRODUCT_ID),
    zipPath: String(env.EDGE_ADDONS_ZIP || "").trim(),
    certificationNotes: `${DEFAULT_EDGE_CERTIFICATION_NOTES}\n\nRelease-specific notes:\n${releaseSpecificNotes}`,
    pollAttempts: positiveInteger(env.EDGE_ADDONS_POLL_ATTEMPTS, 40),
    pollIntervalMs: positiveInteger(env.EDGE_ADDONS_POLL_INTERVAL_MS, 15_000)
  };
}

export function buildEdgeEndpoints(productId) {
  const base = `${API_BASE}/products/${encodeURIComponent(productId)}`;
  return {
    uploadUrl: `${base}/submissions/draft/package`,
    uploadStatusUrl: (operationId) => `${base}/submissions/draft/package/operations/${encodeURIComponent(operationId)}`,
    publishUrl: `${base}/submissions`,
    publishStatusUrl: (operationId) => `${base}/submissions/operations/${encodeURIComponent(operationId)}`
  };
}

export function buildEdgeCertificationRequest(headers, certificationNotes) {
  return {
    method: "POST",
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    body: certificationNotes
  };
}

export function extractEdgeOperationId(location) {
  const value = String(location || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  try {
    if (/^[A-Za-z0-9-]{1,128}$/.test(value)) return value;
    const url = new URL(value);
    if (url.origin !== "https://api.addons.microsoftedge.microsoft.com" || !url.pathname.includes("/operations/")) {
      return "";
    }
    const decoded = decodeURIComponent(url.pathname.split("/").pop() || "");
    return /^[A-Za-z0-9-]{1,128}$/.test(decoded) ? decoded : "";
  } catch {
    return "";
  }
}

export function getEdgeOperationStatus(payload) {
  return typeof payload?.status === "string" ? payload.status.toLowerCase() : "";
}

export function sanitizeEdgeMessage(value) {
  return String(value || "")
    .replace(/(Authorization:\s*(?:ApiKey|Bearer)\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(/("(?:apiKey|api_key|access_token|client_secret)"\s*:\s*")[^"]+(")/gi, "$1[redacted]$2")
    .replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret)=)[^\s&]+/gi, "$1[redacted]")
    .slice(0, 4_000);
}

async function main() {
  const missing = getMissingEdgeConfig();
  if (missing.length) throw new Error(`Missing Microsoft Edge Add-ons configuration: ${missing.join(", ")}.`);
  const config = readEdgeConfig();
  if (!existsSync(config.zipPath)) throw new Error(`Microsoft Edge Add-ons ZIP not found: ${config.zipPath}`);

  const endpoints = buildEdgeEndpoints(config.productId);
  const headers = { Authorization: `ApiKey ${config.apiKey}`, "X-ClientID": config.clientId };
  console.log(`Uploading ${basename(config.zipPath)} to Microsoft Edge Add-ons...`);
  const uploadOperation = await startOperation(endpoints.uploadUrl, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/zip" },
    body: readFileSync(config.zipPath)
  });
  await pollOperation(
    endpoints.uploadStatusUrl(uploadOperation),
    headers,
    config.pollAttempts,
    config.pollIntervalMs,
    "package upload"
  );

  console.log("Submitting Microsoft Edge Add-ons update for certification...");
  const publishOperation = await startOperation(
    endpoints.publishUrl,
    buildEdgeCertificationRequest(headers, config.certificationNotes)
  );
  await pollOperation(
    endpoints.publishStatusUrl(publishOperation),
    headers,
    config.pollAttempts,
    config.pollIntervalMs,
    "submission"
  );
  console.log(`Microsoft Edge Add-ons accepted ${basename(config.zipPath)} for certification; it is not live yet.`);
}

export async function startOperation(url, init) {
  // Store mutations are not safely repeatable after an ambiguous network failure.
  const { response, text } = await fetchTextWithPolicy(url, init, { attempts: 1, retryStatuses: false });
  if (response.status !== 202) {
    throw new Error(`Microsoft Edge Add-ons API failed (${response.status}): ${sanitizeEdgeMessage(text)}`);
  }
  const operationId = extractEdgeOperationId(response.headers.get("location"));
  if (!operationId) throw new Error("Microsoft Edge Add-ons API did not return a valid operation ID.");
  return operationId;
}

export async function pollOperation(url, headers, attempts, intervalMs, label) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await delay(intervalMs);
    const { response, text } = await fetchTextWithPolicy(
      url,
      { method: "GET", headers },
      { attempts: 3, retryNetwork: true }
    );
    if (!response.ok) {
      throw new Error(`Microsoft Edge Add-ons ${label} status failed (${response.status}): ${sanitizeEdgeMessage(text)}`);
    }
    const payload = safeJson(text);
    const status = getEdgeOperationStatus(payload);
    if (status === "succeeded") return payload;
    if (status === "failed") throw new Error(`Microsoft Edge Add-ons ${label} failed: ${sanitizeEdgeMessage(text)}`);
    if (status !== "inprogress") {
      throw new Error(`Microsoft Edge Add-ons ${label} returned unknown status ${status || "(empty)"}.`);
    }
    console.log(`Microsoft Edge Add-ons ${label} is processing (${attempt}/${attempts})...`);
  }
  throw new Error(`Microsoft Edge Add-ons ${label} did not finish before the polling timeout.`);
}

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return { raw: sanitizeEdgeMessage(value) };
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(sanitizeEdgeMessage(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
