import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

const WIKI_RE = /\[\[([^\[\]|#]+)(#[^\[\]|]*)?(\|[^\[\]]*)?\]\]/g;

/**
 * Wiki links stay plain `[[Target]]` text in the document (perfect Markdown
 * round-trip); this extension only decorates them so they look and click like
 * links.
 */
export const WikiLinkHighlight = Extension.create({
  name: "wikiLinkHighlight",

  addProseMirrorPlugins() {
    const build = (doc: PMNode): DecorationSet => {
      const decos: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return;
        // Skip text inside code blocks.
        WIKI_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = WIKI_RE.exec(node.text)) !== null) {
          const from = pos + m.index;
          const to = from + m[0].length;
          decos.push(
            Decoration.inline(from, to, {
              class: "wiki-link",
              "data-wiki-target": m[1].trim(),
            }),
          );
        }
      });
      return DecorationSet.create(doc, decos);
    };

    return [
      new Plugin({
        key: new PluginKey("wikiLinkHighlight"),
        state: {
          init: (_, { doc }) => build(doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
