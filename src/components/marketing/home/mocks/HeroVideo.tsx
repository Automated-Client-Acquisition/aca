import { motion } from "framer-motion";
import { easeOut } from "../motion";

// Bunny Stream embed config.
// Find these in the Bunny dashboard → Stream → (your video) → Embed:
//   https://iframe.mediadelivery.net/embed/<LIBRARY_ID>/<VIDEO_GUID>
const BUNNY_LIBRARY_ID = "634107";
const BUNNY_VIDEO_GUID = "8c202b29-b51b-414f-a584-6a63fde86bd7";

// Autoplay + muted + loop background-style playback (muted is required for autoplay).
const EMBED_SRC =
  `https://iframe.mediadelivery.net/embed/${BUNNY_LIBRARY_ID}/${BUNNY_VIDEO_GUID}` +
  `?autoplay=true&loop=true&muted=true&preload=true&responsive=true`;

export function HeroVideo() {
  return (
    <motion.div
      className="hero__video"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: easeOut, delay: 0.15 }}
      aria-label="ACA product demo video"
    >
      <div className="hero__video-frame">
        <iframe
          src={EMBED_SRC}
          loading="lazy"
          title="ACA product demo"
          allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture;"
          allowFullScreen
        />
      </div>
    </motion.div>
  );
}
