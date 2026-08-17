const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export async function fetchWithPolicy(
  url,
  init = {},
  options = {}
) {
  return requestWithPolicy(url, init, options, (response) => response);
}

export async function fetchTextWithPolicy(
  url,
  init = {},
  options = {}
) {
  return requestWithPolicy(url, init, options, async (response) => ({
    response,
    text: await response.text()
  }));
}

async function requestWithPolicy(
  url,
  init = {},
  {
    attempts = 1,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    retryNetwork = false,
    retryStatuses = true
  } = {},
  consumeResponse
) {
  const boundedAttempts = Math.max(1, Math.min(5, Number(attempts) || 1));
  const boundedTimeout = Math.max(10, Math.min(120_000, Number(timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS));
  let lastError;

  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Request timed out.")), boundedTimeout);
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;

    try {
      const response = await fetch(url, { ...init, signal });
      if (!retryStatuses || !RETRYABLE_STATUSES.has(response.status) || attempt === boundedAttempts) {
        // Await inside the try so the per-attempt abort deadline also covers the response body.
        return await consumeResponse(response);
      }

      await response.arrayBuffer().catch(() => undefined);
      await delay(getRetryDelayMs(response.headers.get("retry-after"), attempt));
    } catch (error) {
      lastError = controller.signal.aborted && !init.signal?.aborted
        ? new Error("Store API request timed out.")
        : error;
      if (!retryNetwork || attempt === boundedAttempts || init.signal?.aborted) {
        throw normalizeFetchError(lastError);
      }
      await delay(getRetryDelayMs(null, attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw normalizeFetchError(lastError);
}

export function getRetryDelayMs(retryAfter, attempt) {
  const retryAfterValue = String(retryAfter ?? "").trim();
  if (retryAfterValue) {
    const seconds = Number(retryAfterValue);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(10_000, seconds * 1_000);
    }

    const date = Date.parse(retryAfterValue);
    if (Number.isFinite(date)) {
      return Math.max(0, Math.min(10_000, date - Date.now()));
    }
  }

  return Math.min(4_000, 250 * 2 ** Math.max(0, attempt - 1));
}

function normalizeFetchError(error) {
  if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
    return new Error("Store API request timed out.");
  }
  return error instanceof Error ? error : new Error(String(error || "Store API request failed."));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
