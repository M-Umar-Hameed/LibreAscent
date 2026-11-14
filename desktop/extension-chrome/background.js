importScripts("default-keywords.js", "matcher.js");

const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : []);

// Managed policy adds keywords and exclusions; without one the defaults apply.
const configReady = chrome.storage.managed.get().then(
  (m) => ({ keywords: DEFAULT_ADULT_KEYWORDS.concat(strings(m.keywords)), excludedDomains: strings(m.excludedDomains) }),
  () => ({ keywords: DEFAULT_ADULT_KEYWORDS, excludedDomains: [] }),
);

function block(tabId, reason, url) {
  const page = `${chrome.runtime.getURL("blocked.html")}?reason=${encodeURIComponent(reason)}&url=${encodeURIComponent(url)}`;
  chrome.tabs.update(tabId, { url: page });
}

// The service's blocklist, asked per host. Manifest V3 cannot cancel a request
// from a script, so a blocked host is redirected to the blocked page instead.
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

async function onNavigate(details) {
  if (details.frameId !== 0 || !/^https?:/.test(details.url)) return;
  if (LibreAscentMatcher.isReelsUrl(details.url)) {
    block(details.tabId, LibreAscentMatcher.REELS_REASON, details.url);
    return;
  }
  const host = new URL(details.url).hostname;
  if (await hostBlocked(host)) block(details.tabId, `Blocked site ${host}`, details.url);
}

chrome.webNavigation.onBeforeNavigate.addListener(onNavigate);
chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigate);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "config") {
    configReady.then(sendResponse);
    return true;
  }
  if (msg.type === "block" && sender.tab) block(sender.tab.id, msg.reason, msg.url);
});
