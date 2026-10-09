const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : []);

// No managed policy means LibreAscent is not enforcing, so a copy left behind
// after uninstall stays inert.
const configReady = browser.storage.managed.get().then(
  (m) => ({ keywords: DEFAULT_ADULT_KEYWORDS.concat(strings(m.keywords)), excludedDomains: strings(m.excludedDomains) }),
  () => ({ inert: true }),
);

function blockedPage(reason, url) {
  return `${browser.runtime.getURL("blocked.html")}?reason=${encodeURIComponent(reason)}&url=${encodeURIComponent(url)}`;
}

function block(tabId, reason, url) {
  configReady.then((c) => {
    if (c.inert) return;
    browser.tabs.update(tabId, { url: blockedPage(reason, url) });
  });
}

// The service's blocklist, asked per host. DNS normally enforces it, but a VPN
// app takes DNS over; this keeps blocked sites blocked in the browser then.
const CHECK_URL = "http://127.0.0.1:47713/check?host=";
const VERDICT_TTL_MS = 10 * 60 * 1000;
const verdicts = new Map();

async function hostBlocked(host) {
  const cached = verdicts.get(host);
  if (cached && Date.now() - cached.at < VERDICT_TTL_MS) return cached.blocked;
  let blocked = false;
  try {
    const response = await fetch(CHECK_URL + encodeURIComponent(host), { signal: AbortSignal.timeout(1500) });
    blocked = (await response.text()) === "1";
  } catch {
    return false;
  }
  if (verdicts.size > 5000) verdicts.clear();
  verdicts.set(host, { blocked, at: Date.now() });
  return blocked;
}

browser.webRequest.onBeforeRequest.addListener(
  async (details) => {
    if ((await configReady).inert) return {};
    const host = new URL(details.url).hostname;
    if (!(await hostBlocked(host))) return {};
    if (details.type === "main_frame") block(details.tabId, `Blocked site ${host}`, details.url);
    return { cancel: true };
  },
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame", "sub_frame"] },
  ["blocking"],
);

function onNavigate(details) {
  if (details.frameId === 0 && LibreAscentMatcher.isReelsUrl(details.url)) {
    block(details.tabId, LibreAscentMatcher.REELS_REASON, details.url);
  }
}

browser.webNavigation.onBeforeNavigate.addListener(onNavigate);
browser.webNavigation.onHistoryStateUpdated.addListener(onNavigate);

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "config") return configReady;
  if (msg.type === "block" && sender.tab) block(sender.tab.id, msg.reason, msg.url);
});
