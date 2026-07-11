import { useStore } from "../store";

export default function Tabs() {
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const setActive = useStore((s) => s.setActive);
  const closeTab = useStore((s) => s.closeTab);

  if (tabs.length === 0) return <div className="tabs" />;

  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <div
          key={tab.path}
          className={`tab ${tab.path === activePath ? "active" : ""}`}
          onClick={() => setActive(tab.path)}
          title={tab.path}
        >
          <span className="tab-title">{tab.title}</span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.path);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="new-tab" title="Quick switcher" onClick={() => useStore.getState().setQuickSwitcherOpen(true)}>＋</button>
      <div className="tab-spacer" />
      <button className="tabs-command" title="Command palette (Ctrl+K)" onClick={() => useStore.getState().setCommandPaletteOpen(true)}>⌘</button>
    </div>
  );
}
