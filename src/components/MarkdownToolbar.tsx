import { useRef, useState } from "react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table as TableIcon,
  Terminal,
} from "lucide-react";
import Modal from "./Modal";

/**
 * Markdown formatting toolbar that acts on whatever textarea is currently
 * focused. The parent owns:
 *   - tracking the active textarea (via onFocus)
 *   - storing the textarea's content in state
 *   - applying the new value when this toolbar reports a change
 */

export interface MarkdownEdit {
  value: string;       // the textarea's full new value
  cursor: number;      // where the caret should land
}

interface Props {
  /** Ref-style getter the toolbar uses to read the current textarea. Keep
   *  this as a function so the toolbar always sees the latest focused element
   *  even after re-renders. */
  getActive: () => HTMLTextAreaElement | null;
  /** Called when the user clicks a button. Parent should commit the new
   *  value to its block state, then restore caret to `cursor`. */
  onChange: (id: string, edit: MarkdownEdit) => void;
}

interface SimpleSpec {
  before: string;
  after: string;
  placeholder?: string;
  /** Apply the prefix to each line of the selection (lists, headings, quotes). */
  perLine?: boolean;
}

function applySimple(t: HTMLTextAreaElement, s: SimpleSpec): MarkdownEdit {
  const start = t.selectionStart;
  const end = t.selectionEnd;
  const value = t.value;
  const selected = value.slice(start, end);

  if (s.perLine) {
    // Per-line: split, prefix each, join
    const lines = (selected || s.placeholder || "").split("\n");
    const prefixed = lines.map((l) => s.before + l).join("\n");
    const next = value.slice(0, start) + prefixed + value.slice(end);
    return { value: next, cursor: start + prefixed.length };
  }

  const inner = selected || s.placeholder || "";
  const wrapped = s.before + inner + s.after;
  const next = value.slice(0, start) + wrapped + value.slice(end);
  // If the user had a selection, leave caret right after — they'll keep typing.
  // If they had no selection (placeholder used), select the placeholder so
  // their next keystroke replaces it.
  if (!selected && s.placeholder) {
    return {
      value: next,
      cursor: start + s.before.length + s.placeholder.length,
    };
  }
  return { value: next, cursor: start + wrapped.length };
}

function applyInsert(t: HTMLTextAreaElement, text: string): MarkdownEdit {
  const start = t.selectionStart;
  const end = t.selectionEnd;
  const next = t.value.slice(0, start) + text + t.value.slice(end);
  return { value: next, cursor: start + text.length };
}

function buildTableMarkdown(rows: number, cols: number): string {
  const header = "| " + Array(cols).fill("Header").join(" | ") + " |";
  const sep = "| " + Array(cols).fill("---").join(" | ") + " |";
  const body = Array(rows)
    .fill(0)
    .map(
      () =>
        "| " +
        Array(cols)
          .fill("")
          .map(() => "  ")
          .join(" | ") +
        " |"
    )
    .join("\n");
  return `\n\n${header}\n${sep}\n${body}\n\n`;
}

const Sep = () => <span className="mx-1 h-5 w-px bg-ink-200" aria-hidden />;

