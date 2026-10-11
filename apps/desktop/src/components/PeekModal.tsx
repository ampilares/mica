import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import { api } from "../api";
import { useStore, kindOfPath, titleOfPath } from "../store";
import { splitFrontmatter } from "../markdown";
import { Callout } from "../editor/callout";
import { Toggle } from "../editor/toggle";
import { tableExtensions } from "../editor/tableBlock";
import { MathInline, MathBlock } from "../editor/math";
import "../editor/blocks.css";
import "./PeekModal.css";

/**
 * Peek view (spec §3.3): a centered, read-only preview of a document.
 * For `.md` docs it renders the body through a non-editable Tiptap instance
 * (StarterKit + tiptap-markdown + the v2.1 block nodes, no interactive bits —
 * deliberately NOT reusing NoteEditor). Other kinds show an "Open to view"
 * placeholder. Esc/backdrop closes (Esc is handled globally in App).
 */
export default function PeekModal({ path }: { path: string }) {
  const setPeek = useStore((s) => s.setPeek);
  const openDoc = useStore((s) => s.openDoc);
  const splitWith = useStore((s) => s.splitWith);
  const isMd = kindOfPath(path) === "note";
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const editor = useEditor(
    {
      editable: false,
      extensions: [
        StarterKit,
        Callout,
        Toggle,
        ...tableExtensions,
        MathInline,
        MathBlock,
        TaskList,
        TaskItem.configure({ nested: true }),
        Link.configure({ openOnClick: false }),
        Markdown.configure({
          html: false,
          tightLists: true,
          linkify: false,
          breaks: false,
        }),
      ],
      editorProps: {
        attributes: { class: "note-editor-content peek-content" },
      },
    },
    [path],
  );

  useEffect(() => {
    if (!editor || !isMd) return;
    let cancelled = false;
    setLoaded(false);
    setError(false);
    api
      .noteLoad(path)
      .then((file) => {
        if (cancelled) return;
        const { body } = splitFrontmatter(file.content);
        editor.commands.setContent(body, false);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [editor, path, isMd]);

  const close = () => setPeek(null);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal peek-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="peek-header">
          <span className="peek-title">{titleOfPath(path)}</span>
          <span className="peek-badge">Preview</span>
          <button className="peek-x" title="Close (Esc)" onClick={close}>
            ×
          </button>
        </div>
        <div className="peek-body">
          {isMd ? (
            error ? (
              <div className="peek-placeholder">
                <p className="muted">Couldn't load this document.</p>
              </div>
            ) : (
              <>
                <EditorContent editor={editor} className="peek-scroll" />
                {!loaded && <div className="muted small peek-loading">Loading…</div>}
              </>
            )
          ) : (
            <div className="peek-placeholder">
              <p>{titleOfPath(path)}</p>
              <p className="muted">Open to view this document.</p>
            </div>
          )}
        </div>
        <div className="peek-footer">
          <button
            onClick={() => {
              openDoc(path);
              close();
            }}
          >
            Open
          </button>
          <button
            onClick={() => {
              splitWith(path);
              close();
            }}
          >
            Open in split
          </button>
        </div>
      </div>
    </div>
  );
}
