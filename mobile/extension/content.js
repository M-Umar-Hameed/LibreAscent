let config = null;
let timer = null;
let lastRun = 0;
let blocked = false;

function check() {
  timer = null;
  lastRun = Date.now();
  if (blocked || !config || !document.body) return;
  const text = document.title + "\n" + document.body.innerText.slice(-200000);
  const reason = LibreAscentMatcher.blockReason(location.href, text, config);
  if (reason) {
    blocked = true;
    browser.runtime.sendMessage({ type: "block", reason, url: location.href });
  }
}

function schedule() {
  if (!timer) timer = setTimeout(check, Math.max(0, lastRun + 1000 - Date.now()));
}

// Without a policy the background answers inert and nothing is scanned.
function loadConfig() {
  browser.runtime.sendMessage({ type: "config" }).then((c) => {
    if (!c) throw new Error("no config");
    config = c.inert ? null : c;
    check();
  }).catch(() => {
    if (!config) {
      config = { keywords: DEFAULT_ADULT_KEYWORDS, excludedDomains: [] };
      check();
    }
    setTimeout(loadConfig, 500);
  });
}

loadConfig();
new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});
