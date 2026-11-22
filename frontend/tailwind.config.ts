import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        shell: "#181818",
        panel: "#202020",
        panelSoft: "#262626",
        line: "#383838",
        text: "#ededed",
        muted: "#a4a4a4",
        safe: "#3bc48d",
        caution: "#f7c85b",
        danger: "#ef6b62",
        accent: "#dedede",
      },
      boxShadow: {
        panel: "0 14px 40px rgba(0, 0, 0, 0.28)",
      },
      animation: {
        rise: "rise 320ms ease-out",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
