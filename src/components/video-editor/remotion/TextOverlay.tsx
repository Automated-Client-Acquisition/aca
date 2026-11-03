import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { SceneText } from "@/types/videoEditor";

interface Props {
  text: SceneText;
  entryFrame: number;
}

export const TextOverlay: React.FC<Props> = ({ text, entryFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const localFrame = frame - entryFrame;
  const animProgress = spring({
    frame: Math.max(0, localFrame),
    fps,
    config: { damping: 12, stiffness: 200, mass: 0.5 },
  });

  const opacity = interpolate(animProgress, [0, 1], [0, 1]);
  const translateY = interpolate(animProgress, [0, 1], [20, 0]);

  const positionStyle = getTextPosition(text.position);

  return (
    <AbsoluteFill style={positionStyle}>
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          padding: "12px 24px",
          backgroundColor: text.backgroundColor || "rgba(0,0,0,0.6)",
          borderRadius: 8,
          maxWidth: "80%",
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontSize: text.fontSize,
            color: text.color,
            fontWeight: 700,
            fontFamily: "Arial, sans-serif",
            lineHeight: 1.3,
          }}
        >
          {text.content}
        </span>
      </div>
    </AbsoluteFill>
  );
};

function getTextPosition(
  position: "top" | "center" | "bottom"
): React.CSSProperties {
  switch (position) {
    case "top":
      return {
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: 80,
      };
    case "center":
      return { justifyContent: "center", alignItems: "center" };
    case "bottom":
    default:
      return {
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 100,
      };
  }
}
