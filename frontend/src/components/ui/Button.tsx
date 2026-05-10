interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
}

export function Button({
  children,
  onClick,
  className = '',
  variant = 'primary',
  disabled = false,
  type = 'button',
}: ButtonProps) {
  const baseStyles = `
    relative overflow-hidden
    px-6 py-4
    rounded-xl
    font-sans font-semibold text-base
    transition-all duration-300
    disabled:opacity-50 disabled:cursor-not-allowed
  `;

  const variants = {
    primary: `
      bg-gradient-to-br from-accent via-purple-700 to-violet-900
      text-white
      shadow-[0_4px_20px_rgba(139,92,246,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]
      hover:-translate-y-0.5 hover:scale-[1.02]
      hover:shadow-[0_8px_40px_rgba(139,92,246,0.5),0_0_60px_rgba(139,92,246,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]
      active:translate-y-0
    `,
    secondary: `
      bg-surface-elevated
      border border-border
      text-text-muted
      hover:bg-surface hover:border-border-hover hover:text-text
    `,
    ghost: `
      bg-transparent
      text-text-muted
      hover:text-text hover:bg-surface
    `,
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyles} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
