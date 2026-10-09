(function () {
  const REELS_REASON = "Short videos (Reels and Shorts) are blocked";
  const REELS = [
    ["facebook.com", /^\/reels?(\/|$)/i],
    ["instagram.com", /^\/(?:[^/]+\/)?reels?(\/|$)/i],
    ["youtube.com", /^\/shorts(\/|$)/i],
    ["story.snapchat.com", /^\//],
    ["snapchat.com", /^\/(?:spotlight|discover)(\/|$)/i],
  ];
  const LABEL_SITES = [
    "reddit.com", "x.com", "twitter.com", "tiktok.com", "facebook.com",
    "threads.net", "threads.com", "web.telegram.org", "t.me",
  ];
  const LABELS = [
    "NSFW", "18+", "🔞", "Sensitive content", "Content warning",
    "Adult content", "Mature content",
  ];
  const AGE_GATE_LABELS = [
    "I am 18 or older", "I'm 18 or older", "I am over 18", "I'm over 18", "18+ only",
    "website contains adult content", "site contains adult content",
    "contains sexually explicit material",
  ];
  // Matched as a word start; every other term only as a word or its plural,
  // so "cocktails" and "analysis" stay clear.
  const EXPLICIT_PREFIX_TERMS = ["porn", "hentai", "erotic", "fetish"];
  const EXPLICIT_TERMS = [
    "porn", "xxx", "sex", "nude", "naked", "hentai", "nsfw", "milf",
    "fetish", "erotic", "onlyfans", "camgirl", "horny", "slut", "pussy", "cock",
    "boobs", "tits", "anal", "blowjob", "cumshot", "creampie", "gangbang",
  ];
  const MANGA_HINTS = ["manga", "manhwa", "manhua", "webtoon", "toon", "comic"];
  const ADULT_GENRES = ["adult", "smut", "hentai", "erotica", "pornographic", "18+"];

  function onDomain(host, domain) {
    return host === domain || host.endsWith("." + domain);
  }

  function parseWebUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:" ? u : null;
    } catch {
      return null;
    }
  }

  function isReelsUrl(url) {
    const u = parseWebUrl(url);
    return !!u && REELS.some(([domain, path]) => onDomain(u.hostname, domain) && path.test(u.pathname));
  }

  // "18+" inside "2018+" is a year, not a label.
  function hasLabel(lower, label) {
    const l = label.toLowerCase();
    for (let i = lower.indexOf(l); i !== -1; i = lower.indexOf(l, i + 1)) {
      if (!/\d/.test(l[0]) || !/\d/.test(lower[i - 1] || "")) return true;
    }
    return false;
  }

  // Alcohol, vape and game sites gate too, so a gate counts only beside explicit terms.
  function ageGate(lower) {
    const gate = AGE_GATE_LABELS.find((l) => hasLabel(lower, l));
    if (!gate) return null;
    const tokens = lower.split(/[^a-z0-9]+/);
    const terms = EXPLICIT_TERMS.filter((t) =>
      tokens.some((k) => (EXPLICIT_PREFIX_TERMS.includes(t) ? k.startsWith(t) : k === t || k === t + "s"))
    );
    return terms.length >= 2 ? gate : null;
  }

  // A genre tag standing on its own in a tag list, never a word inside a sentence.
  function adultGenre(text) {
    for (const line of text.split(/\r?\n/)) {
      for (const segment of line.split(/[,|/:·•]|\s[-–]\s/)) {
        const tag = segment.trim().toLowerCase();
        if (ADULT_GENRES.includes(tag)) return tag;
      }
    }
    return null;
  }

  // Distinct keywords found; one contained in another hit ("porn" in "pornography") is not counted again.
  function findKeywords(text, keywords) {
    const lower = text.toLowerCase();
    const tokens = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const runs = [];
    let run = "";
    for (const t of tokens) {
      if (t.length === 1) {
        run += t;
        continue;
      }
      if (run.length > 1) runs.push(run);
      run = "";
    }
    if (run.length > 1) runs.push(run);
    const words = new Set(tokens.concat(runs));
    const joined = " " + tokens.concat(runs).join(" ") + " ";
    const spaced = lower.replace(/\s+/g, " ");
    const hits = [];
    for (const raw of keywords) {
      const kw = String(raw).toLowerCase().trim().replace(/\s+/g, " ");
      if (!kw) continue;
      const hit = kw.includes(" ") ? spaced.includes(kw)
        : kw.length <= 3 ? words.has(kw)
        : joined.includes(kw);
      if (hit && !hits.some((h) => h.kw === kw)) hits.push({ raw, kw });
    }
    return hits.filter((h) => !hits.some((o) => o.kw !== h.kw && o.kw.includes(h.kw))).map((h) => h.raw);
  }

  function findKeyword(text, keywords) {
    return findKeywords(text, keywords)[0] ?? null;
  }

  function blockReason(url, text, config) {
    if (isReelsUrl(url)) return REELS_REASON;
    const u = parseWebUrl(url);
    if (!u) return null;
    const host = u.hostname;
    if (config.excludedDomains.some((d) => onDomain(host, String(d).toLowerCase().trim()))) return null;

    const labelSite = LABEL_SITES.some((d) => onDomain(host, d));
    const mangaSite = MANGA_HINTS.some((h) => host.includes(h));
    const lower = text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
    const label = (labelSite && LABELS.find((l) => hasLabel(lower, l))) || ageGate(lower);
    if (label) return `NSFW label "${label}"`;
    const genre = mangaSite && adultGenre(text);
    if (genre) return `Adult genre "${genre}"`;

    let path = u.pathname + " " + u.search;
    try {
      path = decodeURIComponent(path);
    } catch {}
    const urlKeyword = findKeyword(path, config.keywords);
    if (urlKeyword) return `Keyword "${urlKeyword}"`;
    // An article that mentions one keyword is not an adult page; two different ones are.
    const hits = findKeywords(text, config.keywords);
    return hits.length >= (labelSite ? 1 : 2) ? `Keyword "${hits[0]}"` : null;
  }

  const api = { REELS_REASON, isReelsUrl, findKeyword, adultGenre, blockReason };
  globalThis.LibreAscentMatcher = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
