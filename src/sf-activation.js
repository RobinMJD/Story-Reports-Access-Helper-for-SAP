(() => {
  "use strict";

  const BUILD = "1.0.0";
  const PROTOCOL = 1;
  const SENTINEL_KEY = "__sapStoryAccessActivation_1_0_0_p1__";

  if (window.top !== window || globalThis[SENTINEL_KEY] === true) return;
  Object.defineProperty(globalThis, SENTINEL_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id) return false;
    if (
      !message ||
      typeof message !== "object" ||
      Object.keys(message).sort().join("\u0000") !== "build\u0000protocol\u0000type" ||
      message.type !== "sf-activation-probe" ||
      message.build !== BUILD ||
      message.protocol !== PROTOCOL
    ) {
      return false;
    }
    sendResponse({
      type: "sf-activation-current",
      build: BUILD,
      protocol: PROTOCOL
    });
    return false;
  });

  // A newly loaded current-build top page hands a durable pending reload
  // claim over to the normal IAS workflow. Existing pages do not acquire this
  // script until a navigation, and the background still validates the exact
  // sender context and fixed Story route before changing state.
  try {
    const ready = chrome.runtime.sendMessage({
      type: "sf-activation-ready",
      build: BUILD,
      protocol: PROTOCOL
    });
    if (ready && typeof ready.catch === "function") void ready.catch(() => undefined);
  } catch {
    // A missing/restarting worker leaves the pending claim fail closed.
  }
})();
