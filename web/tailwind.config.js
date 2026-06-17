/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}', './lib/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // True Kind Foundation — primary BLUE (paired with leaf-green in the brand gradient)
        brand: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
          400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
          800: '#1e40af', 900: '#1e3a8a',
        },
        // Brand accent colours from the logo (leaf green, figure purple, tagline red)
        leaf: {
          50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac',
          400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d',
          800: '#166534', 900: '#14532d',
        },
        grape: { 50: '#faf5ff', 100: '#f3e8ff', 200: '#e9d5ff', 600: '#7e22ce', 700: '#6b21a8' },
        coral: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 600: '#dc2626', 700: '#b91c1c' },
        // Neutral ink scale (slate-based)
        ink: { DEFAULT: '#0f172a', soft: '#475569', faint: '#94a3b8' },
        canvas: '#f7f8fa',
        line: '#e9ecf1',
      },
      backgroundImage: {
        // the logo's blue -> green sweep, used on primary buttons, avatars, hero panels
        'brand-gradient': 'linear-gradient(135deg, #2563eb 0%, #1d8bd6 45%, #16a34a 100%)',
        'brand-gradient-r': 'linear-gradient(90deg, #2563eb 0%, #16a34a 100%)',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.05)',
        soft: '0 1px 2px rgba(15,23,42,.04)',
        lift: '0 8px 24px -10px rgba(15,23,42,.12), 0 2px 6px -2px rgba(15,23,42,.06)',
        pop: '0 10px 30px -10px rgba(37,99,235,.35)',
        btn: '0 1px 2px rgba(15,23,42,.05), inset 0 1px 0 rgba(255,255,255,.18)',
        focus: '0 0 0 4px rgba(37,99,235,.14)',
      },
      borderRadius: { xl2: '1rem', xl3: '1.25rem' },
      transitionTimingFunction: { premium: 'cubic-bezier(.4,0,.2,1)' },
    },
  },
  plugins: [],
};
