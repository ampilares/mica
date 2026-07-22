import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, Editor, Extension, BubbleMenu } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { convertFileSrc } from "@tauri-apps/api/core";
import Placeholder from "@tiptap/extension-placeholder";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { Markdown } from "tiptap-markdown";
import { api, isApiError } from "../api";
import { useStore, titleOfPath } from "../store";
import { splitFrontmatter, restoreWikiLinks } from "../markdown";
import { docEvents } from "../docEvents";
import { WikiLinkHighlight } from "../editor/wikiLinks";
import SuggestionPopup, { PopupState, PopupItem } from "../editor/SuggestionPopup";
import { relativeTo, resolveRelative } from "../editor/paths";
import DatabaseCodeBlock from "../editor/DatabaseCodeBlock";
import { Callout } from "../editor/callout";
import { Toggle } from "../editor/toggle";
import { tableExtensions } from "../editor/tableBlock";
import { MathInline, MathBlock } from "../editor/math";
import "../editor/blocks.css";
import { useSettings } from "../settings";

/**
 * Image node that keeps a vault-relative `src` in the document (canonical
 * Markdown) but displays through the Tauri asset protocol.
 */
function VaultImage(notePath: string, vaultRoot: string) {
  return Image.extend({
    addNodeView() {
      return ({ node }) => {
        const img = document.createElement("img");
        const src = node.attrs.src as string;
        if (src && !src.includes("://")) {
          const abs = `${vaultRoot}/${resolveRelative(notePath, src)}`;
          img.src = convertFileSrc(abs);
        } else {
          img.src = src;
        }
        if (node.attrs.alt) img.alt = node.attrs.alt;
        return { dom: img };
      };
    },
  });
}

interface SlashItem extends PopupItem {
  run: (editor: Editor, range: { from: number; to: number }) => void;
}

