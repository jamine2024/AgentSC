/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './src/renderer/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        info: 'hsl(var(--info))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'live-dot': {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.8)', opacity: '0.3' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'glow-flash': {
          '0%': { boxShadow: 'inset 0 0 40px 0 hsl(var(--primary) / 0.25)' },
          '100%': { boxShadow: 'inset 0 0 0px 0 hsl(var(--primary) / 0)' },
        },
        // 只做 transform/opacity：原来的 maxHeight 0 → 60px 会在整段动画期间
        // 逐帧触发布局重排（list 里 50 行 × 每帧 reflow），是事件流卡顿的放大器。
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'number-pop': {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '60%': { transform: 'translateY(-2px)', opacity: '1' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        wave: {
          '0%': { transform: 'scaleY(0.3)' },
          '50%': { transform: 'scaleY(1)' },
          '100%': { transform: 'scaleY(0.3)' },
        },
        blink: {
          '0%, 50%': { opacity: '1' },
          '51%, 100%': { opacity: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fade-in 0.3s ease-out forwards',
        'scale-in': 'scale-in 0.2s ease-out forwards',
        'live-dot': 'live-dot 2s ease-out infinite',
        'glow-flash': 'glow-flash 1.2s ease-out forwards',
        'slide-down': 'slide-down 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'number-pop': 'number-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        'wave': 'wave 1.2s ease-in-out infinite',
        'blink': 'blink 1s step-end infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
