import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  throw new Error(
    "Playwright is required to render Store assets. Install it as a development dependency or expose it through NODE_PATH."
  );
}

const STORE_DIR = resolve("store/assets");
const DOCS_DIR = resolve("docs/images");
const QA_DIR = resolve("qa");
const ICON_SOURCE = resolve("icons/icon-source.svg");
const ICON_DATA_URL = `data:image/svg+xml;base64,${readFileSync(ICON_SOURCE).toString("base64")}`;
const PRODUCT_NAME = "Story Reports Access Helper";
const PRODUCT_VERSION = "1.1.0";
const SUPPORT_ARTICLE = "SAP Knowledge Base article 3039244";
const EDGE_SPEC_URL = "https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension";

const ASSET_SPECS = Object.freeze({
  icon: { width: 300, height: 300, required: true },
  smallPromo: { width: 440, height: 280, required: true },
  largePromo: { width: 1400, height: 560, required: false },
  screenshot: { width: 1280, height: 800, maximumCount: 6, required: false }
});

const SCREENSHOTS = Object.freeze([
  {
    fileName: "screenshot-01-automatic-fix-1280x800.png",
    eyebrow: "CURRENT-PAGE CHECK",
    title: "Open the helper. Know what happens next.",
    description:
      "It checks the active Report Center page first and shows a brief waiting state while it decides whether help is needed.",
    body: automaticFixScene()
  },
  {
    fileName: "screenshot-02-simple-status-1280x800.png",
    eyebrow: "GUIDED FALLBACK",
    title: "One clear button when a manual fix is useful.",
    description:
      "If automatic help has not completed, Fix this report safely retries the active supported page and shows the result.",
    body: simpleStatusScene()
  },
  {
    fileName: "screenshot-03-built-in-help-1280x800.png",
    eyebrow: "CLEAR RESULT",
    title: "See when the browser fix is active.",
    description:
      `Fix applied is shown only for a verified browser fix. ${SUPPORT_ARTICLE} remains one click away.`,
    body: supportScene()
  },
  {
    fileName: "screenshot-04-private-by-design-1280x800.png",
    eyebrow: "FOCUSED BY DESIGN",
    title: "A small helper with a narrow job.",
    description:
      "It runs locally on supported Story Report pages, sends no report data, and never asks for a tenant name or sign-in details.",
    body: privacyScene()
  }
]);

if (SCREENSHOTS.length > ASSET_SPECS.screenshot.maximumCount) {
  throw new Error(`Microsoft Edge permits at most ${ASSET_SPECS.screenshot.maximumCount} screenshots.`);
}

