import { useState } from "react";
import { monogram, monogramColor, personPhoto, type SignalPerson } from "@/lib/signals";

interface PersonAvatarProps {
  person: SignalPerson;
  size?: number;
  /** Blur a real headshot (privacy/teaser). Monograms are never blurred. */
  blur?: boolean;
  className?: string;
}

/**
 * Person headshot for the public page. When a (proxied) photo is available it
 * renders blurred behind the "unlock" gate; otherwise a deterministic monogram.
 */
export function PersonAvatar({ person, size = 28, blur = true, className = "" }: PersonAvatarProps) {
  const [failed, setFailed] = useState(false);
  const photo = personPhoto(person);
  const showPhoto = !!photo && !failed;

  return (
    <span
      className={`person-avatar ${className}`}
      style={{
        width: size,
        height: size,
        // Monogram fills are shaded 15% toward ink so the white initials clear
        // 4.5:1 on every palette color (the ochre swatch alone was 3.7:1).
        background: showPhoto ? "#e9e4d8" : `color-mix(in srgb, ${monogramColor(person.name)} 85%, #15140f)`,
        fontSize: Math.round(size * 0.36),
      }}
      aria-hidden="true"
    >
      {showPhoto ? (
        <img
          src={photo}
          alt=""
          loading="lazy"
          className={`person-avatar__img ${blur ? "is-blurred" : ""}`}
          onError={() => setFailed(true)}
        />
      ) : (
        monogram(person.name)
      )}
    </span>
  );
}
