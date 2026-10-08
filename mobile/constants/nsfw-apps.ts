export interface NsfwAppConfig {
  name: string;
  packageName: string;
}

/**
 * Apps that allow explicit/NSFW content and should be scanned
 * for blocked keywords in their native UI.
 */
export const NSFW_APPS: NsfwAppConfig[] = [
  {
    name: "Reddit",
    packageName: "com.reddit.frontpage",
  },
  {
    name: "X (Twitter)",
    packageName: "com.twitter.android",
  },
  {
    name: "TikTok",
    packageName: "com.zhiliaoapp.musically",
  },
  {
    name: "TikTok (Asia)",
    packageName: "com.ss.android.ugc.trill",
  },
  {
    name: "Facebook",
    packageName: "com.facebook.katana",
  },
];
