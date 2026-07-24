/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#21201C",
          hover: "#3A3833",
        },
        paper: "#FFFFFF",
        cream: "#FAFAF8",
        mist: "#F0EFED",
        line: "#E7E5E0",
        fog: {
          DEFAULT: "#6F6D66",
          light: "#A8A29E",
        },
        accent: {
          amber: "#F59E0B",
          violet: "#8B5CF6",
          blue: "#3B82F6",
          emerald: "#10B981",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: {
        label: "0.08em",
      },
      boxShadow: {
        card: "0 1px 2px rgba(33,32,28,0.04), 0 8px 24px rgba(33,32,28,0.04)",
      },
    },
  },
  plugins: [],
};
