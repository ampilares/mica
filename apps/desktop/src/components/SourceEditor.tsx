import { useEffect, useRef, useState } from "react";
import { EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { api, isApiError } from "../api";
import { useStore, titleOfPath } from "../store";
import { docEvents } from "../docEvents";
import { useSettings } from "../settings";

/**
 * Raw Markdown source mode (FR-NOTE-009). Edits the full file including
 * frontmatter — this is also the surface for hand-fixing Git conflict
 * markers, so nothing is hidden or rewritten client-side.
 */
export default function SourceEditor({ path, active }: { path: string; active: boolean }) {
  const setSaveStatus = useStore((s) => s.setSaveStatus);
  const setConflict = useStore((s) => s.setConflict);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const versionRef = useRef<string>("");
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const loadedRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const [deletedBanner, setDeletedBanner] = useState(false);

  const save = async () => {
    const view = viewRef.current;
    if (!view || savingRef.current || !dirtyRef.current) return;
    savingRef.current = true;
    setSaveStatus("saving");
    const content = view.state.doc.toString();
    try {
      const result = await api.noteSave(pathRef.current, content, versionRef.current);
      versionRef.current = result.version;
      dirtyRef.current = false;
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("error");
      if (isApiError(e) && e.code === "conflict") {
        setConflict({ path: pathRef.current, myContent: content });
      } else {
        console.error("save failed", e);
      }
    } finally {
      savingRef.current = false;
    }
  };

  const scheduleSave = () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(
      () => void save(),
      useSettings.getState().autosaveDelay,
    );
  };

  const setDoc = (content: string) => {
    const view = viewRef.current;
    if (!view) return;
    loadedRef.current = false;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
    dirtyRef.current = false;
    loadedRef.current = true;
  };

  // Create the CodeMirror view once per path.
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: "",
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(oneDarkHighlightStyle, { fallback: true }),
          placeholder("Raw Markdown…"),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && loadedRef.current) {
              dirtyRef.current = true;
              scheduleSave();
            }
          }),
        ],
      }),
    });
    viewRef.current = view;

    api
      .noteLoad(path)
      .then((file) => {
        versionRef.current = file.version;
        setDoc(file.content);
      })
      .catch((e) => console.error("load failed", e));

    return () => {
      if (dirtyRef.current) void save();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // External file events for this document.
  useEffect(() => {
    return docEvents.on(async (ev) => {
      const p = pathRef.current;
      if (ev.type === "modified" && ev.path === p) {
        if (dirtyRef.current) {
          setConflict({ path: p, myContent: viewRef.current?.state.doc.toString() ?? "" });
        } else {
          try {
            const file = await api.noteLoad(p);
            versionRef.current = file.version;
            setDoc(file.content);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Conflict resolution outcomes.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        path: string;
        content: string;
        version: string;
      };
      if (detail.path === pathRef.current) {
        versionRef.current = detail.version;
        setDoc(detail.content);
      }
    };
    window.addEventListener("mica:conflict-resolved", handler);
    return () => window.removeEventListener("mica:conflict-resolved", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush pending save on window blur.
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current) void save();
    };
    window.addEventListener("blur", flush);
    return () => window.removeEventListener("blur", flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="note-editor source-mode" style={{ display: active ? "flex" : "none" }}>
      {deletedBanner && (
        <div className="banner warning">
          This file was deleted on disk.
          <button
            onClick={async () => {
              await api.noteSave(
                pathRef.current,
                viewRef.current?.state.doc.toString() ?? "",
                undefined,
              );
              setDeletedBanner(false);
            }}
          >
            Restore
          </button>
          <button onClick={() => useStore.getState().closeTab(pathRef.current)}>Close</button>
        </div>
      )}
      <div className="note-header">
        <div className="note-title">{titleOfPath(path)}</div>
      </div>
      <div ref={hostRef} className="source-editor-host" />
    </div>
  );
}