mkdirSync(STORE_DIR, { recursive: true });
mkdirSync(DOCS_DIR, { recursive: true });
mkdirSync(QA_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const validation = [];

try {
  await renderAsset(
    browser,
    "store-icon-300.png",
    ASSET_SPECS.icon,
    `<main class="icon-canvas" data-asset-root data-safe><img src="${ICON_DATA_URL}" alt=""></main>`,
    iconCss(),
    { transparent: true }
  );

  await renderAsset(
    browser,
    "small-promo-440x280.png",
    ASSET_SPECS.smallPromo,
    smallPromoMarkup(),
    commonCss()
  );

  await renderAsset(
    browser,
    "large-promo-1400x560.png",
    ASSET_SPECS.largePromo,
    largePromoMarkup(),
    commonCss()
  );

  for (const screenshot of SCREENSHOTS) {
    await renderAsset(
      browser,
      screenshot.fileName,
      ASSET_SPECS.screenshot,
      screenshotMarkup(screenshot),
      commonCss()
    );
  }

  await renderContactSheet(browser);
} finally {
  await browser.close();
}

for (const fileName of [
  "store-icon-300.png",
  "small-promo-440x280.png",
  "large-promo-1400x560.png",
  ...SCREENSHOTS.map(({ fileName }) => fileName)
]) {
  copyFileSync(resolve(STORE_DIR, fileName), resolve(DOCS_DIR, fileName));
}

writeFileSync(
  resolve(STORE_DIR, "store-assets-validation.json"),
  `${JSON.stringify(
    {
      specification: {
        authority: "Microsoft Edge Developer documentation",
        url: EDGE_SPEC_URL,
        checkedOn: "2026-08-16",
        productVersion: PRODUCT_VERSION,
        assetSpecs: ASSET_SPECS
      },
      contentSafety: {
        source: "Deterministic HTML/CSS composition",
        realCustomerData: false,
        realHostnames: false,
        realPeople: false,
        realReportNames: false,
        thirdPartyLogos: false,
        logoSource: "icons/icon-source.svg"
      },
      results: validation
    },
    null,
    2
  )}\n`
);

console.log(`Generated ${validation.length} public-safe Microsoft Edge marketing assets.`);
console.log(`Store assets: ${STORE_DIR}`);
console.log(`Public documentation copies: ${DOCS_DIR}`);
console.log(`Public-safe validation report: ${resolve(STORE_DIR, "store-assets-validation.json")}`);

async function renderAsset(browserInstance, fileName, dimensions, body, styles, options = {}) {
  const { width, height } = dimensions;
  const page = await browserInstance.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1
  });

  try {
    await page.setContent(`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <style>${styles}</style>
        </head>
        <body>${body}</body>
      </html>`);
    await page.evaluate(() => document.fonts.ready);

    const layout = await page.evaluate(({ expectedWidth, expectedHeight }) => {
      const root = document.querySelector("[data-asset-root]");
      if (!root) return { valid: false, reason: "missing data-asset-root" };

      const rootRect = root.getBoundingClientRect();
      const safeElements = [...document.querySelectorAll("[data-safe]")];
      const clipped = safeElements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            className: element.className || "",
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom
          };
        })
        .filter((rect) =>
          rect.left < -0.5 ||
          rect.top < -0.5 ||
          rect.right > expectedWidth + 0.5 ||
          rect.bottom > expectedHeight + 0.5
        );

      return {
        valid:
          Math.abs(rootRect.width - expectedWidth) < 0.5 &&
          Math.abs(rootRect.height - expectedHeight) < 0.5 &&
          document.documentElement.scrollWidth === expectedWidth &&
          document.documentElement.scrollHeight === expectedHeight &&
          clipped.length === 0,
        rootWidth: rootRect.width,
        rootHeight: rootRect.height,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        checkedSafeElements: safeElements.length,
        clipped
      };
    }, { expectedWidth: width, expectedHeight: height });

    if (!layout.valid) {
      throw new Error(`${fileName} did not pass layout safety checks: ${JSON.stringify(layout)}`);
    }

    await page.screenshot({
      path: resolve(STORE_DIR, fileName),
      type: "png",
      animations: "disabled",
      omitBackground: options.transparent === true
    });

    validation.push({
      fileName,
      width,
      height,
      sha256: createHash("sha256")
        .update(readFileSync(resolve(STORE_DIR, fileName)))
        .digest("hex"),
      overflowFree: true,
      safeBounds: true,
      checkedSafeElements: layout.checkedSafeElements
    });
  } finally {
    await page.close();
  }
}

