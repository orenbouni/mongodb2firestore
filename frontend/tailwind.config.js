/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Chart chrome and ink. Values are the dark column of the validated
        // reference palette; the whole dashboard renders on the dark surface.
        plane: '#0d0d0d',
        surface: '#1a1a19',
        surfaceRaised: '#232322',
        ink: {
          primary: '#ffffff',
          secondary: '#c3c2b7',
          muted: '#898781',
        },
        grid: '#2c2c2a',
        baseline: '#383835',

        // Categorical slots 1 and 2 - the two data sources. Validated as a pair
        // against #1a1a19: worst adjacent CVD dE 69.8, both >= 3:1 contrast.
        firestore: '#3987e5',
        mongo: '#199e70',

        // Status palette, fixed. Always paired with an icon or label.
        good: '#0ca30c',
        warning: '#fab219',
        serious: '#ec835a',
        critical: '#d03b3b',

        // Workload operation identity - categorical slots 1, 2, 3 and 6.
        // Validated as a set on #1a1a19: worst adjacent CVD dE 35.9, all >= 3:1.
        // Always rendered next to the operation's name, never colour alone.
        op: {
          insert: '#3987e5',
          read: '#199e70',
          update: '#c98500',
          delete: '#e66767',
        },

        // Single-hue sequential/ordinal ramp (blue), validated monotone on dark.
        seq: {
          100: '#cde2fb',
          200: '#9ec5f4',
          300: '#6da7ec',
          400: '#3987e5',
          500: '#256abf',
          600: '#184f95',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderColor: {
        hairline: 'rgba(255,255,255,0.10)',
      },
    },
  },
  plugins: [],
};
