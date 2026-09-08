/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}', './lib/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // True Kind Foundation — primary BLUE (paired with leaf-green in the brand gradient)
        // Enterprise accent ramp — one confident blue (Fiori-style discipline)
        brand: {
          50: '#eef5fd', 100: '#d8e8fb', 200: '#b4d2f7', 300: '#83b5f1',
          400: '#4a92e8', 500: '#1a70da', 600: '#0a5fd1', 700: '#0848a0',
          800: '#093a7f', 900: '#0b3068',
        },
        // Shell bar / dark chrome
        shell: { DEFAULT: '#12283f', hi: '#1d3a5c', deep: '#0a1624' },
        // Semantic state (never decorative)
        pos: { DEFAULT: '#0e7a3c', bg: '#e6f4ec' },
        crit: { DEFAULT: '#c9700c', bg: '#fdf3e5' },
        neg: { DEFAULT: '#b31717', bg: '#fbeaea' },
        // Brand accent colours from the logo (leaf green, figure purple, tagline red)
        leaf: {
          50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac',
          400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d',
          800: '#166534', 900: '#14532d',
        },
        grape: { 50: '#faf5ff', 100: '#f3e8ff', 200: '#e9d5ff', 600: '#7e22ce', 700: '#6b21a8' },
        coral: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 600: '#dc2626', 700: '#b91c1c' },
        // Neutral ink scale (slate-based)
        ink: { DEFAULT: '#12283f', soft: '#4a5a6e', faint: '#7a8899' },
        canvas: '#eef1f5',
        line: '#d9dfe7',
      },
      backgroundImage: {
        // the logo's blue -> green sweep, used on primary buttons, avatars, hero panels
        'brand-gradient': 'linear-gradient(135deg, #0a5fd1 0%, #12a150 100%)',
        'brand-gradient-r': 'linear-gradient(90deg, #0a5fd1 0%, #12a150 100%)',
      },
      // Enterprise depth: crisp and shallow, not soft and floaty.
      boxShadow: {
        card: '0 1px 2px rgba(18,40,63,.07)',
        soft: '0 1px 2px rgba(18,40,63,.05)',
        lift: '0 1px 3px rgba(18,40,63,.10), 0 4px 12px -6px rgba(18,40,63,.12)',
        pop: '0 8px 24px -8px rgba(18,40,63,.22)',
        btn: '0 1px 2px rgba(10,95,209,.20)',
        focus: '0 0 0 2px rgba(10,95,209,.35)',
      },
      borderRadius: { xl2: '6px', xl3: '8px' },
      transitionTimingFunction: { premium: 'cubic-bezier(.4,0,.2,1)' },
    },
  },
  plugins: [],
};
