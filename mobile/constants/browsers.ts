export interface BrowserConfig {
  name: string;
  package: string;
  urlBarId: string;
}

/**
 * Extensible browser configuration.
 * To add support for a new browser:
 * 1. Find the browser's package name (from Play Store URL or `adb shell pm list packages`)
 * 2. Find the URL bar resource ID (using Android Layout Inspector)
 * 3. Add a new entry below
 */
export const BROWSERS: BrowserConfig[] = [
  { name: "Chrome", package: "com.android.chrome", urlBarId: "url_bar" },
  {
    name: "Firefox",
    package: "org.mozilla.firefox",
    urlBarId: "mozac_browser_toolbar_url_view",
  },
  {
    name: "Firefox Focus",
    package: "org.mozilla.focus",
    urlBarId: "mozac_browser_toolbar_url_view",
  },
  {
    name: "Firefox Beta",
    package: "org.mozilla.firefox_beta",
    urlBarId: "mozac_browser_toolbar_url_view",
  },
  {
    name: "Firefox Nightly",
    package: "org.mozilla.fenix",
    urlBarId: "mozac_browser_toolbar_url_view",
  },
  {
    name: "Samsung Internet",
    package: "com.sec.android.app.sbrowser",
    urlBarId: "location_bar_edit_text",
  },
  { name: "Brave", package: "com.brave.browser", urlBarId: "url_bar" },
  { name: "Edge", package: "com.microsoft.emmx", urlBarId: "url_bar" },
  { name: "Opera", package: "com.opera.browser", urlBarId: "url_field" },
  {
    name: "DuckDuckGo",
    package: "com.duckduckgo.mobile.android",
    urlBarId: "omnibarTextInput",
  },
  {
    name: "Vivaldi",
    package: "com.vivaldi.browser",
    urlBarId: "url_bar",
  },
  {
    name: "Waterfox",
    package: "net.waterfox.android.release",
    urlBarId: "mozac_browser_toolbar_url_view",
  },
  {
    name: "Fennec",
    package: "org.mozilla.fennec_fdroid",
    urlBarId: "mozac_browser_toolbar_url_view",
  },
  {
    name: "Kiwi",
    package: "com.kiwibrowser.browser",
    urlBarId: "url_bar",
  },
  {
    name: "Tor Browser",
    package: "org.torproject.torbrowser",
    urlBarId: "mozac_browser_toolbar_url_view",
  },
  {
    name: "Aloha",
    package: "com.alohamobile.browser",
    urlBarId: "url_bar",
  },
  {
    name: "Via",
    package: "mark.via.gp",
    urlBarId: "url_bar",
  },
  {
    name: "Soul Browser",
    package: "com.soul.android.soulbrowser",
    urlBarId: "url_bar",
  },
  {
    name: "Opera Mini",
    package: "com.opera.mini.native",
    urlBarId: "url_field",
  },
  {
    name: "Mull",
    package: "com.cookiedev.mull",
    urlBarId: "mozac_browser_toolbar_url_view",
  },
  {
    name: "IceCat",
    package: "org.gnu.icecat",
    urlBarId: "mozac_browser_toolbar_url_view",
  },
  {
    name: "Iceraven",
    package: "io.github.forkmaintainers.iceraven",
    urlBarId: "mozac_browser_toolbar_url_view",
  },
  {
    name: "Mi Browser",
    package: "com.mi.globalbrowser",
    urlBarId: "url_bar",
  },
  {
    name: "UC Browser",
    package: "com.UCMobile.intl",
    urlBarId: "url_bar",
  },
  {
    name: "Puffin",
    package: "com.cloudmosa.puffinFree",
    urlBarId: "address_bar",
  },
  {
    name: "Phoenix",
    package: "com.transsion.phoenix",
    urlBarId: "url_bar",
  },
  {
    name: "JioPages",
    package: "com.jio.browser",
    urlBarId: "url_bar",
  },
  {
    name: "Hola Browser",
    package: "com.talpa.hibrowser",
    urlBarId: "url_bar",
  },
  {
    name: "Heytap Browser",
    package: "com.heytap.browser",
    urlBarId: "url_bar",
  },
  {
    name: "Plus18",
    package: "org.plus18.android",
    urlBarId: "url_bar",
  },
  {
    name: "Chrome Beta",
    package: "com.chrome.beta",
    urlBarId: "url_bar",
  },
  {
    name: "Chrome Dev",
    package: "com.chrome.dev",
    urlBarId: "url_bar",
  },
  {
    name: "Chrome Canary",
    package: "com.chrome.canary",
    urlBarId: "url_bar",
  },
  {
    name: "Chromium",
    package: "org.chromium.chrome",
    urlBarId: "url_bar",
  },
  {
    name: "Cromite",
    package: "org.cromite.cromite",
    urlBarId: "url_bar",
  },
  {
    name: "Bromite",
    package: "org.bromite.bromite",
    urlBarId: "url_bar",
  },
  {
    name: "Brave Beta",
    package: "com.brave.browser_beta",
    urlBarId: "url_bar",
  },
  {
    name: "Brave Nightly",
    package: "com.brave.browser_nightly",
    urlBarId: "url_bar",
  },
  {
    name: "Edge Beta",
    package: "com.microsoft.emmx.beta",
    urlBarId: "url_bar",
  },
  {
    name: "Opera Beta",
    package: "com.opera.browser.beta",
    urlBarId: "url_field",
  },
  {
    name: "Samsung Internet Beta",
    package: "com.sec.android.app.sbrowser.beta",
    urlBarId: "location_bar_edit_text",
  },
  {
    name: "Yandex Browser",
    package: "com.yandex.browser",
    urlBarId: "bro_omnibar_address_title_text",
  },
  {
    name: "Firefox Klar",
    package: "org.mozilla.klar",
    urlBarId: "mozac_browser_toolbar_url_view",
  },
  {
    name: "IronFox",
    package: "org.ironfoxoss.ironfox",
    urlBarId: "mozac_browser_toolbar_url_view",
  },
  {
    name: "Fennec DOS",
    package: "us.spotco.fennec_dos",
    urlBarId: "mozac_browser_toolbar_url_view",
  },
  // URL bar id unverified; the universal fallback ids cover it when this one is absent.
  {
    name: "Pi Browser",
    package: "pi.browser",
    urlBarId: "url_bar",
  },
];
