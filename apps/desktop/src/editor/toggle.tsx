// Toggle list block (FR21-BLK-002). Serialized as an HTML <details> block with
// the blank lines required by external renderers. Open/closed state is
// session-only and never serialized (no `open` attribute).
import { useState } from "react";
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

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ToggleView({ node, updateAttributes, editor }: NodeViewProps) {
  const [open, setOpen] = useState(true); // session-only, never serialized
  const title = (node.attrs.title as string) || "";
  // Real <details>/<summary> so external-renderer parity holds in the DOM; the
  // native toggle is suppressed and driven by our own chevron/open state.
  return (
    <NodeViewWrapper as="details" className="toggle" data-toggle="" open={open || undefined}>
      <summary
        className="toggle-summary"
        contentEditable={false}
        onClick={(e) => e.preventDefault()}
      >
        <button
          className="toggle-chevron"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? "▾" : "▸"}
        </button>
        <input
          className="toggle-title"
          placeholder="Toggle title"
          value={title}
          onChange={(e) => updateAttributes({ title: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
          disabled={!editor.isEditable}
        />
      </summary>
      <NodeViewContent className="toggle-body" />
    </NodeViewWrapper>
  );
}

export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return { title: { default: "" } };
  },

  parseHTML() {
    return [
      {
        tag: "details",
        getAttrs: (el) => ({
          title:
            (el as HTMLElement).getAttribute("data-summary") ||
            (el as HTMLElement).querySelector("summary")?.textContent ||
            "",
        }),
        // Body lives in the content wrapper; the <summary> is not content.
        contentElement: (el) =>
          (el as HTMLElement).querySelector("[data-toggle-content]") ??
          (el as HTMLElement),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "details",
      mergeAttributes(HTMLAttributes, {
        "data-toggle": "",
        "data-summary": node.attrs.title || "",
      }),
      ["div", { "data-toggle-content": "" }, 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          // Emit summary line, a blank line, body, a blank line, closing tag.
          state.write("<details><summary>" + (node.attrs.title || "") + "</summary>");
          state.closeBlock(node);
          state.renderContent(node);
          state.write("</details>");
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.block.ruler.before(
              "html_block",
              "toggle",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (state: any, startLine: number, endLine: number, silent: boolean) => {
                const pos = state.bMarks[startLine] + state.tShift[startLine];
                const max = state.eMarks[startLine];
                const line = state.src.slice(pos, max);
                const m = /^<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*$/i.exec(line);
                if (!m) return false;
                let found = -1;
                let nextLine = startLine + 1;
                for (; nextLine < endLine; nextLine++) {
                  const p = state.bMarks[nextLine] + state.tShift[nextLine];
                  const mx = state.eMarks[nextLine];
                  if (/^<\/details>\s*$/i.test(state.src.slice(p, mx))) {
                    found = nextLine;
                    break;
                  }
                }
                if (found === -1) return false;
                if (silent) return true;
                const title = m[1];
                const innerMd = state.getLines(startLine + 1, found, 0, false);
                const innerHtml = innerMd.trim() ? state.md.render(innerMd) : "";
                const token = state.push("html_block", "", 0);
                token.map = [startLine, found + 1];
                token.content =
                  `<details data-toggle data-summary="${escapeAttr(title)}">` +
                  `<div data-toggle-content>\n${innerHtml}</div></details>\n`;
                state.line = found + 1;
                return true;
              },
              { alt: [] },
            );
          },
        },
      },
    };
  },
});

export default Toggle;
