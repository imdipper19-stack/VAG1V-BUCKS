export default function VbucksIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/vbucks-icon.png"
      alt="V-Bucks"
      width={size}
      height={size}
      className={className}
      style={{
        width: size,
        height: size,
      }}
    />
  );
}
