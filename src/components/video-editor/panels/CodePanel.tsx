import { useState, useCallback, useRef, useEffect } from "react";
import { useVideoEditor } from "../context/VideoEditorContext";
import { useDynamicComposition } from "@/hooks/useDynamicComposition";
import { Code2, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export function CodePanel() {
  const { state, setRemotionCode } = useVideoEditor();
  const [code, setCodeLocal] = useState(
    () => state.project.remotion_code || ""
  );
  const isLocalEdit = useRef(false);

  // Sync from context when remotion_code changes externally (e.g. AI chat generates code)
  useEffect(() => {
    if (isLocalEdit.current) return;
    const ctxCode = state.project.remotion_code || "";
    if (ctxCode !== code) {
      setCodeLocal(ctxCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.project.remotion_code]);

  // Sync to context (for auto-save) whenever code changes
  const setCode = useCallback(
    (newCode: string) => {
      isLocalEdit.current = true;
      setCodeLocal(newCode);
      setRemotionCode(newCode);
      setTimeout(() => {
        isLocalEdit.current = false;
      }, 0);
    },
    [setRemotionCode]
  );

  const hasCode = !!code.trim();
  const { error, isCompiling, component } = useDynamicComposition(
    hasCode ? code : ""
  );

  // Empty state
  if (!hasCode) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3 p-6">
        <Code2 className="h-8 w-8 text-muted-foreground/20" />
        <div>
          <p className="text-xs text-muted-foreground">
            No composition code yet
          </p>
          <p className="text-[10px] text-muted-foreground/50 mt-1">
            Use Chat to generate a Remotion composition, or paste code here.
          </p>
        </div>
        <textarea
          placeholder="// Paste Remotion composition code here..."
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          className="w-full h-32 resize-none bg-[#0d1117] text-[11px] font-mono text-[#e6edf3] p-3 rounded-md border border-border focus:outline-none focus:border-primary/50"
          style={{
            fontFamily:
              "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            lineHeight: "1.6",
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-border flex items-center gap-1.5 flex-shrink-0">
        <Code2 className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] font-medium text-muted-foreground">
          composition.tsx
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {isCompiling && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
          {!isCompiling && !error && component && (
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          )}
          {!isCompiling && error && (
            <AlertCircle className="h-3 w-3 text-destructive" title={error} />
          )}
        </span>
      </div>

      {/* Code textarea */}
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        className="flex-1 min-h-0 w-full resize-none bg-[#0d1117] text-[11px] font-mono text-[#e6edf3] p-2 focus:outline-none"
        style={{
          fontFamily:
            "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          lineHeight: "1.6",
        }}
      />

      {/* Error display */}
      {!isCompiling && error && (
        <div className="px-3 py-2 border-t border-destructive/30 bg-destructive/5 flex-shrink-0">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-destructive/80 leading-relaxed">
              {error}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
