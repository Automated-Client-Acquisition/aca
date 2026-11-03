type LogoProps = {
  size?: number;
  tone?: "ink" | "bone";
  className?: string;
};

export function Logo({ size = 32, tone = "ink", className = "" }: LogoProps) {
  return (
    <span
      className={`aca-logo ${className}`.trim()}
      style={{
        fontSize: size,
        color: tone === "bone" ? "var(--bone)" : "var(--ink)",
      }}
      aria-label="aca."
    >
      aca<span className="dot">.</span>
    </span>
  );
}

export default Logo;
