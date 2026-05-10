export function Logo({ size = 48 }: { size?: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Logo container with animation */}
      <div
        className="absolute inset-0"
        style={{
          transformStyle: 'preserve-3d',
          animation: 'logoFloat 4s ease-in-out infinite, logoRotate 20s linear infinite',
        }}
      >
        {/* Hexagon */}
        <div className="absolute inset-0">
          <svg viewBox="0 0 100 100" fill="none" style={{ filter: 'drop-shadow(0 0 15px rgba(139, 92, 246, 0.5))' }}>
            <defs>
              <linearGradient id="hexGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="50%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
            <polygon points="50,3 90,25 90,75 50,97 10,75 10,25" fill="url(#hexGrad)" opacity="0.9" />
            <polygon points="50,10 82,29 82,71 50,90 18,71 18,29" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
          </svg>
        </div>

        {/* V Letter */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            fontFamily: 'Inter, sans-serif',
            fontWeight: 800,
            fontSize: size * 0.46,
            color: 'white',
            textShadow: '0 0 20px rgba(139, 92, 246, 0.8), 0 2px 4px rgba(0,0,0,0.5)',
            animation: 'vGlow 2s ease-in-out infinite',
          }}
        >
          V
        </div>

        {/* Spinning rings */}
        <div
          className="absolute rounded-full"
          style={{
            inset: '-4px',
            border: '2px solid transparent',
            borderTopColor: 'rgba(139, 92, 246, 0.5)',
            animation: 'ringSpin 3s linear infinite',
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            inset: '-8px',
            border: '2px solid transparent',
            borderTopColor: 'rgba(167, 139, 250, 0.4)',
            animation: 'ringSpin 4s linear infinite reverse',
          }}
        />

        {/* Stars */}
        <div className="absolute" style={{ inset: '-10px' }}>
          {[0, 90, 180, 270].map((rotation, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 bg-white rounded-full"
              style={{
                top: rotation === 0 || rotation === 180 ? '0' : '50%',
                left: rotation === 90 || rotation === 270 ? '0' : '50%',
                transform: 'translate(-50%, -50%)',
                animation: `starTwinkle 2s ease-in-out infinite`,
                animationDelay: `${i * 0.5}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
