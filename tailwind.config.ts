import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#050505',
          900: '#0a0a0b',
          850: '#0f0f11',
          800: '#151517',
          700: '#1e1e21',
          600: '#2a2a2e',
          500: '#3a3a40',
        },
        orange: {
          DEFAULT: '#f7931a',
          50: '#fff5e8',
          100: '#ffe6c4',
          200: '#ffcf8c',
          300: '#ffb552',
          400: '#fca22c',
          500: '#f7931a',
          600: '#d97706',
          700: '#a85a05',
          800: '#7a4104',
          900: '#4d2903',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(247,147,26,0.35), 0 0 28px -6px rgba(247,147,26,0.45)',
      },
      keyframes: {
        pulseline: {
          '0%,100%': { opacity: '0.35' },
          '50%': { opacity: '1' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        pulseline: 'pulseline 2.4s ease-in-out infinite',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};

export default config;
