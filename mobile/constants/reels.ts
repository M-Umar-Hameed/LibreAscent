export interface ReelsAppConfig {
  name: string;
  packageName: string;
  detectionNodes: string[];
}

/**
 * Social media apps with reels/shorts sections.
 *
 * detectionNodes are Android resource IDs (without the package prefix)
 * that identify the reels/shorts UI. The native ReelsDetector also has
 * fallback keyword matching ("shorts", "reels", "spotlight") so exact
 * IDs aren't strictly required — they just improve reliability.
 */
export const REELS_APPS: ReelsAppConfig[] = [
  {
    name: "Instagram",
    packageName: "com.instagram.android",
    detectionNodes: ["clips_viewer_view_pager"],
  },
  {
    name: "Facebook",
    packageName: "com.facebook.katana",
    detectionNodes: [
      "video_reels_fragment",
      "reels_screen_fragment_container",
      "watch_recycler_view",
      "fb_video_home",
      "watch_fragment",
      "watch_recycler",
      "video_home_root_container",
      "fb_video_home_fragment",
    ],
  },
  {
    name: "Facebook Lite",
    packageName: "com.facebook.lite",
    detectionNodes: ["watch_recycler", "watch_fragment"],
  },
  {
    name: "YouTube",
    packageName: "com.google.android.youtube",
    detectionNodes: ["reel_recycler", "shorts_shelf"],
  },
  {
    name: "Snapchat",
    packageName: "com.snapchat.android",
    detectionNodes: [
      "spotlight_feed",
      "df_spotlight",
      "spotlight_container",
      "spotlight_player",
    ],
  },
  {
    name: "X (Twitter)",
    packageName: "com.twitter.android",
    detectionNodes: ["VideoTab"],
  },
  {
    name: "Reddit",
    packageName: "com.reddit.frontpage",
    detectionNodes: ["fbp_vertical_pager"],
  },
];
