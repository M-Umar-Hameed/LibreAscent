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
    urlBarId: "url_bar_title",
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
];
