'use client';

export function HeroLogo() {
  return (
    <div className="w-[140px] h-[140px] mx-auto mb-8 relative">
      {/* Glow effect */}
      <div
        className="absolute inset-[-20px]"
        style={{
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.5) 0%, transparent 70%)',
          filter: 'blur(20px)',
          animation: 'heroGlow 3s ease-in-out infinite',
        }}
      />

      {/* Logo container */}
      <div className="relative w-full h-full">
        {/* Outer ring */}
        <div
          className="absolute inset-[-10px] rounded-full"
          style={{
            border: '2px dashed rgba(139, 92, 246, 0.2)',
            animation: 'outerRingSpin 20s linear infinite',
          }}
        />

        {/* Rotating hexagon */}
        <div
          className="absolute inset-0"
          style={{ animation: 'hexRotate 30s linear infinite' }}
        >
          <svg viewBox="0 0 100 100" fill="none" style={{ filter: 'drop-shadow(0 0 20px rgba(139, 92, 246, 0.5))' }}>
            <defs>
              <linearGradient id="heroGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="33%" stopColor="#a78bfa" />
                <stop offset="66%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>
            </defs>
            <polygon
              points="50,2 97,26 97,74 50,98 3,74 3,26"
              fill="url(#heroGrad)"
            />
            <polygon
              points="50,12 85,32 85,68 50,88 15,68 15,32"
              fill="none"
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="1"
            />
            <polygon
              points="50,22 73,38 73,62 50,78 27,62 27,38"
              fill="none"
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="1"
            />
          </svg>
        </div>

        {/* Inner ring */}
        <div
          className="absolute rounded-full"
          style={{
            inset: '15px',
            border: '1px solid rgba(139, 92, 246, 0.3)',
            animation: 'innerRingPulse 3s ease-in-out infinite',
          }}
        />

        {/* V Letter */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            fontFamily: 'Inter, sans-serif',
            fontWeight: 900,
            fontSize: '64px',
            color: 'white',
            textShadow: '0 0 40px #8b5cf6, 0 0 80px rgba(139, 92, 246, 0.5), 0 4px 8px rgba(0,0,0,0.5)',
            animation: 'heroVGlow 2s ease-in-out infinite',
          }}
        >
          V
        </div>

        {/* Floating dots */}
        <div className="absolute inset-[-30px]">
          {[0, 60, 120, 180, 240, 300].map((angle, i) => (
            <div
              key={i}
              className="absolute w-1.5 h-1.5 rounded-full"
              style={{
                top: `${50 - 50 * Math.sin(angle * Math.PI / 180)}%`,
                left: `${50 + 50 * Math.cos(angle * Math.PI / 180)}%`,
                transform: 'translate(-50%, -50%)',
                background: '#a78bfa',
                boxShadow: '0 0 10px #8b5cf6',
                animation: `dotFloat 3s ease-in-out infinite`,
                animationDelay: `${i * 0.5}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
