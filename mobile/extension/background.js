// Lists baked into this build; changing them means a new version and a new signing.
const EXTRA_KEYWORDS = ["mydesi", "aagmaal", "manhwa18", "desihub", "desi49", "wataa", "chudai", "mujra"];
const EXCLUDED_DOMAINS = ["mangaread.org", "mangakatana.com", "mgeko.cc", "google.com"];
// Blocked in the browser only; the DNS tunnel does not get these, so the apps that share them keep working.
const BLOCKED_DOMAINS = ["x.com", "twitter.com"];

const config = { keywords: DEFAULT_ADULT_KEYWORDS.concat(EXTRA_KEYWORDS), excludedDomains: EXCLUDED_DOMAINS };

function onDomain(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

function blockedPage(reason, url) {
  return `${browser.runtime.getURL("blocked.html")}?reason=${encodeURIComponent(reason)}&url=${encodeURIComponent(url)}`;
}

function block(tabId, reason, url) {
  browser.tabs.update(tabId, { url: blockedPage(reason, url) });
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const safe = details.type === "main_frame" && LibreAscentMatcher.safeSearchUrl(details.url);
    if (safe) return { redirectUrl: safe };
    const host = new URL(details.url).hostname;
    if (!BLOCKED_DOMAINS.some((d) => onDomain(host, d))) return {};
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
  if (msg.type === "config") return Promise.resolve(config);
  if (msg.type === "block" && sender.tab) block(sender.tab.id, msg.reason, msg.url);
});
