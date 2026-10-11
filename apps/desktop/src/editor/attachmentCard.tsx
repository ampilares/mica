// Attachment cards (FR21-BLK-005). A paragraph whose sole content is a
// Markdown link to a NON-image vault file (relative path) renders as a card
// with an extension icon, the file name, and its size. Clicking opens the
// file externally. The Markdown on disk stays exactly `[name](rel/path)`,
// byte-identical round-trip like the wave-1 blocks.
import { useEffect, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  NodeViewProps,
} from "@tiptap/react";
import type MarkdownIt from "markdown-it";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as PMNode } from "@tiptap/pm/model";
import { api } from "../api";
import { resolveRelative } from "./paths";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|tiff?)$/i;

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** True for a relative (schemeless) path — not http(s)/mailto/protocol-relative. */
function isRelative(href: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//");
}

function extOf(href: string): string {
  const base = href.split(/[\\/]/).pop() ?? href;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function fileNameOf(href: string): string {
  return decodeURIComponent(href.split(/[\\/]/).pop() ?? href);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const GLYPH: Record<string, string> = {
  pdf: "📕",
  doc: "📘",
  docx: "📘",
  xls: "📗",
  xlsx: "📗",
  csv: "📗",
  ppt: "📙",
  pptx: "📙",
  zip: "🗜",
  gz: "🗜",
  rar: "🗜",
  md: "📝",
  txt: "📄",
  mp3: "🎵",
  wav: "🎵",
  mp4: "🎬",
  mov: "🎬",
  webm: "🎬",
};

function AttachmentView({ notePath, node }: NodeViewProps & { notePath: string }) {
  const href = (node.attrs.href as string) || "";
  const text = (node.attrs.text as string) || fileNameOf(href);
  const ext = extOf(href);
  const rel = resolveRelative(notePath, href);
  const [meta, setMeta] = useState<string>("");

  useEffect(() => {
    let alive = true;
    api
      .assetStat(rel)
      .then((s) => {
        if (alive) setMeta(formatSize(s.size));
      })
      .catch(() => {
        if (alive) setMeta("missing");
      });
    return () => {
      alive = false;
    };
  }, [rel]);

  return (
    <NodeViewWrapper
      as="div"
      className="attachment-card"
      data-attachment=""
      contentEditable={false}
      onClick={() => void api.vaultOpenExternal(rel).catch(() => {})}
      title={`Open ${text}`}
    >
      <span className="attachment-icon">
        <span>{GLYPH[ext] ?? "📎"}</span>
        {ext && <span className="attachment-ext">{ext}</span>}
      </span>
      <span className="attachment-body">
        <span className="attachment-name">{text}</span>
        <span className="attachment-meta">
          {meta ? meta : "…"}
          {meta && meta !== "missing" ? " · click to open" : ""}
        </span>
      </span>
    </NodeViewWrapper>
  );
}

/**
 * The attachment node is created per open document because rendering needs the
 * containing note's path to resolve the relative asset href.
 */
export function AttachmentCard(notePath: string) {
  return Node.create({
    name: "attachmentCard",
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
      return {
        href: { default: "" },
        text: { default: "" },
      };
    },

    parseHTML() {
      return [
        {
          tag: "div[data-attachment]",
          getAttrs: (el) => ({
            href: (el as HTMLElement).getAttribute("data-href") || "",
            text: (el as HTMLElement).getAttribute("data-text") || "",
          }),
        },
      ];
    },

    renderHTML({ node, HTMLAttributes }) {
      return [
        "div",
        mergeAttributes(HTMLAttributes, {
          "data-attachment": "",
          "data-href": node.attrs.href || "",
          "data-text": node.attrs.text || "",
        }),
      ];
    },

    addNodeView() {
      return ReactNodeViewRenderer((p: NodeViewProps) => (
        <AttachmentView {...p} notePath={notePath} />
      ));
    },

    addStorage() {
      return {
        markdown: {
          serialize(state: MarkdownSerializerState, node: PMNode) {
            state.write(`[${node.attrs.text}](${node.attrs.href})`);
            state.closeBlock(node);
          },
          parse: {
            setup(markdownit: MarkdownIt) {
              markdownit.block.ruler.before(
                "paragraph",
                "attachment_card",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (state: any, startLine: number, endLine: number, silent: boolean) => {
                  const pos = state.bMarks[startLine] + state.tShift[startLine];
                  const max = state.eMarks[startLine];
                  const line = state.src.slice(pos, max).trim();
                  const m = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line);
                  if (!m) return false;
                  const text = m[1];
                  const href = m[2];
                  // Only relative links to non-image vault files become cards.
                  if (!isRelative(href) || IMAGE_EXT.test(href)) return false;
                  // Must be a standalone paragraph (next line blank / end).
                  if (startLine + 1 < endLine && !state.isEmpty(startLine + 1))
                    return false;
                  if (silent) return true;
                  const token = state.push("html_block", "", 0);
                  token.map = [startLine, startLine + 1];
                  token.content =
                    `<div data-attachment data-href="${escapeAttr(href)}" ` +
                    `data-text="${escapeAttr(text)}"></div>\n`;
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
}

export default AttachmentCard;
