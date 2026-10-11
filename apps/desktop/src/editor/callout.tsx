// Callout block (FR21-BLK-001). Obsidian syntax `> [!kind] Title` inside a
// blockquote. Kinds: note, info, tip, warning, danger, quote. Unknown kinds
// render as `note` but re-serialize their original kind verbatim.
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  NodeViewProps,
} from "@tiptap/react";
import type MarkdownIt from "markdown-it";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as PMNode } from "@tiptap/pm/model";

const KNOWN_KINDS = ["note", "info", "tip", "warning", "danger", "quote"] as const;
const KIND_GLYPH: Record<string, string> = {
  note: "✎",
  info: "ⓘ",
  tip: "💡",
  warning: "⚠",
  danger: "⛔",
  quote: "❝",
};

function styleKind(kind: string): string {
  return KNOWN_KINDS.includes(kind as (typeof KNOWN_KINDS)[number]) ? kind : "note";
}

// Escape a value for safe insertion into an HTML attribute (parseHTML decodes
// it back byte-identically via getAttribute).
function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const kind = (node.attrs.kind as string) || "note";
  const title = (node.attrs.title as string) || "";
  const sk = styleKind(kind);
  return (
    <NodeViewWrapper className="callout" data-kind={sk}>
      <div className="callout-header" contentEditable={false}>
        <span className="callout-icon">{KIND_GLYPH[sk] ?? KIND_GLYPH.note}</span>
        <select
          className="callout-kind"
          value={KNOWN_KINDS.includes(kind as (typeof KNOWN_KINDS)[number]) ? kind : "note"}
          onChange={(e) => updateAttributes({ kind: e.target.value })}
          disabled={!editor.isEditable}
        >
          {KNOWN_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          className="callout-title"
          placeholder="Title"
          value={title}
          onChange={(e) => updateAttributes({ title: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
          disabled={!editor.isEditable}
        />
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      kind: { default: "info" },
      title: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-callout]",
        getAttrs: (el) => ({
          kind: (el as HTMLElement).getAttribute("data-kind") || "note",
          title: (el as HTMLElement).getAttribute("data-title") || "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-callout": "",
        "data-kind": node.attrs.kind || "note",
        "data-title": node.attrs.title || "",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addStorage() {
    return {
      markdown: {
        // Serializer always re-emits the `> [!kind] title` marker line, then
        // the body as blockquote lines.
        serialize(state: MarkdownSerializerState, node: PMNode) {
          const kind = (node.attrs.kind as string) || "note";
          const title = node.attrs.title ? " " + node.attrs.title : "";
          state.wrapBlock("> ", null, node, () => {
            state.write(`[!${kind}]${title}`);
            state.ensureNewLine();
            state.renderContent(node);
          });
        },
        parse: {
          // markdown-it block rule: a blockquote whose first line is a
          // `[!kind]` marker becomes a callout element our parseHTML matches.
          setup(markdownit: MarkdownIt) {
            markdownit.block.ruler.before(
              "blockquote",
              "callout",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (state: any, startLine: number, endLine: number, silent: boolean) => {
                const pos = state.bMarks[startLine] + state.tShift[startLine];
                const max = state.eMarks[startLine];
                if (state.src.charCodeAt(pos) !== 0x3e /* > */) return false;
                const firstLine = state.src.slice(pos, max);
                const m = /^>\s?\[!([A-Za-z0-9_-]+)\]\s?(.*)$/.exec(firstLine);
                if (!m) return false;
                if (silent) return true;
                const kind = m[1];
                const title = m[2].trim();
                let nextLine = startLine + 1;
                const bodyLines: string[] = [];
                for (; nextLine < endLine; nextLine++) {
                  const p = state.bMarks[nextLine] + state.tShift[nextLine];
                  const mx = state.eMarks[nextLine];
                  if (state.src.charCodeAt(p) !== 0x3e /* > */) break;
                  bodyLines.push(state.src.slice(p, mx).replace(/^>\s?/, ""));
                }
                const innerHtml = state.md.render(bodyLines.join("\n"));
                const token = state.push("html_block", "", 0);
                token.map = [startLine, nextLine];
                token.content =
                  `<div data-callout data-kind="${escapeAttr(kind)}" ` +
                  `data-title="${escapeAttr(title)}">\n${innerHtml}</div>\n`;
                state.line = nextLine;
                return true;
              },
            );
          },
        },
      },
    };
  },
});

export default Callout;
