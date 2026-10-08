const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withArm64Only(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const gradleProps = path.join(
        config.modRequest.platformProjectRoot,
        "gradle.properties"
      );
      let contents = fs.readFileSync(gradleProps, "utf-8");
      contents = contents.replace(
        /^reactNativeArchitectures=.*$/m,
        "reactNativeArchitectures=arm64-v8a"
      );
      contents = contents.replace(
        "android.enablePngCrunchInReleaseBuilds=true",
        "android.enablePngCrunchInReleaseBuilds=false"
      );
      for (const line of ["org.gradle.workers.max=2", "CMAKE_BUILD_PARALLEL_LEVEL=2"]) {
        const key = line.split("=")[0];
        if (!new RegExp(`^${key}=`, "m").test(contents)) {
          contents += `${contents.endsWith("\n") ? "" : "\n"}${line}\n`;
        }
      }
      fs.writeFileSync(gradleProps, contents);
      return config;
    },
  ]);
}

module.exports = withArm64Only;
