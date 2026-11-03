import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type {
  ChatMessage,
  AgentAction,
  ActionResult,
  AgentScenePlan,
  SSEEvent,
  ToolCallDisclosure,
} from "@/types/editorChat";
import type { VideoScene, VideoSettings, ChatUploadedAsset } from "@/types/videoEditor";

// ── Helpers ────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function scenePlanToVideoScene(plan: AgentScenePlan, order: number): VideoScene {
  // Skill composition scenes bypass generic media rendering
  if (plan.skill_composition) {
    return {
      id: `scene_${generateId()}`,
      order,
      duration: plan.duration || 5,
      media: { type: "color" as const, url: "#000000", source: "stock" as const },
      transition: plan.transition || "fade",
      skill_composition: {
        id: plan.skill_composition.id,
        props: plan.skill_composition.props,
      },
    };
  }

  const hasMedia = plan.media.url && plan.media.source !== "color";
  const mediaType =
    plan.media.source === "stock_video"
      ? "video"
      : plan.media.source === "stock_photo" || plan.media.source === "ai_image"
        ? "image"
        : "color";
  const mediaSource =
    plan.media.source === "stock_video" || plan.media.source === "stock_photo"
      ? "stock"
      : plan.media.source === "ai_image"
        ? "ai_image"
        : "stock";

  return {
    id: `scene_${generateId()}`,
    order,
    duration: plan.duration || 5,
    media: hasMedia
      ? {
          type: mediaType as "video" | "image" | "color",
          url: plan.media.url!,
          thumbnail_url: plan.media.thumbnail,
          source: mediaSource as any,
          prompt: plan.media.query,
        }
      : {
          type: "color" as const,
          url: plan.media.color || "#1a1a2e",
          source: "stock" as const,
        },
    text: plan.text_overlay
      ? {
          content: plan.text_overlay.content,
          position: plan.text_overlay.position || "bottom",
          fontSize: 48,
          color: "#FFFFFF",
          backgroundColor: "rgba(0,0,0,0.5)",
        }
      : undefined,
    transition: plan.transition || "fade",
  };
}

function actionLabel(action: AgentAction): string {
  switch (action.type) {
    case "plan_scenes": return `Creating ${action.scenes.length} scenes`;
    case "update_project": return "Updating project";
    case "set_voiceover": return "Setting voiceover";
    case "set_music": return "Adding background music";
    case "add_asset": return "Adding asset";
    default: return "Processing";
  }
}

// ── Types for the hook ─────────────────────────────────────────────

interface EditorChatHookContext {
  addScene: (scene: VideoScene) => void;
  removeScene: (sceneId: string) => void;
  updateScene: (sceneId: string, updates: Partial<VideoScene>) => void;
  updateSettings: (settings: Partial<VideoSettings>) => void;
  setTitle: (title: string) => void;
  setVoiceover: (voiceover: any) => void;
  setMusic: (music: any) => void;
  setRemotionCode?: (code: string) => void;
  addChatUpload?: (asset: ChatUploadedAsset) => void;
  getScenes: () => VideoScene[];
  getProject: () => {
    title: string;
    scenes: VideoScene[];
    settings: VideoSettings;
    voiceover?: any;
    music?: any;
    remotion_code?: string;
  };
  getChatUploads?: () => ChatUploadedAsset[];
}

// ── Main hook ──────────────────────────────────────────────────────

