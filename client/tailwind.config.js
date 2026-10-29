/** @type {import('tailwindcss').Config} */

// Les couleurs pointent vers les variables CSS de src/index.css (thèmes clair / sombre)
const rgb = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Outfit", "system-ui", "-apple-system", "sans-serif"],
      },
      colors: {
        bg: rgb("bg"),
        surface: rgb("surface"),
        surface2: rgb("surface2"),
        surface3: rgb("surface3"),
        panel: rgb("panel"), // fond du panneau principal (surface sur desktop, bg sur mobile)
        card: rgb("card"), // cartes posées sur le panneau
        fg: rgb("text"),
        muted: rgb("muted"),
        faint: rgb("faint"),
        accent: rgb("accent"),
        "accent-hover": rgb("accent-hover"),
        "accent-text": rgb("accent-text"),
        primary: rgb("accent"),
        ok: rgb("ok"),
        line: "var(--line)",
        line2: "var(--line2)",
        "accent-soft": "var(--accent-soft)",
        glass: "var(--glass)",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(.2,.7,.2,1)",
      },
    },
  },
  plugins: [],
};
