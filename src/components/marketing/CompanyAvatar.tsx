import { useState } from "react";
import { logoUrlFor, monogram, monogramColor, type PublicSignal } from "@/lib/signals";

interface CompanyAvatarProps {
  signal: Pick<PublicSignal, "company" | "logo_url" | "domain">;
  size?: number;
  className?: string;
}

/**
 * Company logo with a graceful monogram fallback. Until the exporter emits a
 * domain/logo, every company renders a deterministic coloured monogram; once a
 * logo is available it loads over the top and falls back on error.
 */
export function CompanyAvatar({ signal, size = 44, className = "" }: CompanyAvatarProps) {
  const src = logoUrlFor(signal);
  const [failed, setFailed] = useState(false);
  const showLogo = src && !failed;

  return (
    <span
      className={`company-avatar ${className}`}
      style={{
        width: size,
        height: size,
        // Monogram fills are shaded 15% toward ink so the white initials clear
        // 4.5:1 on every palette color (the ochre swatch alone was 3.7:1).
        background: showLogo ? "#fff" : `color-mix(in srgb, ${monogramColor(signal.company)} 85%, #15140f)`,
        fontSize: Math.round(size * 0.36),
      }}
      aria-hidden="true"
    >
      {showLogo ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        monogram(signal.company)
      )}
    </span>
  );
}
