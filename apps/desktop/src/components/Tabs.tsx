import { useStore, kindOfPath } from "../store";
import { iconOf } from "./Sidebar";

/** DataTransfer mime carrying a dragged tab's path (drag-to-move between panes). */
export const TAB_DND_MIME = "application/x-mica-tab";

export default function Tabs({ paneIndex = 0 }: { paneIndex?: 0 | 1 }) {
  const pane = useStore((s) => s.panes[paneIndex]);
  const setActive = useStore((s) => s.setActive);
  const closeTab = useStore((s) => s.closeTab);
  const setActivePane = useStore((s) => s.setActivePane);

  if (!pane || pane.tabs.length === 0) return <div className="tabs" />;

  const tabs = pane.tabs;
  const activePath = pane.activePath;

  return (
    <div className="tabs">
      {tabs.map((tab) => {
        const kind = kindOfPath(tab.path);
        return (
          <div
            key={tab.path}
            className={`tab ${tab.path === activePath ? "active" : ""}`}
            data-peek-path={tab.path}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TAB_DND_MIME, tab.path);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => {
              setActivePane(paneIndex);
              setActive(tab.path);
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                setActivePane(paneIndex);
                closeTab(tab.path);
              }
            }}
            title={tab.path}
          >
            <span className="tab-icon">{kind === "page" ? "◫" : iconOf(kind)}</span>
            <span className="tab-title">{tab.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                setActivePane(paneIndex);
                closeTab(tab.path);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        className="new-tab"
        title="Quick search (Ctrl+K)"
        onClick={() => useStore.getState().setQuickSearchOpen(true)}
      >
        ＋
      </button>
      <div className="tab-spacer" />
      <button
        className="tabs-command"
        title="Command palette (Ctrl+Shift+P)"
        onClick={() => useStore.getState().setCommandPaletteOpen(true)}
      >
        ⌘
      </button>
    </div>
  );
}
