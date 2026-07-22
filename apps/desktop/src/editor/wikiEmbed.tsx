// Wiki embeds (FR21-BLK-008). `![[Note]]` / `![[Note#Heading]]` on their own
// paragraph render the referenced content read-only, with a source-title header
// and an "Open" jump. Content comes from api.noteSection (whole body, or the
// section under an ATX heading) and is rendered with a static markdown-it
// instance. The Markdown on disk stays exactly `![[Target]]` /
// `![[Target#Heading]]`, byte-identical round-trip.
//
// NOTE (deviation): the spec allows depth-3 nesting; this caps at depth 1 —
// wiki links / embeds inside embedded content render as plain text (their
// target name), not as interactive links, to avoid recursive fetching.
import { useEffect, useMemo, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  NodeViewProps,
} from "@tiptap/react";
import MarkdownIt from "markdown-it";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import { api, isApiError } from "../api";
import { useStore } from "../store";
import { docEvents } from "../docEvents";

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Static renderer for embedded content (depth 1). No wiki/embed rules attached,
// so nested constructs are flattened to plain text before rendering.
const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

/** Flatten nested `![[..]]` / `[[..]]` to their display text (depth cap). */
function flattenNested(src: string): string {
  return src
    .replace(/!\[\[([^\]]+)\]\]/g, (_m, inner) => inner.split(/[#|]/)[0].trim())
    .replace(/\[\[([^\]]+)\]\]/g, (_m, inner) => {
      const parts = String(inner).split("|");
      return (parts.length > 1 ? parts[1] : parts[0].split("#")[0]).trim();
    });
}

function WikiEmbedView({ node }: NodeViewProps) {
  const target = (node.attrs.target as string) || "";
  const heading = (node.attrs.heading as string) || "";
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "unresolved" | "missing">(
    "loading",
  );
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    (async () => {
      try {
        const resolved = await api.resolveWiki(target);
        if (!alive) return;
        if (!resolved) {
          setPath(null);
          setStatus("unresolved");
          return;
        }
        setPath(resolved);
        const section = await api.noteSection(resolved, heading || undefined);
        if (!alive) return;
        setContent(section);
        setStatus("ok");
      } catch (e) {
        if (!alive) return;
        if (isApiError(e) && e.code === "heading_not_found") setStatus("missing");
        else setStatus("unresolved");
      }
    })();
    return () => {
      alive = false;
    };
  }, [target, heading, nonce]);

  // Refresh when the resolved source file changes on disk.
  useEffect(() => {
    if (!path) return;
    return docEvents.on((ev) => {
      const affected =
        (ev.type === "modified" && ev.path === path) ||
        (ev.type === "renamed" && (ev.from === path || ev.to === path)) ||
        ev.type === "created";
      if (affected) setNonce((n) => n + 1);
    });
  }, [path]);

  const html = useMemo(
    () => (content != null ? md.render(flattenNested(content)) : ""),
    [content],
  );

  const label = heading ? `${target} › ${heading}` : target;

  if (status === "unresolved" || status === "missing") {
    return (
      <NodeViewWrapper as="div" contentEditable={false}>
        <span className="wiki-embed-unresolved">
          <span>⚠</span>
          <span>
            {status === "missing"
              ? `Heading not found: ${label}`
              : `Unresolved embed: ${label}`}
          </span>
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="div" className="wiki-embed" contentEditable={false}>
      <div className="wiki-embed-head">
        <span className="wiki-embed-source">{label}</span>
        {path && (
          <button
            className="wiki-embed-open"
            onClick={() => useStore.getState().openDoc(path)}
          >
            Open
          </button>
        )}
      </div>
      {status === "loading" ? (
        <div className="wiki-embed-loading">Loading embed…</div>
      ) : (
        <div
          className="wiki-embed-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </NodeViewWrapper>
  );
}

export const WikiEmbed = Node.create({
  name: "wikiEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      target: { default: "" },
      heading: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-wiki-embed]",
        getAttrs: (el) => ({
          target: (el as HTMLElement).getAttribute("data-target") || "",
          heading: (el as HTMLElement).getAttribute("data-heading") || "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-wiki-embed": "",
        "data-target": node.attrs.target || "",
        "data-heading": node.attrs.heading || "",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WikiEmbedView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          const h = node.attrs.heading ? `#${node.attrs.heading}` : "";
          state.write(`![[${node.attrs.target}${h}]]`);
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.block.ruler.before(
              "paragraph",
              "wiki_embed",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (state: any, startLine: number, endLine: number, silent: boolean) => {
                const pos = state.bMarks[startLine] + state.tShift[startLine];
                const max = state.eMarks[startLine];
                const line = state.src.slice(pos, max).trim();
                const m = /^!\[\[([^\]#|]+)(?:#([^\]|]+))?\]\]$/.exec(line);
                if (!m) return false;
                if (startLine + 1 < endLine && !state.isEmpty(startLine + 1))
                  return false;
                if (silent) return true;
                const token = state.push("html_block", "", 0);
                token.map = [startLine, startLine + 1];
                token.content =
                  `<div data-wiki-embed data-target="${escapeAttr(m[1].trim())}" ` +
                  `data-heading="${escapeAttr((m[2] || "").trim())}"></div>\n`;
                state.line = startLine + 1;
                return true;
              },
            );
          },
        },
      },
    };
  },
});

export default WikiEmbed;
