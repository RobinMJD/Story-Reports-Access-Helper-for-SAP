(() => {
  "use strict";

  const IAS_PARENT_DOMAINS = [
    "accounts.ondemand.com",
    "accounts400.ondemand.com",
    "accounts.cloud.sap",
    "accounts400.cloud.sap",
    "accounts.sapcloud.cn"
  ];
  const SUCCESSFACTORS_SUFFIXES = [
    ".successfactors.com",
    ".successfactors.eu",
    ".successfactors.cn",
    ".sapsf.com",
    ".sapsf.eu",
    ".sapsf.cn",
    ".hr.cloud.sap",
    ".sapcloud.cn"
  ];
  const ACTIVATED_DETECTION_DELAY_MS = 600;
  const DORMANT_DETECTION_DELAY_MS = 2_500;
  const REPLAY_FIELD_SCHEMA = new Map([
    ["utf8", "hidden"],
    ["authenticity_token", "hidden"],
    ["method", "hidden"],
    ["idpSSOEndpoint", "hidden"],
    ["SAMLRequest", "hidden"],
    ["RelayState", "hidden"]
  ]);

  if (!isTrustedIasLocation(window.location)) return;

  // Automatic mode never intercepts SAP's first-party interaction page. If a
  // user opens that SAP page independently, its native behavior must remain
  // untouched even though this content script is present on the IAS origin.
  if (window.top === window) return;

  let reported = false;
  let reportTimer = 0;
  let dormantTimer = 0;
  let resumeAttempted = false;
  const sourceOrigin = getTrustedTopLevelOrigin();
  if (!sourceOrigin) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id) return false;
    if (
      message?.type === "resume-with-cookie-exception" &&
      hasExactKeys(message, ["resumeAttemptId", "type"]) &&
      isSafeResumeAttemptId(message.resumeAttemptId)
    ) {
      void resumeWithCookieException(message.resumeAttemptId).then(
        (result) => deliverResumeResult(result, message.resumeAttemptId, sendResponse),
        () => deliverResumeResult(makeCookieExceptionNotActiveResponse(), message.resumeAttemptId, sendResponse)
      );
      return true;
    }
    return false;
  });

  const observer = new MutationObserver(scheduleInterstitialChecks);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  scheduleInterstitialChecks();

  function scheduleInterstitialChecks() {
    if (reported) return;
    if (!reportTimer) {
      reportTimer = window.setTimeout(() => {
        reportTimer = 0;
        if (reported || !findActivatedStorageAccessInterstitial()) return;
        reportInterstitial();
      }, ACTIVATED_DETECTION_DELAY_MS);
    }
    if (reported) return;
    if (!dormantTimer) {
      dormantTimer = window.setTimeout(() => {
        dormantTimer = 0;
        void checkDormantInterstitial();
      }, DORMANT_DETECTION_DELAY_MS);
    }
  }

  async function checkDormantInterstitial() {
    if (reported) return;
    let interstitial = findStorageAccessStructure();
    if (!interstitial || isLocallyDisplayed(interstitial.grantContainer)) return;

    if (typeof document.hasStorageAccess === "function") {
      try {
        if ((await document.hasStorageAccess()) === true) return;
      } catch {
        // A read-only API failure still leaves an exact dormant interstitial.
      }
    }

    if (reported) return;
    interstitial = findStorageAccessStructure();
    if (!interstitial || isLocallyDisplayed(interstitial.grantContainer)) return;
    reportInterstitial();
  }

  function reportInterstitial() {
    if (reported) return;
    reported = true;
    observer.disconnect();
    if (reportTimer) {
      window.clearTimeout(reportTimer);
      reportTimer = 0;
    }
    if (dormantTimer) {
      window.clearTimeout(dormantTimer);
      dormantTimer = 0;
    }
    sendRuntimeMessage({ type: "interstitial-detected", sourceOrigin });
  }

  function findStorageAccessStructure() {
    const grantContainer = document.getElementById("grantAccessDiv");
    const confirmButton = document.getElementById("requestStorageAccessConfirm");
    const errorContainer = document.getElementById("storageAccessError");
    const replayForm = document.getElementById("reloadPageForm");
    if (!grantContainer || !(confirmButton instanceof HTMLButtonElement) || !errorContainer) return null;
    if (!(replayForm instanceof HTMLFormElement)) return null;
    if (
      !isUniqueOwnedConnectedElement("grantAccessDiv", grantContainer) ||
      !isUniqueOwnedConnectedElement("requestStorageAccessConfirm", confirmButton) ||
      !isUniqueOwnedConnectedElement("storageAccessError", errorContainer) ||
      !isUniqueOwnedConnectedElement("reloadPageForm", replayForm)
    ) {
      return null;
    }
    if (
      !grantContainer.contains(confirmButton) ||
      !grantContainer.contains(errorContainer) ||
      !grantContainer.contains(replayForm)
    ) {
      return null;
    }
    if ((replayForm.getAttribute("method") || "get").toLowerCase() !== "post") return null;
    const target = (replayForm.getAttribute("target") || "").toLowerCase();
    if (target && target !== "_self") return null;
    const encoding = (replayForm.getAttribute("enctype") || "application/x-www-form-urlencoded").toLowerCase();
    if (encoding !== "application/x-www-form-urlencoded") return null;
    try {
      const actionAttribute = replayForm.getAttribute("action");
      if (typeof actionAttribute !== "string" || !actionAttribute.trim()) return null;
      if (window.location.search || window.location.hash) return null;
      const action = new URL(actionAttribute, window.location.href);
      if (action.protocol !== "https:" || action.username || action.password || action.port) return null;
      if (action.origin !== window.location.origin) return null;
      if (action.pathname !== window.location.pathname || action.search || action.hash) return null;
    } catch {
      return null;
    }
    if (!hasExactReplayFieldSchema(replayForm)) return null;
    return { grantContainer, confirmButton, errorContainer, replayForm };
  }

  function findActivatedStorageAccessInterstitial() {
    const interstitial = findStorageAccessStructure();
    if (!interstitial || !isLocallyDisplayed(interstitial.grantContainer)) return null;
    // SuccessFactors can keep the enclosing authentication iframe at 0 x 0.
    // Only the IAS grant container's own display state determines activation.
    return interstitial;
  }

  async function resumeWithCookieException(resumeAttemptId) {
    if (resumeAttempted) {
      return makeResumeResponse("resume-already-attempted", Boolean(revalidateSourceStructure()));
    }
    let interstitial = revalidateSourceStructure();
    if (!interstitial) return makeResumeResponse("source-changed", false);
    if (typeof document.hasStorageAccess !== "function") return makeCookieExceptionNotActiveResponse();

    try {
      if ((await document.hasStorageAccess()) !== true) return makeCookieExceptionNotActiveResponse();
    } catch {
      return makeCookieExceptionNotActiveResponse();
    }

    // Another continuation may have completed while the read-only access
    // check was pending. Recheck the shared guard and exact form synchronously
    // before claiming the sole submission for this document.
    if (resumeAttempted) {
      return makeResumeResponse("resume-already-attempted", Boolean(revalidateSourceStructure()));
    }
    interstitial = revalidateSourceStructure();
    if (!interstitial) return makeResumeResponse("source-changed", false);
    resumeAttempted = true;
    return makeReplayPlan(interstitial.replayForm, resumeAttemptId);
  }

  function makeReplayPlan(replayForm, resumeAttemptId) {
    return {
      replayForm,
      resumeAttemptId,
      response: {
        ready: true,
        replayScheduled: true,
        code: "replay-scheduled",
        iasOrigin: window.location.origin,
        sourceOrigin
      }
    };
  }

  async function deliverResumeResult(result, resumeAttemptId, sendResponse) {
    if (!result?.replayForm || !result.response) {
      try {
        sendResponse(result);
      } catch {
        // The requesting extension context may have been replaced.
      }
      return;
    }

    // Revalidate the exact source and form immediately before asking the
    // background to cross the durable commit barrier.
    if (result.resumeAttemptId !== resumeAttemptId || !isReplayPlanCurrent(result)) {
      try {
        sendResponse(makeResumeResponse("source-changed", false));
      } catch {
        // The requesting extension context may have been replaced.
      }
      return;
    }

    let releaseReplay;
    const replayGate = new Promise((resolve) => {
      releaseReplay = resolve;
    });
    try {
      // Register exactly one task before the commit request. If the durable ACK
      // is lost, the gate is never released and this task can submit nothing.
      window.setTimeout(() => {
        void replayGate.then(() => submitReplayPlan(result));
      }, 0);
    } catch {
      try {
        sendResponse(makeResumeResponse("resume-interrupted", true));
      } catch {
        // No task was registered and no commit was attempted.
      }
      return;
    }

    const commit = await sendRuntimeMessageForResponse({
      type: "replay-schedule-ready",
      resumeAttemptId
    });
    if (!isExactReplayCommit(commit, resumeAttemptId)) {
      try {
        sendResponse(makeResumeResponse("resume-interrupted", true));
      } catch {
        // The durable barrier was not acknowledged, so no POST is allowed.
      }
      return;
    }

    // The background has atomically terminalized this attempt. The outer
    // channel may now disappear without downgrading that durable result.
    // Release the task only after the outer result has been answered.
    try {
      sendResponse(result.response);
    } catch {
      // The durable commit remains authoritative even if the outer channel is gone.
    }
    releaseReplay();
  }

  function isReplayPlanCurrent(plan) {
    const interstitial = revalidateSourceStructure();
    return Boolean(interstitial && interstitial.replayForm === plan.replayForm);
  }

  function isExactReplayCommit(response, resumeAttemptId) {
    return Boolean(
      response &&
      hasExactKeys(response, ["code", "ok", "resumeAttemptId"]) &&
      response.ok === true &&
      response.code === "replay-schedule-committed" &&
      response.resumeAttemptId === resumeAttemptId
    );
  }

  function submitReplayPlan(plan) {
    const interstitial = revalidateSourceStructure();
    if (!interstitial || interstitial.replayForm !== plan.replayForm) return;
    try {
      // Invoke the browser's native method directly so a named form control or
      // page script cannot replace `form.submit`. The browser serializes the
      // existing fields straight to IAS; the extension never reads their values.
      HTMLFormElement.prototype.submit.call(interstitial.replayForm);
    } catch {
      // The continuation was already acknowledged and must not be retried.
    }
  }

  function revalidateSourceDocument() {
    const interstitial = revalidateSourceStructure();
    if (!interstitial || !isLocallyDisplayed(interstitial.grantContainer)) return null;
    return interstitial;
  }

  function revalidateSourceStructure() {
    if (!isTrustedIasLocation(window.location)) return null;
    if (getTrustedTopLevelOrigin() !== sourceOrigin) return null;
    return findStorageAccessStructure();
  }

  function makeCookieExceptionNotActiveResponse() {
    const ready = Boolean(revalidateSourceStructure());
    return ready
      ? makeResumeResponse("cookie-exception-not-active", true)
      : makeResumeResponse("source-changed", false);
  }

  function makeResumeResponse(code, ready) {
    const response = {
      ready,
      replaySubmitted: false,
      code,
      iasOrigin: window.location.origin,
      sourceOrigin
    };
    if (code === "storage-access-prompt") response.interactionRequired = true;
    return response;
  }

  function isUniqueOwnedConnectedElement(id, element) {
    const matches = document.querySelectorAll(`#${id}`);
    return (
      element.ownerDocument === document &&
      element.isConnected === true &&
      matches.length === 1 &&
      matches[0] === element
    );
  }

  function hasExactReplayFieldSchema(replayForm) {
    const controls = Array.from(replayForm.elements);
    if (controls.length !== REPLAY_FIELD_SCHEMA.size) return false;
    const seen = new Set();
    for (const control of controls) {
      if (String(control.tagName).toLowerCase() !== "input") return false;
      if (control.form !== replayForm || control.disabled) return false;
      const name = control.getAttribute("name");
      const type = (control.getAttribute("type") || "text").toLowerCase();
      if (!REPLAY_FIELD_SCHEMA.has(name) || REPLAY_FIELD_SCHEMA.get(name) !== type || seen.has(name)) return false;
      seen.add(name);
    }
    return seen.size === REPLAY_FIELD_SCHEMA.size;
  }

  function getTrustedTopLevelOrigin() {
    const origins = Array.from(window.location.ancestorOrigins || []);
    if (!origins.length) return null;
    try {
      const top = new URL(origins[origins.length - 1]);
      if (top.protocol !== "https:" || top.username || top.password || top.port) return null;
      const hostname = top.hostname.toLowerCase();
      if (isIasHostOrSubdomain(hostname)) return null;
      const allowed = SUCCESSFACTORS_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
      return allowed ? top.origin : null;
    } catch {
      return null;
    }
  }

  function isTrustedIasLocation(location) {
    const hostname = location.hostname.toLowerCase();
    const allowedParent = IAS_PARENT_DOMAINS.some((parent) => hostname !== parent && hostname.endsWith(`.${parent}`));
    return (
      location.protocol === "https:" &&
      !location.username &&
      !location.password &&
      !location.port &&
      allowedParent
    );
  }

  function isIasHostOrSubdomain(hostname) {
    return IAS_PARENT_DOMAINS.some((parent) => hostname === parent || hostname.endsWith(`.${parent}`));
  }

  function isLocallyDisplayed(element) {
    if (!(element instanceof HTMLElement) || element.hidden) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    return true;
  }

  function hasExactKeys(value, keys) {
    return Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
  }

  function isSafeResumeAttemptId(value) {
    return (
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    );
  }

  function sendRuntimeMessage(message, callback = () => undefined) {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          callback(null);
          return;
        }
        callback(response);
      });
    } catch {
      // The extension may have been reloaded while this document was open.
      callback(null);
    }
  }

  function sendRuntimeMessageForResponse(message) {
    return new Promise((resolve) => sendRuntimeMessage(message, resolve));
  }
})();
