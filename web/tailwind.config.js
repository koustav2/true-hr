/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}', './lib/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Emerald / teal accent
        brand: {
          50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7',
          400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857',
          800: '#065f46', 900: '#064e3b',
        },
        // Neutral ink scale (slate-based)
        ink: { DEFAULT: '#0f172a', soft: '#475569', faint: '#94a3b8' },
        canvas: '#f7f8fa',
        line: '#e9ecf1',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.05)',
        soft: '0 1px 2px rgba(15,23,42,.04)',
        lift: '0 8px 24px -10px rgba(15,23,42,.12), 0 2px 6px -2px rgba(15,23,42,.06)',
        pop: '0 10px 30px -10px rgba(5,150,105,.35)',
        btn: '0 1px 2px rgba(15,23,42,.05), inset 0 1px 0 rgba(255,255,255,.12)',
        focus: '0 0 0 4px rgba(16,185,129,.14)',
      },
      borderRadius: { xl2: '1rem', xl3: '1.25rem' },
      transitionTimingFunction: { premium: 'cubic-bezier(.4,0,.2,1)' },
    },
  },
  plugins: [],
};
