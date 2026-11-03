import { Fragment } from "react";

function PreviewText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{\{\s*[\w.]+\s*\}\})/g).map((part, index) => {
        const match = part.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
        return match ? (
          <span
            key={index}
            title={part}
            className="mx-0.5 inline whitespace-nowrap rounded-[5px] bg-[#fbf0d0] px-[5px] font-mono text-[0.86em] text-[#7a5a12] dark:bg-amber-950 dark:text-amber-300"
          >
            {match[1]}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        );
      })}
    </>
  );
}

export function NodeCopyPreview({
  content,
  subject,
  isPrompt,
}: {
  content?: string;
  subject?: string;
  isPrompt?: boolean;
}) {
  if (!content && !subject) return null;
  return (
    <div className="text-muted-foreground">
      {isPrompt && (
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          AI prompt
        </div>
      )}
      {subject && (
        <p
          className="mb-1 line-clamp-1 font-medium text-foreground"
          title={subject}
        >
          <PreviewText text={subject} />
        </p>
      )}
      {content && (
        <p className="line-clamp-2" title={content}>
          <PreviewText text={content} />
        </p>
      )}
    </div>
  );
}
