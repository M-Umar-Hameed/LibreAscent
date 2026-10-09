const test = require("node:test");
const assert = require("node:assert");
require("./default-keywords.js");
const { isReelsUrl, findKeyword, adultGenre, blockReason, REELS_REASON } = require("./matcher.js");

const config = {
  keywords: globalThis.DEFAULT_ADULT_KEYWORDS.concat(["gambling", "hot singles"]),
  excludedDomains: ["example.org"],
};

test("reels and shorts URLs are blocked", () => {
  for (const url of [
    "https://www.facebook.com/reel/123456",
    "https://m.facebook.com/reels/",
    "https://facebook.com/reels",
    "https://www.instagram.com/reel/Cabc/",
    "https://instagram.com/reels/xyz",
    "https://www.youtube.com/shorts/abc123",
    "https://m.youtube.com/shorts/abc123",
    "https://www.instagram.com/someuser/reel/Cabc/",
    "https://www.instagram.com/someuser/reels/",
    "https://www.snapchat.com/spotlight/abc",
    "https://www.snapchat.com/discover/xyz",
    "https://snapchat.com/spotlight",
    "https://story.snapchat.com/p/abc",
  ]) assert.ok(isReelsUrl(url), url);
});

test("video posts, tiktok and lookalike hosts are allowed", () => {
  for (const url of [
    "https://www.facebook.com/somepage/videos/123",
    "https://www.facebook.com/watch?v=123",
    "https://www.facebook.com/reelsfan",
    "https://www.youtube.com/watch?v=abc",
    "https://www.tiktok.com/@user/video/1",
    "https://notyoutube.com/shorts/abc",
    "https://youtube.com.evil.org/shorts/abc",
    "https://fakeinstagram.com/reel/x",
    "https://www.instagram.com/someuser/p/Cabc/",
    "https://www.instagram.com/someuser/",
    "https://web.snapchat.com/",
    "https://www.snapchat.com/add/x",
    "not a url",
  ]) assert.ok(!isReelsUrl(url), url);
  assert.strictEqual(blockReason("https://www.youtube.com/shorts/x", "", config), REELS_REASON);
});

test("labels only block on listed sites", () => {
  assert.match(blockReason("https://old.reddit.com/r/pics", "post marked nsfw", config), /NSFW/);
  assert.match(blockReason("https://x.com/home", "Content warning: something", config), /Content warning/);
  assert.match(blockReason("https://t.me/chan", "🔞 inside", config), /label/);
  assert.strictEqual(blockReason("https://news.example.com/", "Mature content for 18+ readers", config), null);
  assert.strictEqual(blockReason("https://notreddit.com/", "Sensitive content", config), null);
});

test("18+ after a digit is not a label", () => {
  assert.match(blockReason("https://www.reddit.com/r/x", "Rated 18+", config), /18\+/);
  assert.strictEqual(blockReason("https://www.reddit.com/r/x", "Best of 2018+ season recap", config), null);
});

test("age gates block only beside explicit terms on all sites", () => {
  const none = { keywords: [], excludedDomains: [] };
  const explicit = "\nFree porn videos and nude cams";
  for (const text of [
    "Please confirm: I AM 18 OR OLDER",
    "I’m 18 or older - Enter",
    "Click if you are i'm over 18",
    "18+ only. Leave now",
    "This website contains adult content",
    "Warning: contains sexually explicit material",
  ]) {
    assert.match(blockReason("https://unknown.example.net/", text + explicit, none), /label/, text);
    assert.strictEqual(blockReason("https://unknown.example.net/", text, none), null, text);
  }
  assert.strictEqual(blockReason("https://beer.example.net/", "Craft beer shop\nI am 18 or older - Enter", config), null);
  assert.strictEqual(
    blockReason("https://films.example.net/", "Review: the film contains sexually explicit material and strong language.", config),
    null,
  );
  assert.strictEqual(blockReason("https://unknown.example.net/", "Win 2018+ only today" + explicit, none), null);
  assert.strictEqual(
    blockReason(
      "https://en.wikipedia.org/wiki/Pornography",
      "Pornography (colloquially called porn) is sexually explicit material intended for adults.",
      none,
    ),
    null,
  );
  assert.strictEqual(blockReason("https://example.org/", "I am over 18", config), null);
});

test("short keywords must be whole tokens or spaced letters", () => {
  assert.strictEqual(findKeyword("Watch xxx videos", ["xxx"]), "xxx");
  assert.strictEqual(findKeyword("Watch x x x videos", ["xxx"]), "xxx");
  assert.strictEqual(findKeyword("x.x.x", ["xxx"]), "xxx");
  assert.strictEqual(findKeyword("call 555-XXX-1234", ["xxx"]), "xxx");
  assert.strictEqual(findKeyword("xxxl t-shirts", ["xxx"]), null);
});

