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
        ink: { DEFAULT: '#0c1424', soft: '#3d4759', faint: '#7e8aa0' },
        canvas: '#f4f6fb',
        line: '#e7ebf3',
      },
      backgroundImage: {
        // the logo's blue -> green sweep, used on primary buttons, avatars, hero panels
        'brand-gradient': 'linear-gradient(120deg, #1d4ed8 0%, #2f7ad6 46%, #12a150 108%)',
        'brand-gradient-r': 'linear-gradient(90deg, #1d4ed8 0%, #12a150 100%)',
      },
      boxShadow: {
        card: '0 1px 2px rgba(12,20,36,.05), 0 12px 28px -14px rgba(12,20,36,.12)',
        soft: '0 1px 2px rgba(12,20,36,.05)',
        lift: '0 20px 46px -18px rgba(12,20,36,.20), 0 4px 12px -6px rgba(12,20,36,.10)',
        pop: '0 18px 44px -16px rgba(29,78,216,.40)',
        btn: '0 3px 10px -2px rgba(29,78,216,.32), inset 0 1px 0 rgba(255,255,255,.22)',
        focus: '0 0 0 4px rgba(29,78,216,.15)',
      },
      borderRadius: { xl2: '1rem', xl3: '1.25rem' },
      transitionTimingFunction: { premium: 'cubic-bezier(.4,0,.2,1)' },
    },
  },
  plugins: [],
};
