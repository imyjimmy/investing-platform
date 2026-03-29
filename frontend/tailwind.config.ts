import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        shell: "#071012",
        panel: "#0c171a",
        panelSoft: "#102126",
        line: "#1b3339",
        text: "#d8e7e5",
        muted: "#8ea7a4",
        safe: "#3bc48d",
        caution: "#f7c85b",
        danger: "#ef6b62",
        accent: "#66d0bf",
      },
      boxShadow: {
        panel: "0 14px 40px rgba(0, 0, 0, 0.28)",
      },
      backgroundImage: {
        "shell-gradient":
          "radial-gradient(circle at top left, rgba(102,208,191,0.18), transparent 32%), radial-gradient(circle at top right, rgba(247,200,91,0.1), transparent 22%), linear-gradient(180deg, #071012 0%, #091518 54%, #061114 100%)",
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
