import { Star } from "lucide-react";

interface ScoreDisplayProps {
  score: number | null;
}

export function ScoreDisplay({ score }: ScoreDisplayProps) {
  if (score === null || score === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="flex items-center gap-1">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      <span>{score}</span>
    </div>
  );
}
