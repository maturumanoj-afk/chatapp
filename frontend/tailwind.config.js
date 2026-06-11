/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        darkBg: '#0b0a0f',
        glassBg: 'rgba(255, 255, 255, 0.03)',
        glassBorder: 'rgba(255, 255, 255, 0.08)',
        glassHeader: 'rgba(15, 12, 30, 0.6)',
        neonIndigo: '#6366f1',
        neonPurple: '#a855f7',
        neonPink: '#ec4899',
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}
