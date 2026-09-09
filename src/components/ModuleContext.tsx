import { ModuleContextEditor } from "@/components/ModuleContextEditor";
import { NOTES_TEMPLATE } from "@/lib/module-context";

export interface ModuleContextProps {
  moduleId: number;
  context: string;
  profile: string | null;
  profiledAt: number | null;
  profileSource: string | null;
  notes: string | null;
  notesUpdatedAt: number | null;
}

const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// The profile is a few short headed paragraphs and bullet lists, in a shape
// the prompt fixes, so a line-by-line renderer covers it without pulling the
// study-guide renderer (a client component) into the overview.
function Profile({ markdown }: { markdown: string }) {
  const blocks: { kind: "h" | "p" | "li"; text: string }[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("### ")) blocks.push({ kind: "h", text: line.slice(4) });
    else if (/^[-*] /.test(line)) blocks.push({ kind: "li", text: line.slice(2) });
    else blocks.push({ kind: "p", text: line });
  }
  return (
    <div className="space-y-1.5 text-sm leading-[1.65] text-ink-2">
      {blocks.map((b, i) =>
        b.kind === "h" ? (
          <p key={i} className={`font-medium text-ink ${i > 0 ? "pt-2" : ""}`}>{b.text}</p>
        ) : b.kind === "li" ? (
          <p key={i} className="pl-4 before:absolute before:-ml-3 before:content-['–'] relative">{b.text}</p>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </div>
  );
}

// What the model is told about a module before it writes for it. Three
// sources, shown as three things: facts from the database (assessment, deck
// list), the model's own profile of the module from the last guide run, and
// the student's notes. The full assembled document is one fold away, because
// "what does it actually see" is the question this section answers.
export function ModuleContext(p: ModuleContextProps) {
  return (
    <div>
      <p className="max-w-prose text-sm text-ink-3">
        What the model knows about this module before it writes a guide. The assessment and deck list come from Canvas;
        the profile is written by the model from the decks each time a guide is generated; the notes are yours, and the
        place for what the slides cannot show — the exam format, what the lecturer stresses in class, what to go deep on.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-2 lg:items-start">
        <div>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">
            Observed from the decks
            {p.profiledAt && (
              <span className="ml-2 normal-case tracking-normal">
                {p.profileSource ? `${p.profileSource}, ` : ""}{shortDate(p.profiledAt)}
              </span>
            )}
          </h3>
          {p.profile ? (
            <Profile markdown={p.profile} />
          ) : (
            <p className="text-sm text-ink-3">Nothing yet. The model writes this at the start of each guide generation.</p>
          )}
        </div>

        <div>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">
            Your notes
            {p.notesUpdatedAt && <span className="ml-2 normal-case tracking-normal">saved {shortDate(p.notesUpdatedAt)}</span>}
          </h3>
          <ModuleContextEditor moduleId={p.moduleId} initialNotes={p.notes} template={NOTES_TEMPLATE} />
        </div>
      </div>

      <details className="mt-6">
        <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-ink-3 hover:text-ink-2">
          What the model sees
        </summary>
        <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap border border-line bg-surface p-3 font-mono text-[12px] leading-[1.6] text-ink-2">
          {p.context}
        </pre>
      </details>
    </div>
  );
}
