import { useEffect, useRef, useState } from "react";
import { EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { useStore } from "../store";
import { docEvents } from "../docEvents";
import ModeToggle from "./ModeToggle";
import { useSettings } from "../settings";
import { titleForPath, type TabId, type TextSelectionPosition } from "../workspace";
import {
  flushDocument,
  openDocument,
  replaceDocument,
  restoreDocument,
  subscribeDocument,
  updateDocument,
} from "../documents";

/**
 * Raw Markdown source mode (FR-NOTE-009). Edits the full file including
 * frontmatter — this is also the surface for hand-fixing Git conflict
 * markers, so nothing is hidden or rewritten client-side.
 */
export default function SourceEditor({
  path,
  tabId,
  active,
  selection,
  onSelectionChange,
}: {
  path: string;
  tabId: TabId;
  active: boolean;
  selection?: TextSelectionPosition;
  onSelectionChange?: (selection: TextSelectionPosition) => void;
}) {
  const setSaveStatus = useStore((s) => s.setSaveStatus);
  const setConflict = useStore((s) => s.setConflict);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const loadedRef = useRef(false);
  const originRef = useRef(`source-${crypto.randomUUID()}`);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const pathRef = useRef(path);
  pathRef.current = path;
  const [deletedBanner, setDeletedBanner] = useState(false);

  const setDoc = (content: string) => {
    const view = viewRef.current;
    if (!view) return;
    loadedRef.current = false;
    const priorSelection = selectionRef.current ?? {
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
    };
    const clamp = (position: number) => Math.min(content.length, Math.max(0, position));
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      selection: {
        anchor: clamp(priorSelection.anchor),
        head: clamp(priorSelection.head),
      },
    });
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
              updateDocument(pathRef.current, update.state.doc.toString(), {
                origin: originRef.current,
                autosaveDelay: useSettings.getState().autosaveDelay,
              });
            }
            if (update.selectionSet && loadedRef.current) {
              const { anchor, head } = update.state.selection.main;
              onSelectionChangeRef.current?.({ anchor, head });
            }
          }),
        ],
      }),
    });
    viewRef.current = view;

    const unsubscribe = subscribeDocument(path, ({ snapshot, origin }) => {
      setSaveStatus(snapshot.saveState);
      setDeletedBanner(snapshot.deleted);
      if (snapshot.saveError?.kind === "conflict") {
        setConflict({ path, myContent: snapshot.content });
      }
      if (snapshot.loaded && origin !== originRef.current) setDoc(snapshot.content);
    });
    void openDocument(path).catch((e) => console.error("load failed", e));

    return () => {
      unsubscribe();
      void flushDocument(path);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !loadedRef.current || !selection) return;
    const clamp = (position: number) => Math.min(view.state.doc.length, Math.max(0, position));
    const anchor = clamp(selection.anchor);
    const head = clamp(selection.head);
    if (view.state.selection.main.anchor === anchor && view.state.selection.main.head === head) return;
    view.dispatch({ selection: { anchor, head } });
  }, [selection?.anchor, selection?.head]);

  // External file events for this document.
  useEffect(() => {
    return docEvents.on(async (ev) => {
      const p = pathRef.current;
      if (ev.type === "renamed" && ev.from === p) {
        useStore.getState().renameWorkspaceResource(ev.from, ev.to);
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
        replaceDocument(detail.path, detail.content, detail.version);
      }
    };
    window.addEventListener("mica:conflict-resolved", handler);
    return () => window.removeEventListener("mica:conflict-resolved", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush pending save on window blur.
  useEffect(() => {
    const flush = () => {
      void flushDocument(pathRef.current);
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
              const result = await restoreDocument(pathRef.current);
              if (result.ok) setDeletedBanner(false);
            }}
          >
            Restore
          </button>
          <button onClick={() => { void useStore.getState().closeWorkspaceTab(tabId); }}>Close</button>
        </div>
      )}
      <div className="note-header">
        <div className="note-title">{titleForPath(path)}</div>
        <ModeToggle tabId={tabId} source />
      </div>
      <div ref={hostRef} className="source-editor-host" />
    </div>
  );
}
