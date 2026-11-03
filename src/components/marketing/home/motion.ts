import type { Variants, Transition } from "framer-motion";

export const easeOut: Transition["ease"] = [0.16, 1, 0.3, 1];

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: easeOut } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4, ease: easeOut } },
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.42, ease: easeOut } },
};

export const stagger = (delayChildren = 0.1, staggerChildren = 0.06): Variants => ({
  hidden: {},
  visible: {
    transition: { delayChildren, staggerChildren },
  },
});

export const slideRight: Variants = {
  hidden: { opacity: 0, x: -16 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.42, ease: easeOut } },
};

export const tearOff: Variants = {
  intact: { y: 0, rotate: 0 },
  torn: {
    y: -10,
    rotate: 0.6,
    transition: { duration: 0.5, ease: easeOut },
  },
};

export const inViewProps = {
  initial: "hidden" as const,
  whileInView: "visible" as const,
  viewport: { once: true, margin: "0px 0px -80px 0px" },
};

export function reducedMotionShortcut(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