export function useEditorChat(ctx: EditorChatHookContext) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { currentOrganization } = useAuth();
  const processingRef = useRef(false);

  const serializeProjectState = useCallback(() => {
    const project = ctx.getProject();
    const sortedScenes = [...project.scenes].sort((a, b) => a.order - b.order);
    const transcript =
      project.voiceover?.source === "uploaded" && project.voiceover?.script
        ? project.voiceover.script
        : undefined;
    return {
      title: project.title,
      scene_count: sortedScenes.length,
      scenes: sortedScenes.map((s, i) => ({
        index: i,
        duration: s.duration,
        media_type: s.media.type,
        has_media: s.media.type !== "color" && !!s.media.url,
        text: s.text?.content,
        transition: s.transition,
      })),
      settings: {
        aspect_ratio: project.settings.aspect_ratio,
        caption_style: project.settings.caption_style,
      },
      has_voiceover: !!project.voiceover?.url,
      has_music: !!project.music?.url,
      transcript,
      transcript_word_count: transcript
        ? transcript.split(/\s+/).filter(Boolean).length
        : undefined,
      word_timestamps: project.voiceover?.word_timestamps,
      source_video_url: project.voiceover?.source === "uploaded" ? project.voiceover.url : undefined,
      has_remotion_code: !!project.remotion_code?.trim(),
    };
  }, [ctx]);

  const processAction = useCallback(
    (action: AgentAction) => {
      try {
        switch (action.type) {
          case "plan_scenes": {
            const currentCount = ctx.getScenes().length;
            for (let j = 0; j < action.scenes.length; j++) {
              const scene = scenePlanToVideoScene(action.scenes[j], currentCount + j);
              ctx.addScene(scene);
            }
            break;
          }
          case "update_project": {
            if (action.title) ctx.setTitle(action.title);
            if (action.aspect_ratio || action.caption_style) {
              const settings: Partial<VideoSettings> = {};
              if (action.aspect_ratio) settings.aspect_ratio = action.aspect_ratio as any;
              if (action.caption_style) settings.caption_style = action.caption_style as any;
              ctx.updateSettings(settings);
            }
            break;
          }
          case "set_voiceover": {
            ctx.setVoiceover({ url: "", script: action.script, source: "ai" as const });
            break;
          }
          case "set_music": {
            ctx.setMusic({ url: action.url, title: action.title, volume: action.volume ?? 0.2, source: "ai" });
            break;
          }
          case "add_asset": {
            ctx.addChatUpload?.({
              url: action.url,
              type: action.asset_type,
              name: action.name,
            });
            break;
          }
        }
      } catch (err: any) {
        console.error("processAction error:", err);
      }
    },
    [ctx]
  );

  const sendMessage = useCallback(
    async (text: string, imageUrl?: string, models?: { llmModel?: string; imageModel?: string; videoModel?: string }) => {
      if (!text.trim() || !currentOrganization?.id || processingRef.current) return;

      processingRef.current = true;
      setIsLoading(true);

      const userMessage: ChatMessage = {
        id: `msg_${generateId()}`,
        role: "user",
        content: text.trim(),
        imageUrl: imageUrl || undefined, // only store the one explicitly attached to this message
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Create placeholder assistant message immediately — shows tool disclosures as they arrive
      const assistantMsgId = `msg_${generateId()}`;
      const assistantPlaceholder: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        isStreaming: true,
        toolCallDisclosures: [],
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantPlaceholder]);

      try {
        // Build history — for messages that had an image, embed the URL in text so it's not lost
        const history = messages.map((m) => ({
          role: m.role,
          content: m.imageUrl
            ? `[Image URL: ${m.imageUrl}]\n${m.content}`
            : m.content,
        }));

        // If current message has no image but a prior user message did, re-pass that image_url
        // so the LLM can still see the image as a multimodal input in this turn
        const effectiveImageUrl = imageUrl || [...messages].reverse().find(
          (m) => m.role === "user" && m.imageUrl
        )?.imageUrl;
        const projectState = serializeProjectState();
        const project = ctx.getProject();
        const hasRemotionCode = !!project.remotion_code?.trim();

        // When remotion_code exists, use code mode so AI generates/updates code
        // Append current code as context so the AI knows what to modify
        let effectiveMessage = text.trim();
        if (hasRemotionCode && project.remotion_code) {
          effectiveMessage = `${effectiveMessage}\n\nCurrent composition code:\n\`\`\`tsx\n${project.remotion_code.slice(0, 4000)}\n\`\`\``;
        }

        // Use raw fetch for SSE streaming (supabase.functions.invoke buffers)
        const { data: { session } } = await supabase.auth.getSession();
        const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/editor-chat`;

        // Gather all uploaded assets so the AI can reference any of them
        const allUploads = ctx.getChatUploads?.() || [];
        const assetsPayload = allUploads.length > 0
          ? allUploads.map((a) => ({ url: a.url, type: a.type, name: a.name }))
          : undefined;

        const requestBody = {
            message: effectiveMessage,
            image_url: effectiveImageUrl || undefined,
            conversation_history: history,
            project_state: projectState,
            organization_id: currentOrganization.id,
            ...(assetsPayload ? { assets: assetsPayload } : {}),
            ...(hasRemotionCode ? { mode: "code" } : {}),
            ...(models?.llmModel ? { model: models.llmModel } : {}),
            ...(models?.imageModel ? { image_model: models.imageModel } : {}),
            ...(models?.videoModel ? { video_model: models.videoModel } : {}),
        };
        console.log("[EditorChat] Sending with models:", { model: requestBody.model, image_model: (requestBody as any).image_model, video_model: (requestBody as any).video_model });

        const response = await fetch(fnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token}`,
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const contentType = response.headers.get("content-type") || "";

        // Non-streaming JSON response (e.g. missing API key error)
        if (contentType.includes("application/json")) {
          const data = await response.json();
          if (data.error?.includes("OpenRouter API key not configured")) {
            toast.error("OpenRouter API key not configured", {
              description: "Add your OpenRouter API key in Settings - API Keys.",
            });
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: data.message || "An error occurred.", isStreaming: false }
                : m
            )
          );
          setIsLoading(false);
          processingRef.current = false;
          return;
        }

        // SSE streaming
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") break;

            let event: SSEEvent;
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }

            switch (event.type) {
              case "status": {
                const disclosure: ToolCallDisclosure = {
                  id: event.id,
                  label: event.label,
                  icon: event.icon,
                  status: "running",
                };
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, toolCallDisclosures: [...(m.toolCallDisclosures || []), disclosure] }
                      : m
                  )
                );
                break;
              }

              case "tool_result": {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          toolCallDisclosures: (m.toolCallDisclosures || []).map((d) =>
                            d.id === event.id
                              ? { ...d, status: event.status, summary: event.summary }
                              : d
                          ),
                        }
                      : m
                  )
                );
                break;
              }

              case "document": {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, document: { title: event.title, content: event.content } }
                      : m
                  )
                );
                break;
              }

              case "code": {
                // Code mode: AI generated/updated Remotion code - apply it
                if (event.code && ctx.setRemotionCode) {
                  ctx.setRemotionCode(event.code);
                }
                break;
              }

              case "action": {
                // Apply action immediately as it streams in
                processAction(event.action);
                break;
              }

              case "final": {
                // Apply any remaining actions bundled in final
                if (event.actions?.length) {
                  // Already processed via action events — but set legacy actionResults for backward compat
                  const actionResults: ActionResult[] = event.actions.map((action, i) => ({
                    actionIndex: i,
                    type: action.type,
                    status: "completed" as const,
                    label: actionLabel(action),
                  }));
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId
                        ? {
                            ...m,
                            content: event.message,
                            isStreaming: false,
                            actions: event.actions,
                            actionResults,
                          }
                        : m
                    )
                  );
                } else {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId
                        ? { ...m, content: event.message, isStreaming: false }
                        : m
                    )
                  );
                }
                setIsLoading(false);
                break;
              }

              case "error": {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: `Error: ${event.message}`, isStreaming: false }
                      : m
                  )
                );
                toast.error("Chat error", { description: event.message });
                setIsLoading(false);
                break;
              }
            }
          }
        }
      } catch (err: any) {
        console.error("Editor chat error:", err);
        const errorMessage = err?.message || "Unknown error";
        if (errorMessage.includes("OpenRouter API key not configured")) {
          toast.error("OpenRouter API key not configured", {
            description: "Add your OpenRouter API key in Settings - API Keys.",
          });
        } else {
          toast.error("Chat error", { description: errorMessage });
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === undefined
              ? m
              : m.role === "assistant" && m.isStreaming
                ? { ...m, content: "Sorry, I encountered an error. Please try again.", isStreaming: false }
                : m
          )
        );
        setIsLoading(false);
      } finally {
        processingRef.current = false;
      }
    },
    [currentOrganization, messages, serializeProjectState, processAction]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, isLoading, sendMessage, clearMessages };
}
