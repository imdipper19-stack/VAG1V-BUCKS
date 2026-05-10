/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0f',
        'background-warm': '#0d0d14',
        surface: {
          DEFAULT: 'rgba(255, 255, 255, 0.03)',
          elevated: 'rgba(255, 255, 255, 0.06)',
          glass: 'rgba(255, 255, 255, 0.02)',
        },
        accent: {
          DEFAULT: '#8b5cf6',
          light: '#a78bfa',
          soft: 'rgba(139, 92, 246, 0.12)',
          glow: 'rgba(139, 92, 246, 0.5)',
        },
        success: {
          DEFAULT: '#22c55e',
          soft: 'rgba(34, 197, 94, 0.12)',
        },
        danger: {
          DEFAULT: '#ef4444',
          soft: 'rgba(239, 68, 68, 0.12)',
        },
        text: {
          DEFAULT: '#f4f4f5',
          muted: '#a1a1aa',
          subtle: '#71717a',
        },
        border: {
          DEFAULT: 'rgba(255, 255, 255, 0.06)',
          hover: 'rgba(255, 255, 255, 0.12)',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Roboto Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '24px',
        sm: '14px',
        xs: '10px',
      },
      animation: {
        'grid-move': 'gridMove 60s linear infinite',
        'glow-pulse': 'glowPulse 8s ease-in-out infinite',
        'logo-float': 'logoFloat 4s ease-in-out infinite',
        'logo-rotate': 'logoRotate 20s linear infinite',
        'v-glow': 'vGlow 2s ease-in-out infinite',
        'ring-spin': 'ringSpin 3s linear infinite',
        'star-twinkle': 'starTwinkle 2s ease-in-out infinite',
        'slide-down': 'slideDown 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-slow': 'pulse 1.5s ease-in-out infinite',
        'card-entrance': 'cardEntrance 1s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both',
        'hero-glow': 'heroGlow 3s ease-in-out infinite',
        'hex-rotate': 'hexRotate 30s linear infinite',
        'hero-v-glow': 'heroVGlow 2s ease-in-out infinite',
        'inner-ring-pulse': 'innerRingPulse 3s ease-in-out infinite',
        'outer-ring-spin': 'outerRingSpin 20s linear infinite',
        'dot-float': 'dotFloat 3s ease-in-out infinite',
        'amount-shimmer': 'amountShimmer 4s ease-in-out infinite',
        'button-shine': 'buttonShine 3s ease-in-out infinite',
        'auth-entrance': 'authEntrance 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
        'char-pop': 'charPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards',
        'spin-slow': 'spin 2s linear infinite',
        'text-pulse': 'textPulse 2s ease-in-out infinite',
        'ring-pulse': 'ringPulse 1.5s ease-out infinite',
        'log-slide': 'logSlide 0.4s ease backwards',
        'success-pop': 'successPop 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'success-glow': 'successGlow 2s ease-in-out infinite',
        'check-bounce': 'checkBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both',
        'badge-pop': 'badgePop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        gridMove: {
          '0%': { transform: 'perspective(500px) rotateX(60deg) translateY(0)' },
          '100%': { transform: 'perspective(500px) rotateX(60deg) translateY(60px)' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.5', transform: 'translate(-50%, -50%) scale(1)' },
          '50%': { opacity: '1', transform: 'translate(-50%, -50%) scale(1.1)' },
        },
        logoFloat: {
          '0%, 100%': { transform: 'translateY(0) rotateY(0deg)' },
          '50%': { transform: 'translateY(-5px) rotateY(5deg)' },
        },
        logoRotate: {
          '0%': { transform: 'rotateY(0deg)' },
          '100%': { transform: 'rotateY(360deg)' },
        },
        vGlow: {
          '0%, 100%': { textShadow: '0 0 20px var(--accent), 0 2px 4px rgba(0,0,0,0.5)' },
          '50%': { textShadow: '0 0 30px var(--accent), 0 0 50px var(--accent-light), 0 2px 4px rgba(0,0,0,0.5)' },
        },
        ringSpin: {
          to: { transform: 'rotate(360deg)' },
        },
        starTwinkle: {
          '0%, 100%': { opacity: '0.3', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.5)' },
        },
        slideDown: {
          from: { opacity: '0', transform: 'translateY(-20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        cardEntrance: {
          from: { opacity: '0', transform: 'translateY(40px) scale(0.95)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        heroGlow: {
          '0%, 100%': { opacity: '0.5', transform: 'scale(1)' },
          '50%': { opacity: '0.8', transform: 'scale(1.1)' },
        },
        hexRotate: {
          to: { transform: 'rotate(360deg)' },
        },
        heroVGlow: {
          '0%, 100%': { textShadow: '0 0 40px var(--accent), 0 0 80px var(--accent-glow), 0 4px 8px rgba(0,0,0,0.5)' },
          '50%': { textShadow: '0 0 60px var(--accent), 0 0 120px var(--accent-light), 0 4px 8px rgba(0,0,0,0.5)' },
        },
        innerRingPulse: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.5' },
          '50%': { transform: 'scale(1.05)', opacity: '1' },
        },
        outerRingSpin: {
          to: { transform: 'rotate(-360deg)' },
        },
        dotFloat: {
          '0%, 100%': { transform: 'translateY(0) scale(1)', opacity: '0.5' },
          '50%': { transform: 'translateY(-5px) scale(1.5)', opacity: '1' },
        },
        amountShimmer: {
          '0%, 100%': { filter: 'brightness(1)' },
          '50%': { filter: 'brightness(1.2)' },
        },
        buttonShine: {
          '0%, 100%': { left: '-100%' },
          '50%': { left: '100%' },
        },
        authEntrance: {
          from: { opacity: '0', transform: 'scale(0.9) translateY(30px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        charPop: {
          from: { opacity: '0', transform: 'scale(0.5) rotateX(60deg)' },
          to: { opacity: '1', transform: 'scale(1) rotateX(0)' },
        },
        spin: {
          to: { transform: 'rotate(360deg)' },
        },
        textPulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        ringPulse: {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '100%': { transform: 'scale(1.8)', opacity: '0' },
        },
        logSlide: {
          from: { opacity: '0', transform: 'translateX(-15px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        successPop: {
          from: { opacity: '0', transform: 'scale(0.8)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        successGlow: {
          '0%, 100%': { boxShadow: '0 8px 40px rgba(34, 197, 94, 0.5), 0 0 80px rgba(34, 197, 94, 0.2)' },
          '50%': { boxShadow: '0 8px 50px rgba(34, 197, 94, 0.7), 0 0 100px rgba(34, 197, 94, 0.3)' },
        },
        checkBounce: {
          from: { transform: 'scale(0) rotate(-10deg)' },
          to: { transform: 'scale(1) rotate(0)' },
        },
        badgePop: {
          from: { transform: 'scale(0.8)' },
          to: { transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