export default function MarkdownToolbar({ getActive, onChange }: Props) {
  const [tableOpen, setTableOpen] = useState(false);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fire = (s: SimpleSpec) => {
    const t = getActive();
    if (!t) return;
    const id = t.dataset.blockId;
    if (!id) return;
    onChange(id, applySimple(t, s));
  };

  const insertText = (text: string) => {
    const t = getActive();
    if (!t) return;
    const id = t.dataset.blockId;
    if (!id) return;
    onChange(id, applyInsert(t, text));
  };

  const onLink = () => {
    const t = getActive();
    if (!t) return;
    const url = window.prompt("Link URL:", "https://");
    if (!url) return;
    const id = t.dataset.blockId;
    if (!id) return;
    const start = t.selectionStart;
    const end = t.selectionEnd;
    const selected = t.value.slice(start, end);
    const text = selected || "link text";
    const md = `[${text}](${url})`;
    const next = t.value.slice(0, start) + md + t.value.slice(end);
    onChange(id, { value: next, cursor: start + md.length });
  };

  const onImage = async (file: File) => {
    setImgErr(null);
    if (!file.type.startsWith("image/")) {
      setImgErr(`${file.name}: not an image`);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setImgErr(
        `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB — please pick something under 2 MB`
      );
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("failed to read"));
      r.readAsDataURL(file);
    });
    insertText(`\n![${file.name}](${dataUrl})\n`);
  };

  const isActive = !!getActive();
  const baseBtn =
    "flex h-8 w-8 items-center justify-center rounded text-ink-700 hover:bg-ink-100 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="card flex flex-wrap items-center gap-0.5 px-2 py-1.5">
      <button
        type="button"
        title="Bold (Ctrl+B style)"
        disabled={!isActive}
        className={baseBtn}
        onClick={() => fire({ before: "**", after: "**", placeholder: "bold" })}
      >
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Italic"
        disabled={!isActive}
        className={baseBtn}
        onClick={() => fire({ before: "*", after: "*", placeholder: "italic" })}
      >
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Strikethrough"
        disabled={!isActive}
        className={baseBtn}
        onClick={() =>
          fire({ before: "~~", after: "~~", placeholder: "struck" })
        }
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </button>

      <Sep />

      <button
        type="button"
        title="Heading 1"
        disabled={!isActive}
        className={baseBtn}
        onClick={() =>
          fire({ before: "# ", after: "", placeholder: "Heading 1", perLine: true })
        }
      >
        <Heading1 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Heading 2"
        disabled={!isActive}
        className={baseBtn}
        onClick={() =>
          fire({ before: "## ", after: "", placeholder: "Heading 2", perLine: true })
        }
      >
        <Heading2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Heading 3"
        disabled={!isActive}
        className={baseBtn}
        onClick={() =>
          fire({ before: "### ", after: "", placeholder: "Heading 3", perLine: true })
        }
      >
        <Heading3 className="h-3.5 w-3.5" />
      </button>

      <Sep />

      <button
        type="button"
        title="Bulleted list"
        disabled={!isActive}
        className={baseBtn}
        onClick={() =>
          fire({ before: "- ", after: "", placeholder: "item", perLine: true })
        }
      >
        <List className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Numbered list"
        disabled={!isActive}
        className={baseBtn}
        onClick={() =>
          fire({ before: "1. ", after: "", placeholder: "item", perLine: true })
        }
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Task list"
        disabled={!isActive}
        className={baseBtn}
        onClick={() =>
          fire({
            before: "- [ ] ",
            after: "",
            placeholder: "task",
            perLine: true,
          })
        }
      >
        <ListChecks className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Quote"
        disabled={!isActive}
        className={baseBtn}
        onClick={() =>
          fire({ before: "> ", after: "", placeholder: "quote", perLine: true })
        }
      >
        <Quote className="h-3.5 w-3.5" />
      </button>

      <Sep />

      <button
        type="button"
        title="Inline code"
        disabled={!isActive}
        className={baseBtn}
        onClick={() => fire({ before: "`", after: "`", placeholder: "code" })}
      >
        <Code className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Code block"
        disabled={!isActive}
        className={baseBtn}
        onClick={() =>
          fire({
            before: "\n```\n",
            after: "\n```\n",
            placeholder: "your code here",
          })
        }
      >
        <Terminal className="h-3.5 w-3.5" />
      </button>

      <Sep />

      <button
        type="button"
        title="Link"
        disabled={!isActive}
        className={baseBtn}
        onClick={onLink}
      >
        <Link2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Insert image (≤2 MB, embedded as data URL)"
        disabled={!isActive}
        className={baseBtn}
        onClick={() => fileRef.current?.click()}
      >
        <ImageIcon className="h-3.5 w-3.5" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImage(f);
          e.target.value = "";
        }}
      />

      <Sep />

      <button
        type="button"
        title="Insert table"
        disabled={!isActive}
        className={baseBtn}
        onClick={() => setTableOpen(true)}
      >
        <TableIcon className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Horizontal rule"
        disabled={!isActive}
        className={baseBtn}
        onClick={() => insertText("\n\n---\n\n")}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>

      {!isActive && (
        <span className="ml-2 text-[11px] text-ink-400">
          click into an answer to start formatting
        </span>
      )}
      {imgErr && (
        <span className="ml-2 text-[11px] text-red-600">{imgErr}</span>
      )}

      <TableInsertModal
        open={tableOpen}
        onClose={() => setTableOpen(false)}
        onInsert={(rows, cols) => {
          insertText(buildTableMarkdown(rows, cols));
          setTableOpen(false);
        }}
      />
    </div>
  );
}

function TableInsertModal({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (rows: number, cols: number) => void;
}) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="md"
      title="Insert table"
      subtitle="Choose dimensions; you can edit cells directly in the answer."
      footer={
        <>
          <button onClick={onClose} className="btn">
            Cancel
          </button>
          <button
            onClick={() => onInsert(rows, cols)}
            className="btn-primary"
          >
            Insert
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] uppercase tracking-wide text-ink-500">
            Rows
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={rows}
            onChange={(e) =>
              setRows(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
            }
            className="input mt-1 w-full"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-ink-500">
            Columns
          </label>
          <input
            type="number"
            min={1}
            max={10}
            value={cols}
            onChange={(e) =>
              setCols(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
            }
            className="input mt-1 w-full"
          />
        </div>
      </div>

      {/* Preview the markdown that will be inserted */}
      <div className="mt-4">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-500">
          Preview
        </div>
        <pre className="mono max-h-44 overflow-auto rounded-md border border-ink-100 bg-ink-50 p-2 text-[11px] text-ink-700">
          {buildTableMarkdown(rows, cols).trim()}
        </pre>
      </div>
    </Modal>
  );
}
