import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        graphite: "#15171a",
        surface: "#1d2023",
        surface2: "#23262a",
        line: "#33363a",
        accent: "#ff8248",
        edge: "#3fbdb7",
        good: "#5aab6b",
        warn: "#d9a53c",
        bad: "#e0584f",
      },
      fontFamily: {
        display: ["'Barlow Condensed'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
