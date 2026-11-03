import { AbsoluteFill, Video, Img } from "remotion";
import type { VideoScene } from "@/types/videoEditor";
import { TextOverlay } from "./TextOverlay";

interface Props {
  scene: VideoScene;
  entryFrame: number;
}

export const SceneRenderer: React.FC<Props> = ({ scene, entryFrame }) => {
  return (
    <AbsoluteFill>
      {/* Background media */}
      {scene.media.type === "video" && scene.media.url && (
        <Video
          src={scene.media.url}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          volume={0}
        />
      )}

      {scene.media.type === "image" && scene.media.url && (
        <Img
          src={scene.media.url}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}

      {scene.media.type === "color" && (
        <AbsoluteFill
          style={{ backgroundColor: scene.media.url || "#1a1a2e" }}
        />
      )}

      {/* Fallback for empty scenes */}
      {!scene.media.url && scene.media.type !== "color" && (
        <AbsoluteFill
          style={{
            backgroundColor: "#1a1a2e",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              color: "rgba(255,255,255,0.3)",
              fontSize: 24,
              fontFamily: "Arial, sans-serif",
            }}
          >
            Scene {scene.order + 1}
          </div>
        </AbsoluteFill>
      )}

      {/* Text overlay */}
      {scene.text?.content && (
        <TextOverlay text={scene.text} entryFrame={entryFrame} />
      )}
    </AbsoluteFill>
  );
};
