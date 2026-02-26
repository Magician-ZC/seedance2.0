/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'app-bg': '#0a0a0a',
        'card-bg': '#1a1a1a',
        'card-hover': '#222222',
        'toolbar-bg': '#2a2d3e',
        'sidebar-bg': '#111111',
        'accent': '#22c55e',
        'accent-hover': '#16a34a',
      },
    },
  },
  plugins: [],
};
