const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Release builds signed with debug.keystore are a supply-chain hole for this
// app: that keystore is committed here and uses the universally known debug
// key, and Android treats "same signature" as "same app". Anyone could sign a
// build with it and have Android install it as an update over LibreAscent,
// inheriting its accessibility, device admin and VPN grants.
//
// The real keystore never lands in the repo. CI writes it from a secret and
// passes the credentials as Gradle properties. When they are absent (any local
// build) this falls back to the debug config, so `gradlew assembleRelease`
// keeps working on a dev machine without secrets.
//
// This lives in a config plugin rather than android/app/build.gradle because
// that directory is prebuild-generated: a regenerate would silently drop the
// signing config and quietly go back to debug-signed releases.
const SIGNING_CONFIG = `
        release {
            // Populated by CI from secrets; see .github/workflows/release.yml.
            if (project.hasProperty('LIBREASCENT_STORE_FILE')) {
                storeFile file(project.property('LIBREASCENT_STORE_FILE'))
                storePassword project.property('LIBREASCENT_STORE_PASSWORD')
                keyAlias project.property('LIBREASCENT_KEY_ALIAS')
                keyPassword project.property('LIBREASCENT_KEY_PASSWORD')
            }
        }`;

function withReleaseSigning(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const buildGradle = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "build.gradle"
      );
      let contents = fs.readFileSync(buildGradle, "utf-8");

      if (!contents.includes("LIBREASCENT_STORE_FILE")) {
        const anchor = `        debug {
            storeFile file('debug.keystore')`;
        if (!contents.includes(anchor)) {
          throw new Error(
            "withReleaseSigning: debug signingConfig anchor not found in app/build.gradle"
          );
        }
        contents = contents.replace(anchor, `${SIGNING_CONFIG.trim()}
${anchor}`);
      }

      // Use the release keystore when CI supplied one, else stay on debug so
      // local release builds still work. Signing with debug is only ever a
      // local convenience; CI fails the build if the property is missing.
      const releaseSigning = `            signingConfig project.hasProperty('LIBREASCENT_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`;
      const oldRelease = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;
      if (contents.includes(oldRelease)) {
        contents = contents.replace(oldRelease, releaseSigning);
      }

      fs.writeFileSync(buildGradle, contents);
      return config;
    },
  ]);
}

module.exports = withReleaseSigning;