async function renderContactSheet(browserInstance) {
  const cards = SCREENSHOTS.map(({ fileName }, index) => {
    const dataUrl = `data:image/png;base64,${readFileSync(resolve(STORE_DIR, fileName)).toString("base64")}`;
    return `<figure data-safe>
      <img src="${dataUrl}" alt="">
      <figcaption>${index + 1}. ${fileName}</figcaption>
    </figure>`;
  }).join("");

  const page = await browserInstance.newPage({ viewport: { width: 1600, height: 1120 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}html,body{margin:0;width:1600px;height:1120px;overflow:hidden}
      body{font-family:Arial,Helvetica,sans-serif;background:#eaf0f6;color:#10243d;padding:38px}
      main{display:grid;grid-template-columns:1fr 1fr;gap:30px;width:1524px;height:1044px}
      figure{margin:0;padding:14px;border:1px solid #c7d4e3;border-radius:18px;background:#fff;box-shadow:0 14px 32px rgb(15 38 64 / 10%)}
      img{display:block;width:718px;height:449px;object-fit:cover;border-radius:10px}
      figcaption{height:47px;padding:15px 4px 0;font-size:15px;font-weight:700;color:#435a73}
    </style></head><body><main>${cards}</main></body></html>`);
    await page.screenshot({ path: resolve(QA_DIR, "store-assets-contact-sheet.png"), animations: "disabled" });
  } finally {
    await page.close();
  }
}

function screenshotMarkup({ eyebrow, title, description, body }) {
  return `<main class="screenshot" data-asset-root>
    <section class="story-copy" data-safe>
      ${brandMarkup("brand-wide")}
      <p class="eyebrow">${eyebrow}</p>
      <h1>${title}</h1>
      <p class="description">${description}</p>
      <div class="trust-line"><span></span>Works automatically <b>·</b> No report data sent</div>
    </section>
    <section class="visual-stage" data-safe>${body}</section>
  </main>`;
}

function automaticFixScene() {
  return `<div class="abstract-report" data-safe>
    <div class="report-top"><span>REPORT CENTER</span><i></i><i></i><i></i></div>
    <div class="report-grid">
      <div class="metric checking-metric"><small>CURRENT PAGE</small><strong>Checking…</strong></div>
      <div class="chart-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="report-lines" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    </div>
    <div class="recovery-badge checking-badge" data-safe><span></span><div><strong>Assessing this page</strong><small>A result appears automatically</small></div></div>
    ${popupMarkup("checking", "Checking this page…", "Please wait a moment.")}
  </div>`;
}

function simpleStatusScene() {
  return `<div class="manual-scene" data-safe>
    <div class="manual-context" data-safe>
      <span class="manual-context-label">ACTIVE REPORT CENTER PAGE</span>
      <div class="manual-context-window">
        <i></i><i></i><i></i>
        <div class="manual-context-lines"><b></b><b></b><b></b></div>
      </div>
      <div class="manual-callout"><span>1</span><p><strong>Shown only when useful</strong>The button stays hidden while checking, working, or already fixed.</p></div>
      <div class="manual-callout"><span>2</span><p><strong>One safe page refresh</strong>The result is shown before the supported page refreshes.</p></div>
    </div>
    ${popupMarkup("fix", "Fix not applied", "Use Fix this report, then open the Story again.", { showFix: true })}
  </div>`;
}

function supportScene() {
  return `<div class="support-scene" data-safe>
    ${popupMarkup("fixed", "Fix applied", "The browser fix is active. Return to your report.")}
    <div class="link-bridge" aria-hidden="true"><i></i><i></i><i></i></div>
    <article class="kb-card" data-safe>
      <div class="kb-document"><span>?</span></div>
      <p>OFFICIAL SUPPORT</p>
      <h2>SAP Knowledge Base</h2>
      <strong>Article 3039244</strong>
      <div class="kb-action">Open help article <span>↗</span></div>
    </article>
  </div>`;
}

function privacyScene() {
  const items = [
    ["◉", "Runs locally", "The helper works in the browser."],
    ["◇", "No report data sent", "Report content never leaves the page."],
    ["⌁", "No tenant details", "Nothing needs to be entered."],
    ["✓", "One focused job", "Only supported Story pages are handled."]
  ];
  return `<div class="privacy-grid" data-safe>${items.map(([icon, title, text]) => `
    <article class="privacy-card"><span>${icon}</span><strong>${title}</strong><p>${text}</p></article>`).join("")}
    <div class="privacy-summary" data-safe><span>✓</span><strong>Automatic help, without the noise.</strong></div>
  </div>`;
}

function popupMarkup(mode, title, detail, { showFix = false } = {}) {
  const fixAction = showFix
    ? `<div class="popup-fix-action">
        <div class="popup-button primary">Fix this report</div>
        <p>Use this if the Story Report stays blank.</p>
      </div>`
    : "";

  return `<article class="popup-card ${mode}" data-safe>
    ${brandMarkup("popup-brand")}
    <div class="popup-status"><span></span><div><strong>${title}</strong><p>${detail}</p></div></div>
    <div class="popup-actions">
      ${fixAction}
      <div class="popup-button secondary">Open SAP help article</div>
    </div>
    <footer><span>Automatic help · No report data sent</span><b>v${PRODUCT_VERSION}</b></footer>
  </article>`;
}

function smallPromoMarkup() {
  return `<main class="small-promo" data-asset-root>
    <div class="small-brand" data-safe><img src="${ICON_DATA_URL}" alt=""><div><strong>Story Reports</strong><span>Access Helper</span></div></div>
    <h1 data-safe>Automatic help.<br>One clear fallback.</h1>
    <div class="small-check" data-safe><span>✓</span> Guided browser access</div>
  </main>`;
}

function largePromoMarkup() {
  return `<main class="large-promo" data-asset-root>
    <section class="large-copy" data-safe>
      ${brandMarkup("brand-wide")}
      <p class="eyebrow">AUTOMATIC AND GUIDED</p>
      <h1>Open Story reports with one clear fallback.</h1>
      <p>The helper checks the current page, works automatically, and offers one safe retry only when useful.</p>
    </section>
    <section class="large-visual" data-safe>
      <div class="abstract-sheet"><i></i><i></i><i></i><div class="mini-chart"><b></b><b></b><b></b><b></b></div></div>
      ${popupMarkup("fixed", "Fix applied", "The browser fix is active. Return to your report.")}
    </section>
  </main>`;
}

function brandMarkup(className) {
  return `<div class="${className}" data-safe><img src="${ICON_DATA_URL}" alt=""><div><strong>${PRODUCT_NAME}</strong><span>for SAP SuccessFactors</span></div></div>`;
}

function iconCss() {
  return `*{box-sizing:border-box}html,body{margin:0;width:300px;height:300px;overflow:hidden;background:transparent}.icon-canvas,.icon-canvas img{display:block;width:300px;height:300px}`;
}

function commonCss() {
  return `
    :root{color-scheme:light;--navy:#10243d;--navy-2:#193653;--blue:#0874d8;--blue-2:#0a5cae;--green:#168b52;--mint:#dff6e9;--ice:#edf5fc;--paper:#fff;--muted:#52677d;--line:#ccd9e6}
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
    body{font-family:Arial,Helvetica,sans-serif;color:var(--navy);-webkit-font-smoothing:antialiased}
    .screenshot{display:grid;grid-template-columns:520px 760px;width:1280px;height:800px;background:linear-gradient(135deg,#f8fbff 0%,#eaf3fb 100%)}
    .story-copy{position:relative;z-index:2;display:flex;flex-direction:column;justify-content:center;height:800px;padding:70px 54px 68px 64px;background:linear-gradient(150deg,#0d2036 0%,#102d4a 100%);color:#fff}
    .brand-wide,.popup-brand{display:flex;align-items:center;gap:14px}.brand-wide img{width:58px;height:58px}.brand-wide div,.popup-brand div{display:flex;flex-direction:column}.brand-wide strong{font-size:20px;line-height:1.2}.brand-wide span{margin-top:4px;color:#b9ccdf;font-size:14px}
    .eyebrow{margin:70px 0 14px;color:#78c7ff;font-size:13px;font-weight:800;letter-spacing:1.7px}
    .story-copy h1{margin:0;max-width:410px;font-size:45px;line-height:1.08;letter-spacing:-1.2px}.story-copy .description{margin:24px 0 0;max-width:400px;color:#cbd9e7;font-size:20px;line-height:1.47}
    .trust-line{display:flex;align-items:center;gap:9px;margin-top:42px;color:#d8e5f0;font-size:14px;font-weight:700}.trust-line>span{width:10px;height:10px;border-radius:50%;background:#3dcc80;box-shadow:0 0 0 5px rgb(61 204 128 / 13%)}.trust-line b{color:#6f87a0}
    .visual-stage{position:relative;display:flex;align-items:center;justify-content:center;width:760px;height:800px;overflow:hidden;padding:46px;background:radial-gradient(circle at 70% 24%,#d3e9fb 0,transparent 38%),linear-gradient(140deg,#edf6fc,#dfeaf4)}
    .abstract-report{position:relative;width:668px;height:620px;border:1px solid #c4d4e3;border-radius:26px;background:#fff;box-shadow:0 28px 64px rgb(28 61 91 / 18%);overflow:hidden}
    .report-top{display:flex;align-items:center;height:62px;padding:0 24px;border-bottom:1px solid #dbe5ee;background:#f8fbfe;color:#5d7288;font-size:12px;font-weight:800;letter-spacing:1.2px}.report-top span{margin-right:auto}.report-top i{width:9px;height:9px;margin-left:8px;border-radius:50%;background:#ccd9e6}
    .report-grid{display:grid;grid-template-columns:1fr 1.4fr;gap:22px;padding:34px}.metric,.chart-bars,.report-lines{border:1px solid #dbe5ee;border-radius:17px;background:#f9fbfd}.metric{display:flex;flex-direction:column;justify-content:center;height:140px;padding:24px}.metric small{color:#72869a;font-size:11px;font-weight:800;letter-spacing:1px}.metric strong{margin-top:12px;color:var(--green);font-size:31px}.checking-metric strong{color:var(--blue);font-size:24px}.chart-bars{display:flex;align-items:flex-end;gap:14px;height:140px;padding:28px 24px 22px}.chart-bars i{flex:1;border-radius:7px 7px 2px 2px;background:linear-gradient(#4aa5ee,#0874d8)}.chart-bars i:nth-child(1){height:36%}.chart-bars i:nth-child(2){height:62%}.chart-bars i:nth-child(3){height:48%}.chart-bars i:nth-child(4){height:83%}.chart-bars i:nth-child(5){height:71%}.report-lines{grid-column:1/-1;height:156px;padding:24px}.report-lines i{display:block;height:12px;margin-bottom:14px;border-radius:999px;background:#e1eaf2}.report-lines i:nth-child(1){width:82%}.report-lines i:nth-child(2){width:65%}.report-lines i:nth-child(3){width:89%}.report-lines i:nth-child(4){width:51%}
    .recovery-badge{position:absolute;left:28px;bottom:27px;display:flex;align-items:center;gap:12px;padding:13px 18px;border:1px solid #b8e1ca;border-radius:14px;background:#f0fbf5;box-shadow:0 10px 24px rgb(22 139 82 / 12%)}.recovery-badge>span{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--green);color:#fff;font-weight:900}.recovery-badge div{display:flex;flex-direction:column}.recovery-badge strong{font-size:13px}.recovery-badge small{margin-top:3px;color:#4f6c5e;font-size:11px}.checking-badge{border-color:#b8d8f3;background:#eff8ff;box-shadow:0 10px 24px rgb(8 116 216 / 12%)}.checking-badge>span{position:relative;background:var(--blue)}.checking-badge>span::after{content:"";width:8px;height:8px;border:2px solid #fff;border-top-color:transparent;border-radius:50%}.checking-badge small{color:#4d6981}
    .popup-card{position:absolute;width:352px;padding:18px;border:1px solid #b9cbdb;border-radius:16px;background:linear-gradient(155deg,#fff,#f2f7fb);box-shadow:0 24px 55px rgb(16 36 61 / 24%);color:var(--navy)}.abstract-report>.popup-card{right:24px;bottom:24px}.popup-brand img{width:46px;height:46px}.popup-brand{gap:11px}.popup-brand strong{font-size:15px;line-height:1.2}.popup-brand span{margin-top:3px;color:#63778b;font-size:11px}.popup-status{display:grid;grid-template-columns:11px 1fr;gap:11px;min-height:76px;margin-top:15px;padding:13px;border:1px solid #c7d6e4;border-radius:11px;background:rgb(255 255 255 / 82%)}.popup-status>span{width:10px;height:10px;margin-top:4px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgb(22 139 82 / 13%)}.popup-card.checking .popup-status>span{background:var(--blue);box-shadow:0 0 0 4px rgb(8 116 216 / 13%)}.popup-card.fix .popup-status>span{background:#b56a00;box-shadow:0 0 0 4px rgb(181 106 0 / 13%)}.popup-status strong{font-size:13px}.popup-status p{margin:4px 0 0;color:#52677d;font-size:11px;line-height:1.4}.popup-actions{margin-top:12px}.popup-button{display:flex;align-items:center;justify-content:center;min-height:40px;border-radius:8px;font-size:12px;font-weight:800}.popup-button.primary{background:linear-gradient(#0a76db,#0867c0);color:#fff;box-shadow:0 5px 12px rgb(8 103 192 / 16%)}.popup-button.secondary{border:1px solid #92a5b9;background:rgb(255 255 255 / 72%);color:#134f86}.popup-fix-action p{margin:6px 2px 10px;color:#52677d;font-size:10px;line-height:1.35}.popup-card footer{display:flex;justify-content:space-between;gap:10px;margin-top:13px;padding-top:10px;border-top:1px solid #d7e2ec;color:#6b7f92;font-size:9px}.popup-card footer b{flex:none}
    .manual-scene{position:relative;width:668px;height:620px;border:1px solid #c4d4e3;border-radius:26px;background:linear-gradient(140deg,#fff,#f5f9fc);box-shadow:0 28px 64px rgb(28 61 91 / 18%);overflow:hidden}.manual-scene>.popup-card{right:31px;top:50%;width:360px;transform:translateY(-50%)}.manual-context{position:absolute;top:52px;bottom:52px;left:35px;width:226px;padding:22px;border:1px solid #d2deea;border-radius:20px;background:#f8fbfe}.manual-context-label{color:#60768b;font-size:9px;font-weight:900;letter-spacing:1.05px}.manual-context-window{position:relative;height:138px;margin-top:15px;padding:17px;border:1px solid #cddae6;border-radius:13px;background:#fff}.manual-context-window>i{display:inline-block;width:7px;height:7px;margin-right:4px;border-radius:50%;background:#c9d6e2}.manual-context-lines{margin-top:22px}.manual-context-lines b{display:block;height:9px;margin-top:10px;border-radius:999px;background:#dfe8f0}.manual-context-lines b:nth-child(2){width:78%}.manual-context-lines b:nth-child(3){width:58%}.manual-callout{display:grid;grid-template-columns:27px 1fr;gap:10px;margin-top:18px}.manual-callout>span{display:grid;place-items:center;width:27px;height:27px;border-radius:50%;background:#e2f1fc;color:#0870ce;font-size:11px;font-weight:900}.manual-callout p{margin:0;color:#60758a;font-size:10px;line-height:1.35}.manual-callout strong{display:block;margin-bottom:3px;color:var(--navy);font-size:11px}
    .support-scene{position:relative;display:flex;align-items:center;justify-content:space-between;width:668px;height:620px;padding:56px 44px;border:1px solid #c4d4e3;border-radius:26px;background:#fff;box-shadow:0 28px 64px rgb(28 61 91 / 18%)}.support-scene .popup-card{position:relative;width:310px}.link-bridge{display:flex;gap:5px;width:42px}.link-bridge i{width:6px;height:6px;border-radius:50%;background:#8fc1e8}.kb-card{width:225px;padding:25px 22px;border:1px solid #c9d8e6;border-radius:20px;background:linear-gradient(150deg,#f8fbfe,#edf6fc);box-shadow:0 14px 34px rgb(16 36 61 / 11%)}.kb-document{display:grid;place-items:center;width:58px;height:68px;border-radius:11px 11px 17px 11px;background:linear-gradient(145deg,#1179d8,#075cae);box-shadow:0 10px 20px rgb(10 110 209 / 18%)}.kb-document span{display:grid;place-items:center;width:29px;height:29px;border:2px solid #fff;border-radius:50%;color:#fff;font-size:18px;font-weight:900}.kb-card>p{margin:24px 0 8px;color:#0870ce;font-size:10px;font-weight:900;letter-spacing:1.25px}.kb-card h2{margin:0;font-size:22px;line-height:1.16}.kb-card>strong{display:block;margin-top:9px;color:#536b82;font-size:14px}.kb-action{display:flex;justify-content:space-between;margin-top:27px;padding-top:16px;border-top:1px solid #cbd9e5;color:#096bc6;font-size:12px;font-weight:800}.kb-action span{font-size:15px}
    .privacy-grid{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:18px;width:668px;height:620px;padding:50px 48px 142px;border:1px solid #c4d4e3;border-radius:26px;background:#fff;box-shadow:0 28px 64px rgb(28 61 91 / 18%)}.privacy-card{display:flex;flex-direction:column;padding:24px;border:1px solid #d4e0ea;border-radius:18px;background:#f8fbfe}.privacy-card>span{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:#e2f1fc;color:#0870ce;font-size:20px;font-weight:900}.privacy-card strong{margin-top:18px;font-size:15px}.privacy-card p{margin:8px 0 0;color:#62778b;font-size:12px;line-height:1.4}.privacy-summary{position:absolute;right:48px;bottom:47px;left:48px;display:flex;align-items:center;gap:15px;padding:18px 22px;border:1px solid #b8e1ca;border-radius:15px;background:#effaf4;color:#135d38}.privacy-summary>span{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--green);color:#fff;font-weight:900}.privacy-summary strong{font-size:15px}
    .small-promo{position:relative;width:440px;height:280px;padding:29px 31px;overflow:hidden;background:linear-gradient(145deg,#0d2036,#123c62);color:#fff}.small-promo::after{content:"";position:absolute;right:-62px;bottom:-82px;width:235px;height:235px;border:45px solid rgb(97 184 247 / 15%);border-radius:50%}.small-brand{display:flex;align-items:center;gap:12px}.small-brand img{width:48px;height:48px}.small-brand div{display:flex;flex-direction:column}.small-brand strong{font-size:17px}.small-brand span{margin-top:2px;color:#b9d0e3;font-size:13px}.small-promo h1{position:relative;z-index:2;margin:31px 0 0;font-size:32px;line-height:1.08;letter-spacing:-.5px}.small-check{position:absolute;z-index:2;right:26px;bottom:24px;display:flex;align-items:center;gap:8px;color:#dbebf7;font-size:11px;font-weight:700}.small-check span{display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:#28a869;color:#fff;font-weight:900}
    .large-promo{display:grid;grid-template-columns:735px 665px;width:1400px;height:560px;overflow:hidden;background:linear-gradient(140deg,#0c1f35,#123c62);color:#fff}.large-copy{display:flex;flex-direction:column;justify-content:center;padding:58px 55px 58px 74px}.large-copy .eyebrow{margin:55px 0 12px}.large-copy h1{max-width:610px;margin:0;font-size:49px;line-height:1.06;letter-spacing:-1px}.large-copy>p:last-child{max-width:610px;margin:19px 0 0;color:#c7d9e8;font-size:18px;line-height:1.4}.large-visual{position:relative;overflow:hidden;background:radial-gradient(circle at 60% 38%,#3779ac 0,transparent 47%)}.abstract-sheet{position:absolute;right:44px;top:52px;width:510px;height:390px;padding:39px;border:1px solid rgb(255 255 255 / 18%);border-radius:28px;background:rgb(255 255 255 / 10%);transform:rotate(2deg)}.abstract-sheet>i{display:block;width:54%;height:10px;margin-bottom:16px;border-radius:999px;background:rgb(255 255 255 / 23%)}.abstract-sheet>i:nth-child(2){width:38%}.abstract-sheet>i:nth-child(3){width:66%}.mini-chart{display:flex;align-items:flex-end;gap:16px;height:190px;margin-top:25px;padding:25px;border-radius:18px;background:rgb(6 35 59 / 25%)}.mini-chart b{width:52px;border-radius:9px 9px 3px 3px;background:linear-gradient(#79c8ff,#1f94ed)}.mini-chart b:nth-child(1){height:37%}.mini-chart b:nth-child(2){height:62%}.mini-chart b:nth-child(3){height:48%}.mini-chart b:nth-child(4){height:83%}.large-visual .popup-card{right:66px;bottom:35px;width:325px;transform:rotate(-1deg)}
  `;
}