test("long keywords match inside tokens and across spacing", () => {
  assert.strictEqual(findKeyword("best PornHub clips", ["pornhub"]), "pornhub");
  assert.strictEqual(findKeyword("free p o r n here", ["porn"]), "porn");
  assert.strictEqual(findKeyword("p.o.r.n", ["porn"]), "porn");
  assert.strictEqual(findKeyword("p-o-r-n", ["porn"]), "porn");
  assert.strictEqual(findKeyword("perfectly fine text", ["porn"]), null);
});

test("long keywords do not match across word boundaries", () => {
  const kws = globalThis.DEFAULT_ADULT_KEYWORDS;
  assert.strictEqual(findKeyword("Shop ornaments", kws), null);
  assert.strictEqual(findKeyword("Ever since starting", kws), null);
  assert.strictEqual(findKeyword("Three something", kws), null);
  assert.strictEqual(findKeyword("a b porn", ["abporn"]), null);
});

test("multi-word keywords match normalised text", () => {
  assert.strictEqual(findKeyword("meet HOT\n  singles now", ["hot singles"]), "hot singles");
  assert.strictEqual(findKeyword("hotsingles", ["hot singles"]), null);
});

test("page text needs two different keywords on ordinary sites", () => {
  assert.strictEqual(
    blockReason("https://en.wikipedia.org/wiki/Internet", "Early web traffic included porn among many other things.", config),
    null,
  );
  assert.strictEqual(blockReason("https://blog.example.com/", "Pornography and its history", config), null);
  assert.match(blockReason("https://blog.example.com/", "online gambling and hentai", config), /gambling|hentai/);
  assert.strictEqual(blockReason("https://blog.example.com/", "a cooking recipe", config), null);
});

test("one keyword blocks in the URL and on label sites, not on manga sites", () => {
  assert.match(blockReason("https://search.example.com/search?q=hentai", "results", config), /hentai/);
  assert.match(blockReason("https://search.example.com/search?q=free%20porn", "results", config), /porn/);
  assert.match(blockReason("https://www.reddit.com/r/x", "a porn link", config), /porn/);
  assert.equal(blockReason("https://www.mangaread.org/x", "a porn link", config), null);
});

test("manga sites block on standalone adult genre tags", () => {
  assert.strictEqual(adultGenre("Genres :\nAction\nSmut\nRomance"), "smut");
  assert.strictEqual(adultGenre("Genres: Action - Adult - Drama"), "adult");
  assert.strictEqual(adultGenre("Comedy, 18+, Slice of life"), "18+");
  assert.strictEqual(adultGenre("Tags: Action – Hentai"), "hentai");
  assert.strictEqual(adultGenre("Genres: Action - Adventure - Fantasy"), null);
  assert.strictEqual(adultGenre("A young adult hero discovers smut is not his calling."), null);

  const none = { keywords: [], excludedDomains: [] };
  assert.match(blockReason("https://www.nelomanga.net/manga/x", "Genres :\nAction\nSmut", none), /smut/);
  assert.match(blockReason("https://asuracomic.net/series/x", "Comedy, 18+, Drama", none), /18\+/);
  assert.strictEqual(blockReason("https://asuracomic.net/series/x", "A young adult hero", none), null);
  assert.strictEqual(blockReason("https://en.wikipedia.org/wiki/Manga", "Genres :\nSmut", none), null);
});

test("excluded domains skip keywords and labels but not reels", () => {
  const cfg = { keywords: config.keywords, excludedDomains: ["reddit.com", "example.org"] };
  assert.strictEqual(blockReason("https://example.org/porn", "porn", cfg), null);
  assert.strictEqual(blockReason("https://sub.example.org/", "hentai", cfg), null);
  assert.strictEqual(blockReason("https://www.reddit.com/r/x", "NSFW porn", cfg), null);
  assert.match(blockReason("https://example.org.evil.com/porn", "", cfg), /porn/);
  assert.strictEqual(
    blockReason("https://www.facebook.com/reel/1", "", { keywords: [], excludedDomains: ["facebook.com"] }),
    REELS_REASON,
  );
});

test("age gate ignores cocktails, analysis and a lone plural", () => {
  const gate = "I am 18 or older";
  assert.equal(blockReason("https://shop.example/", `Cocktails and market analysis ${gate}`, { keywords: [], excludedDomains: [] }), null);
  assert.equal(blockReason("https://shop.example/", `Naked Grouse whisky ${gate}`, { keywords: [], excludedDomains: [] }), null);
});
