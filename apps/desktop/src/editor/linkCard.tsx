// Link cards & embeds (FR21-BLK-006/007). Presentation is stored in the file
// via the link-title convention (spec §1.6):
//   [Title](https://url "mica:card")   → preview card
//   [Title](https://url "mica:embed")  → embed (YouTube iframe, else card)
// Other renderers see a plain link with an invisible title attribute, so this
// degrades gracefully. Round-trip is byte-identical.
//
// NOTE (deviation): the spec lists separate `linkCard` and `embedFrame` nodes;
// this merges them into one `linkCard` node with a `mode` attribute. The
// on-disk form (what round-trips) is unchanged.
import { useEffect, useState } from "react";
import { Node, mergeAttributes, Extension } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  NodeViewProps,
} from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import { api, isApiError } from "../api";
import { useStore } from "../store";

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Extract a YouTube video id from the common URL shapes, else null. */
export function youtubeId(url: string): string | null {
  const m =
    /(?:youtube\.com\/(?:watch\?[^#]*\bv=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(
      url,
    );
  return m ? m[1] : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------- node view --

function EmbedYouTube({ id, title }: { id: string; title: string }) {
  return (
    <NodeViewWrapper as="div" className="embed-frame" data-embed="youtube" contentEditable={false}>
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}`}
        title={title || "YouTube video"}
        loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </NodeViewWrapper>
  );
}

interface Preview {
  title: string;
  description: string;
  favicon: string;
}

function LinkCardView({ node, updateAttributes }: NodeViewProps) {
  const url = (node.attrs.url as string) || "";
  const storedTitle = (node.attrs.title as string) || "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "disabled" | "offline">(
    "loading",
  );

  useEffect(() => {
    let alive = true;
    setState("loading");
    api
      .linkPreview(url)
      .then((p) => {
        if (!alive) return;
        setPreview(p);
        setState("ok");
        // Persist the fetched site title into the file (spec §1.6 "[Site
        // Title]") when we still hold the placeholder URL as the title.
        if (p.title && (storedTitle === "" || storedTitle === url)) {
          updateAttributes({ title: p.title });
        }
      })
      .catch((e) => {
        if (!alive) return;
        if (isApiError(e) && e.code === "previews_disabled") setState("disabled");
        else setState("offline");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const open = () => void openExternal(url);

  if (state === "disabled") {
    // Quiet inline hint — never auto-fetch without the opt-in (spec §1.6).
    return (
      <NodeViewWrapper as="div" className="link-card" contentEditable={false}>
        <div className="link-card-inner">
          <div className="link-card-hint">
            <span>Link preview off.</span>
            <button
              className="link-card-settings"
              onClick={() => useStore.getState().setSettingsOpen(true)}
            >
              Enable in Settings
            </button>
            <span>·</span>
            <a href={url} onClick={(e) => (e.preventDefault(), open())}>
              {storedTitle || url}
            </a>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  const title = preview?.title || storedTitle || url;
  return (
    <NodeViewWrapper as="a" className="link-card" contentEditable={false} href={url}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        open();
      }}
    >
      <div className="link-card-inner">
        {preview?.favicon ? (
          <img className="link-card-favicon" src={preview.favicon} alt="" />
        ) : null}
        <div className="link-card-text">
          <div className="link-card-title">{title}</div>
          {preview?.description ? (
            <div className="link-card-desc">{preview.description}</div>
          ) : null}
          <div className="link-card-host">{hostOf(url)}</div>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

function openExternal(url: string) {
  // Open http(s) links in the OS browser (NFR-SEC-004: user-initiated only).
  return api.openUrl(url).catch(() => {
    try {
      window.open(url, "_blank", "noopener");
    } catch {
      /* ignore */
    }
  });
}

// -------------------------------------------------------------------- node ---

export const LinkCard = Node.create({
  name: "linkCard",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      title: { default: "" },
      url: { default: "" },
      mode: { default: "card" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-linkcard]",
        getAttrs: (el) => ({
          title: (el as HTMLElement).getAttribute("data-title") || "",
          url: (el as HTMLElement).getAttribute("data-url") || "",
          mode: (el as HTMLElement).getAttribute("data-mode") || "card",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-linkcard": "",
        "data-title": node.attrs.title || "",
        "data-url": node.attrs.url || "",
        "data-mode": node.attrs.mode || "card",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer((p: NodeViewProps) => {
      const mode = (p.node.attrs.mode as string) || "card";
      const url = (p.node.attrs.url as string) || "";
      if (mode === "embed") {
        const id = youtubeId(url);
        if (id) return <EmbedYouTube id={id} title={p.node.attrs.title as string} />;
        // Non-YouTube embed falls back to card rendering (spec §1.6).
      }
      return <LinkCardView {...p} />;
    });
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          const marker = node.attrs.mode === "embed" ? "mica:embed" : "mica:card";
          state.write(`[${node.attrs.title}](${node.attrs.url} "${marker}")`);
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.block.ruler.before(
              "paragraph",
              "link_card",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (state: any, startLine: number, endLine: number, silent: boolean) => {
                const pos = state.bMarks[startLine] + state.tShift[startLine];
                const max = state.eMarks[startLine];
                const line = state.src.slice(pos, max).trim();
                const m = /^\[([^\]]*)\]\((\S+) "mica:(card|embed)"\)$/.exec(line);
                if (!m) return false;
                if (startLine + 1 < endLine && !state.isEmpty(startLine + 1))
                  return false;
                if (silent) return true;
                const token = state.push("html_block", "", 0);
                token.map = [startLine, startLine + 1];
                token.content =
                  `<div data-linkcard data-title="${escapeAttr(m[1])}" ` +
                  `data-url="${escapeAttr(m[2])}" data-mode="${m[3]}"></div>\n`;
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

// --------------------------------------------------- bare-URL hover affordance --

const BARE_URL_RE = /^(https?:\/\/\S+)$/;

function upgrade(view: EditorView, from: number, to: number, url: string, mode: "card" | "embed") {
  const type = view.state.schema.nodes.linkCard;
  const nodeAttrs = { title: url, url, mode };
  view.dispatch(view.state.tr.replaceRangeWith(from, to, type.create(nodeAttrs)));
}

/**
 * Decorates paragraphs whose sole text is a bare URL with a small hover
 * affordance offering a card / embed upgrade. Card is only offered when link
 * previews are enabled; embed only for YouTube (which needs no network).
 */
export function BareUrlAffordance(previewsEnabled: () => boolean) {
  return Extension.create({
    name: "bareUrlAffordance",
    addProseMirrorPlugins() {
      const build = (doc: PMNode): DecorationSet => {
        const decos: Decoration[] = [];
        doc.descendants((node, pos) => {
          if (node.type.name !== "paragraph") return;
          const text = (node.textContent || "").trim();
          const m = BARE_URL_RE.exec(text);
          if (!m) return;
          const url = m[1];
          const isYt = !!youtubeId(url);
          const offerCard = previewsEnabled();
          const offerEmbed = previewsEnabled() || isYt;
          if (!offerCard && !offerEmbed) return;
          const paraFrom = pos;
          const paraTo = pos + node.nodeSize;
          const widgetAt = paraTo - 1; // just inside the paragraph's end
          decos.push(
            Decoration.widget(
              widgetAt,
              (view) => {
                const wrap = document.createElement("span");
                wrap.className = "bare-url-affordance";
                wrap.contentEditable = "false";
                const addBtn = (label: string, mode: "card" | "embed") => {
                  const b = document.createElement("button");
                  b.textContent = label;
                  b.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    upgrade(view, paraFrom, paraTo, url, mode);
                  });
                  wrap.appendChild(b);
                };
                if (offerCard) addBtn("Turn into card", "card");
                if (offerEmbed) addBtn("Turn into embed", "embed");
                return wrap;
              },
              { side: 1, ignoreSelection: true },
            ),
          );
        });
        return DecorationSet.create(doc, decos);
      };
      return [
        new Plugin({
          key: new PluginKey("bareUrlAffordance"),
          state: {
            init: (_, { doc }) => build(doc),
            apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
          },
          props: {
            decorations(pmState) {
              return this.getState(pmState);
            },
          },
        }),
      ];
    },
  });
}

export default LinkCard;
