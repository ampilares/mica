// Math blocks (FR21-BLK-004). Inline `$...$` and block `$$...$$`. The node
// stores raw LaTeX verbatim and re-serializes it byte-identically; invalid
// LaTeX renders the raw source with an error tint (never crashes).
import { useEffect, useRef, useState } from "react";
import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  NodeViewProps,
} from "@tiptap/react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type MarkdownIt from "markdown-it";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as PMNode } from "@tiptap/pm/model";

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Render LaTeX to HTML; returns null html on error so the caller can show the
// raw source with an error tint.
function renderKatex(latex: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: true });
  } catch {
    return null;
  }
}

function MathView(props: NodeViewProps & { display: boolean }) {
  const { node, updateAttributes, editor, display } = props;
  const latex = (node.attrs.latex as string) || "";
  const [editing, setEditing] = useState(latex.trim() === "");
  const [draft, setDraft] = useState(latex);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(latex);
  }, [latex]);

  useEffect(() => {
    if (editing) fieldRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== latex) updateAttributes({ latex: draft });
  };

  const startEdit = () => {
    if (editor.isEditable) {
      setDraft(latex);
      setEditing(true);
    }
  };

  const wrapperTag = display ? "div" : "span";
  const trimmed = latex.trim();
  const html = trimmed ? renderKatex(trimmed, display) : null;

  if (editing) {
    const commonProps = {
      ref: fieldRef,
      className: display ? "math-input math-input-block" : "math-input",
      value: draft,
      placeholder: display ? "LaTeX (block)" : "LaTeX",
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          setDraft(latex);
          setEditing(false);
        } else if (e.key === "Enter" && (!display || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        }
      },
    };
    return (
      <NodeViewWrapper as={wrapperTag} className="math math-editing" data-math-editing="true">
        {display ? <textarea {...commonProps} rows={2} /> : <input {...commonProps} />}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as={wrapperTag}
      className={"math" + (display ? " math-block" : " math-inline")}
      data-math=""
      onClick={startEdit}
    >
      {html ? (
        <span className="math-render" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="math-error" title="Invalid LaTeX">
          {latex || (display ? "$$ $$" : "$ $")}
        </span>
      )}
    </NodeViewWrapper>
  );
}

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { latex: { default: "" } };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-math-inline]",
        getAttrs: (el) => ({
          latex:
            (el as HTMLElement).getAttribute("data-latex") ??
            (el as HTMLElement).textContent ??
            "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-math-inline": "",
        "data-latex": node.attrs.latex || "",
      }),
      node.attrs.latex || "",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer((p: NodeViewProps) => (
      <MathView {...p} display={false} />
    ));
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\$([^$\n]+)\$$/,
        handler: ({ range, match, chain }) => {
          chain()
            .deleteRange(range)
            .insertContent({ type: "mathInline", attrs: { latex: match[1] } })
            .run();
        },
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          state.write("$" + (node.attrs.latex || "") + "$");
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.inline.ruler.after(
              "escape",
              "math_inline",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (state: any, silent: boolean) => {
                const start = state.pos;
                const max = state.posMax;
                if (state.src.charCodeAt(start) !== 0x24 /* $ */) return false;
                let pos = start + 1;
                if (pos >= max) return false;
                const next = state.src.charCodeAt(pos);
                // opening $ not followed by whitespace or another $
                if (next === 0x20 || next === 0x09 || next === 0x0a || next === 0x24)
                  return false;
                let found = -1;
                let p = pos;
                while (p < max) {
                  const c = state.src.charCodeAt(p);
                  if (c === 0x5c /* \ */) {
                    p += 2;
                    continue;
                  }
                  if (c === 0x24) {
                    const before = state.src.charCodeAt(p - 1);
                    const after = p + 1 < max ? state.src.charCodeAt(p + 1) : -1;
                    // closing $ not preceded by whitespace, not followed by a
                    // digit (avoids treating currency like `$5 ... $10` as math)
                    if (
                      before !== 0x20 &&
                      before !== 0x09 &&
                      !(after >= 0x30 && after <= 0x39)
                    ) {
                      found = p;
                      break;
                    }
                  }
                  p++;
                }
                if (found === -1) return false;
                const content = state.src.slice(pos, found);
                if (content.trim() === "") return false;
                if (!silent) {
                  const token = state.push("html_inline", "", 0);
                  token.content = `<span data-math-inline data-latex="${escapeAttr(
                    content,
                  )}"></span>`;
                }
                state.pos = found + 1;
                return true;
              },
            );
          },
        },
      },
    };
  },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { latex: { default: "" } };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-math-block]",
        getAttrs: (el) => ({
          latex:
            (el as HTMLElement).getAttribute("data-latex") ??
            (el as HTMLElement).textContent ??
            "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-math-block": "",
        "data-latex": node.attrs.latex || "",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer((p: NodeViewProps) => (
      <MathView {...p} display={true} />
    ));
  },

  addStorage() {
    return {
      markdown: {
        // latex captured verbatim (incl. surrounding newlines for the
        // fenced form) so `$$` + latex + `$$` is byte-identical to the source.
        serialize(state: MarkdownSerializerState, node: PMNode) {
          state.write("$$" + (node.attrs.latex || "") + "$$");
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.block.ruler.before(
              "fence",
              "math_block",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (state: any, startLine: number, endLine: number, silent: boolean) => {
                const pos = state.bMarks[startLine] + state.tShift[startLine];
                const max = state.eMarks[startLine];
                if (
                  state.src.charCodeAt(pos) !== 0x24 ||
                  state.src.charCodeAt(pos + 1) !== 0x24
                )
                  return false;
                const firstLine = state.src.slice(pos, max);
                // Single-line form `$$ ... $$`.
                const single = /^\$\$([\s\S]+?)\$\$\s*$/.exec(firstLine);
                if (single && single[1].indexOf("$$") === -1) {
                  if (silent) return true;
                  const token = state.push("html_block", "", 0);
                  token.map = [startLine, startLine + 1];
                  token.content = `<div data-math-block data-latex="${escapeAttr(
                    single[1],
                  )}"></div>\n`;
                  state.line = startLine + 1;
                  return true;
                }
                // Multi-line fenced form: opening line is exactly `$$`.
                if (firstLine.trim() !== "$$") return false;
                let found = -1;
                let nextLine = startLine + 1;
                for (; nextLine < endLine; nextLine++) {
                  const p = state.bMarks[nextLine] + state.tShift[nextLine];
                  const mx = state.eMarks[nextLine];
                  if (state.src.slice(p, mx).trim() === "$$") {
                    found = nextLine;
                    break;
                  }
                }
                if (found === -1) return false;
                if (silent) return true;
                const inner = state.getLines(startLine + 1, found, 0, false);
                const latex = "\n" + inner.replace(/\n$/, "") + "\n";
                const token = state.push("html_block", "", 0);
                token.map = [startLine, found + 1];
                token.content = `<div data-math-block data-latex="${escapeAttr(
                  latex,
                )}"></div>\n`;
                state.line = found + 1;
                return true;
              },
            );
          },
        },
      },
    };
  },
});