const SLASH_ITEMS: SlashItem[] = [
  { key: "p", label: "Text", run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { key: "h1", label: "Heading 1", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { key: "h2", label: "Heading 2", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { key: "h3", label: "Heading 3", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { key: "bullet", label: "Bullet list", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { key: "numbered", label: "Numbered list", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { key: "task", label: "Task list", run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { key: "quote", label: "Quote", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { key: "code", label: "Code block", run: (e, r) => e.chain().focus().deleteRange(r).setCodeBlock().run() },
  { key: "divider", label: "Divider", run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  // FR21-BLK-001..004: block types with lossless Markdown round-trip.
  {
    key: "callout",
    label: "Callout",
    hint: "note / info / tip…",
    run: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: "callout", attrs: { kind: "info", title: "" }, content: [{ type: "paragraph" }] })
        .run(),
  },
  {
    key: "toggle",
    label: "Toggle list",
    hint: "collapsible",
    run: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: "toggle", attrs: { title: "" }, content: [{ type: "paragraph" }] })
        .run(),
  },
  {
    key: "table",
    label: "Table",
    hint: "3×3 GFM",
    run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    key: "math",
    label: "Math block",
    hint: "$$ LaTeX $$",
    run: (e, r) =>
      e.chain().focus().deleteRange(r).insertContent({ type: "mathBlock", attrs: { latex: "" } }).run(),
  },
  {
    key: "math-inline",
    label: "Inline math",
    hint: "$ LaTeX $",
    run: (e, r) =>
      e.chain().focus().deleteRange(r).insertContent({ type: "mathInline", attrs: { latex: "" } }).run(),
  },
  { key: "database", label: "Database", hint: "table + kanban", run: () => {} }, // handled specially
];

export default function NoteEditor({ path, active }: { path: string; active: boolean }) {
  const setSaveStatus = useStore((s) => s.setSaveStatus);
  const setConflict = useStore((s) => s.setConflict);
  const openTab = useStore((s) => s.openTab);
  const refreshTree = useStore((s) => s.refreshTree);
  const vaultRoot = useStore((s) => s.vault?.root ?? "");

  const [popup, setPopup] = useState<PopupState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [deletedBanner, setDeletedBanner] = useState(false);

  // Refs shared with editor callbacks (created once).
  const versionRef = useRef<string>("");
  const frontmatterRef = useRef<string>("");
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const popupRef = useRef<PopupState | null>(null);
  popupRef.current = popup;
  const pathRef = useRef(path);
  pathRef.current = path;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      DatabaseCodeBlock(path),
      // FR21-BLK-001..004 block types.
      Callout,
      Toggle,
      ...tableExtensions,
      MathInline,
      MathBlock,
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
      VaultImage(path, vaultRoot.replace(/\\/g, "/")),
      Placeholder.configure({ placeholder: "Write, or type / for blocks…" }),
      Markdown.configure({
        html: false,
        tightLists: true,
        linkify: false,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      WikiLinkHighlight,
      // Slash command menu
      Extension.create({
        name: "slashMenu",
        addProseMirrorPlugins() {
          return [
            Suggestion({
              pluginKey: new PluginKey("slashSuggestion"),
              editor: this.editor,
              char: "/",
              startOfLine: false,
              command: ({ editor, range, props }) => {
                (props as SlashItem & { range: unknown }).run(editor as Editor, range);
              },
              items: ({ query }) =>
                SLASH_ITEMS.filter((i) =>
                  i.label.toLowerCase().includes(query.toLowerCase()),
                ),
              render: () => suggestionRenderer<SlashItem>(setPopup, popupRef, (item, ctx) => {
                if (item.key === "database") {
                  insertDatabase(ctx.editor as Editor, ctx.range, pathRef.current, refreshTree);
                } else {
                  item.run(ctx.editor as Editor, ctx.range);
                }
              }),
            }),
          ];
        },
      }),
      // [[ wiki link autocomplete
      Extension.create({
        name: "wikiAutocomplete",
        addProseMirrorPlugins() {
          return [
            Suggestion({
              pluginKey: new PluginKey("wikiSuggestion"),
              editor: this.editor,
              char: "[[",
              startOfLine: false,
              allowSpaces: true,
              command: ({ editor, range, props }) => {
                const title = (props as { title: string }).title;
                editor
                  .chain()
                  .focus()
                  .deleteRange(range)
                  .insertContent(`[[${title}]]`)
                  .run();
              },
              items: async ({ query }) => {
                if (!query) return [];
                try {
                  const hits = await api.quickSwitch(query, 8);
                  const items = hits
                    .filter((h) => h.kind === "note")
                    .map((h) => ({ key: h.path, label: h.title, hint: h.path, title: h.title }));
                  const exact = items.some(
                    (i) => i.label.toLowerCase() === query.toLowerCase(),
                  );
                  if (!exact) {
                    items.push({
                      key: "__create__",
                      label: `Create "${query}"`,
                      hint: "new note",
                      title: query,
                    });
                  }
                  return items;
                } catch {
                  return [{ key: "__create__", label: `Create "${query}"`, hint: "new note", title: query }];
                }
              },
              render: () =>
                suggestionRenderer<PopupItem & { title: string }>(
                  setPopup,
                  popupRef,
                  (item, ctx) => {
                    ctx.editor
                      .chain()
                      .focus()
                      .deleteRange(ctx.range)
                      .insertContent(`[[${item.title}]]`)
                      .run();
                  },
                ),
            }),
          ];
        },
      }),
    ],
    editorProps: {
      attributes: { class: "note-editor-content" },
      handlePaste: (view, event) => {
        const files = event.clipboardData?.files;
        if (files && files.length > 0) {
          const image = Array.from(files).find((f) => f.type.startsWith("image/"));
          if (image) {
            event.preventDefault();
            void (async () => {
              const buf = await image.arrayBuffer();
              let binary = "";
              const bytes = new Uint8Array(buf);
              for (let i = 0; i < bytes.length; i += 0x8000) {
                binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
              }
              const name = image.name || `pasted-${Date.now()}.png`;
              const assetPath = await api.assetSave(name, btoa(binary));
              const rel = relativeTo(pathRef.current, assetPath);
              const { schema } = view.state;
              const node = schema.nodes.image.create({ src: rel, alt: name });
              view.dispatch(view.state.tr.replaceSelectionWith(node));
            })();
            return true;
          }
        }
        return false;
      },
      handleClick: (view, _pos, event) => {
        const target = (event.target as HTMLElement).closest?.(".wiki-link");
        if (target && (event.ctrlKey || event.metaKey || event.detail === 1)) {
          const name = target.getAttribute("data-wiki-target");
          if (name) {
            openWikiTarget(name, openTab, refreshTree);
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: () => {
      if (!loadedRef.current) return;
      dirtyRef.current = true;
      scheduleSave();
    },
  });

  const loadedRef = useRef(false);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(
      () => void save(),
      useSettings.getState().autosaveDelay,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async () => {
    if (!editor || savingRef.current || !dirtyRef.current) return;
    savingRef.current = true;
    setSaveStatus("saving");
    const body = restoreWikiLinks(editor.storage.markdown.getMarkdown() as string);
    const content = frontmatterRef.current + body + (body.endsWith("\n") ? "" : "\n");
    try {
      const result = await api.noteSave(pathRef.current, content, versionRef.current);
      versionRef.current = result.version;
      dirtyRef.current = false;
      setSaveStatus("saved");
    } catch (e) {
      if (isApiError(e) && e.code === "conflict") {
        setSaveStatus("error");
        setConflict({ path: pathRef.current, myContent: content });
      } else {
        setSaveStatus("error");
        console.error("save failed", e);
      }
    } finally {
      savingRef.current = false;
    }
  }, [editor, setConflict, setSaveStatus]);

  // Load the note when the editor is ready or path changes.
  useEffect(() => {
    if (!editor) return;
    loadedRef.current = false;
    setLoaded(false);
    api
      .noteLoad(path)
      .then((file) => {
        versionRef.current = file.version;
        const { frontmatter, body } = splitFrontmatter(file.content);
        frontmatterRef.current = frontmatter;
        editor.commands.setContent(body, false);
        dirtyRef.current = false;
        loadedRef.current = true;
        setLoaded(true);
      })
      .catch((e) => console.error("load failed", e));
  }, [editor, path]);

  // React to external file events for this document.
  useEffect(() => {
    return docEvents.on(async (ev) => {
      const p = pathRef.current;
      if (ev.type === "modified" && ev.path === p) {
        if (dirtyRef.current) {
          const body = restoreWikiLinks(editor?.storage.markdown.getMarkdown() as string);
          setConflict({ path: p, myContent: frontmatterRef.current + body });
        } else if (editor) {
          // Clean → silent reload.
          try {
            const file = await api.noteLoad(p);
            versionRef.current = file.version;
            const { frontmatter, body } = splitFrontmatter(file.content);
            frontmatterRef.current = frontmatter;
            loadedRef.current = false;
            editor.commands.setContent(body, false);
            loadedRef.current = true;
          } catch {
            /* deleted between event and load */
          }
        }
      } else if (ev.type === "deleted" && ev.path === p) {
        setDeletedBanner(true);
      } else if (ev.type === "renamed" && ev.from === p) {
        useStore.getState().renameTab(ev.from, ev.to);
      }
    });
  }, [editor, setConflict]);

  // Flush pending save on unmount/blur.
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current) void save();
    };
    window.addEventListener("blur", flush);
    return () => {
      window.removeEventListener("blur", flush);
      flush();
    };
  }, [save]);

  // Listen for conflict resolution outcomes that affect this document.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        path: string;
        content: string;
        version: string;
      };
      if (detail.path === pathRef.current && editor) {
        versionRef.current = detail.version;
        const { frontmatter, body } = splitFrontmatter(detail.content);
        frontmatterRef.current = frontmatter;
        loadedRef.current = false;
        editor.commands.setContent(body, false);
        dirtyRef.current = false;
        loadedRef.current = true;
      }
    };
    window.addEventListener("mica:conflict-resolved", handler);
    return () => window.removeEventListener("mica:conflict-resolved", handler);
  }, [editor]);

  return (
    <div className="note-editor" style={{ display: active ? "flex" : "none" }}>
      {deletedBanner && (
        <div className="banner warning">
          This file was deleted on disk.
          <button
            onClick={async () => {
              const body = restoreWikiLinks(editor?.storage.markdown.getMarkdown() as string);
              await api.noteSave(pathRef.current, frontmatterRef.current + body, undefined);
              setDeletedBanner(false);
            }}
          >
            Restore
          </button>
          <button
            onClick={() => {
              useStore.getState().closeTab(pathRef.current);
            }}
          >
            Close
          </button>
        </div>
      )}
      <div className="note-header">
        <div className="note-title">{titleOfPath(path)}</div>
      </div>
      {editor && (
        <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
          <div className="bubble-menu">
            <button
              className={editor.isActive("bold") ? "active" : ""}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              B
            </button>
            <button
              className={editor.isActive("italic") ? "active" : ""}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <i>I</i>
            </button>
            <button
              className={editor.isActive("strike") ? "active" : ""}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              <s>S</s>
            </button>
            <button
              className={editor.isActive("code") ? "active" : ""}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              {"</>"}
            </button>
            <button
              className={editor.isActive("link") ? "active" : ""}
              onClick={() => {
                if (editor.isActive("link")) {
                  editor.chain().focus().unsetLink().run();
                } else {
                  const url = prompt("Link URL", "https://");
                  if (url) editor.chain().focus().setLink({ href: url }).run();
                }
              }}
            >
              🔗
            </button>
          </div>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} className="editor-scroll" />
      {!loaded && <div className="muted small loading-note">Loading…</div>}
      <SuggestionPopup state={popup} />
    </div>
  );
}

// ---- helpers ----

/**
 * Bridges @tiptap/suggestion render callbacks to the shared React popup.
 * `onPick` receives the picked item and the live suggestion context.
 */
function suggestionRenderer<T extends PopupItem>(
  setPopup: (s: PopupState | null) => void,
  popupRef: { current: PopupState | null },
  onPick: (item: T, ctx: { editor: Editor; range: { from: number; to: number } }) => void,
) {
  let items: T[] = [];
  let selected = 0;
  let ctx: { editor: Editor; range: { from: number; to: number } } | null = null;

  const show = (clientRect?: (() => DOMRect | null) | null) => {
    const rect = clientRect?.();
    setPopup({
      items,
      selected,
      rect: rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null,
      onPick: (i) => {
        if (ctx && items[i]) onPick(items[i], ctx);
        setPopup(null);
      },
    });
  };

  return {
    onStart: (props: any) => {
      items = props.items;
      selected = 0;
      ctx = { editor: props.editor, range: props.range };
      show(props.clientRect);
    },
    onUpdate: (props: any) => {
      items = props.items;
      ctx = { editor: props.editor, range: props.range };
      if (selected >= items.length) selected = Math.max(0, items.length - 1);
      show(props.clientRect);
    },
    onKeyDown: (props: any) => {
      if (props.event.key === "Escape") {
        setPopup(null);
        return true;
      }
      if (items.length === 0) return false;
      if (props.event.key === "ArrowDown") {
        selected = (selected + 1) % items.length;
        const prev = popupRef.current;
        if (prev) setPopup({ ...prev, items, selected });
        return true;
      }
      if (props.event.key === "ArrowUp") {
        selected = (selected - 1 + items.length) % items.length;
        const prev = popupRef.current;
        if (prev) setPopup({ ...prev, items, selected });
        return true;
      }
      if (props.event.key === "Enter" || props.event.key === "Tab") {
        if (ctx && items[selected]) onPick(items[selected], ctx);
        setPopup(null);
        return true;
      }
      return false;
    },
    onExit: () => {
      setPopup(null);
    },
  };
}

async function openWikiTarget(
  name: string,
  openTab: (t: { path: string; kind: "note"; title: string }) => void,
  refreshTree: () => Promise<void>,
) {
  try {
    let target = await api.resolveWiki(name);
    if (!target) {
      const file = await api.noteCreate(name);
      target = file.path;
      await refreshTree();
    }
    openTab({ path: target, kind: "note", title: titleOfPath(target) });
  } catch (e) {
    console.error("wiki open failed", e);
  }
}

async function insertDatabase(
  editor: Editor,
  range: { from: number; to: number },
  notePath: string,
  refreshTree: () => Promise<void>,
) {
  const title = prompt("Database title", "Tasks");
  if (!title) {
    editor.chain().focus().deleteRange(range).run();
    return;
  }
  try {
    const file = await api.dbCreate(title);
    await refreshTree();
    const rel = relativeTo(notePath, file.path);
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContent({
        type: "codeBlock",
        attrs: { language: "workspace-database" },
        content: [{ type: "text", text: `path: ${rel}\nview: table_default` }],
      })
      .run();
  } catch (e) {
    console.error("db create failed", e);
  }
}
