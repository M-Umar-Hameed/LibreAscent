/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: "class",
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        freedom: {
          // Primary (60%) - Tech Forest (Deep Forest Black)
          primary: "#0B1215",
          // Secondary/Surface (30%) - Muted Pine Card surfaces
          secondary: "#1A2421",
          surface: "#1A2421",
          // Accent (10%) - Modern Teal / Mint Glow
          accent: "#2DD4BF",
          highlight: "#2DD4BF",
          // Utility
          success: "#10B981",
          warning: "#F59E0B",
          danger: "#EF4444",
          text: "#ECFDF5", // Mint Tinted White
          "text-muted": "#94A3B8",
          "text-muted-bright": "#CBD5E1",
          "surface-light": "#F0FDF4", // Light Mode Mint Background
        },
      },
    },
  },
  plugins: [],
};
