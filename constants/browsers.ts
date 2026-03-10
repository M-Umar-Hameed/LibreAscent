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
];
