import { useEffect, useRef } from "react";

export interface PopupItem {
  key: string;
  label: string;
  hint?: string;
}

export interface PopupState {
  items: PopupItem[];
  selected: number;
  rect: { left: number; top: number; bottom: number } | null;
  onPick: (index: number) => void;
}

/** Floating list used by both the slash menu and [[ autocomplete. */
export default function SuggestionPopup({ state }: { state: PopupState | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !state) return;
    const el = ref.current.querySelector(".selected");
    el?.scrollIntoView({ block: "nearest" });
  }, [state]);

  if (!state || !state.rect || state.items.length === 0) return null;

  return (
    <div
      ref={ref}
      className="suggestion-popup"
      style={{ left: state.rect.left, top: state.rect.bottom + 4 }}
    >
      {state.items.map((item, i) => (
        <button
          key={item.key}
          className={`suggestion-item ${i === state.selected ? "selected" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            state.onPick(i);
          }}
        >
          <span>{item.label}</span>
          {item.hint && <span className="muted small">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
