import { splitForEllipsis } from "./middle-ellipsis";

// A one-line name that, when too long, loses its middle rather than its end.
export function MiddleEllipsis({ text, className = "" }: { text: string; className?: string }) {
  const [head, tail] = splitForEllipsis(text);
  return (
    <span className={`flex min-w-0 ${className}`}>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">{head}</span>
      {tail && <span className="shrink-0 whitespace-pre">{tail}</span>}
    </span>
  );
}
