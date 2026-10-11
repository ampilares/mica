import { useMemo, useState } from "react";
import { api } from "../api";
import { useStore, journalDateOf } from "../store";

/** Right-panel month calendar for journals (FR2-JRN-003): dots on days with
 * journal docs; click opens (or creates) that day's journal. */
export default function JournalCalendar() {
  const docs = useStore((s) => s.docs);
  const openDoc = useStore((s) => s.openDoc);
  const refreshDocs = useStore((s) => s.refreshDocs);
  const activePath = useStore((s) => s.activePath);
  const [cursor, setCursor] = useState(() => {
    const active = activePath ? journalDateOf(activePath) : null;
    return active ? new Date(`${active}T00:00:00`) : new Date();
  });

  const journalDays = useMemo(() => {
    const s = new Set<string>();
    for (const d of docs) if (d.journal) s.add(d.journal);
    return s;
  }, [docs]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday-first grid
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const iso = (d: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const activeDate = activePath ? journalDateOf(activePath) : null;

  const openDay = async (day: number) => {
    const file = await api.journalEnsure(iso(day));
    openDoc(file.path);
    refreshDocs();
  };

  return (
    <div className="panel-body journal-calendar">
      <div className="calendar-header">
        <button
          className="icon-button"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
        >
          ‹
        </button>
        <span className="calendar-title">
          {firstDay.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button
          className="icon-button"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
        >
          ›
        </button>
      </div>
      <div className="calendar-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="calendar-weekday">
            {d}
          </span>
        ))}
        {Array.from({ length: startOffset }, (_, i) => (
          <span key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const isToday =
            today.getFullYear() === year &&
            today.getMonth() === month &&
            today.getDate() === day;
          const hasJournal = journalDays.has(iso(day));
          const isActive = activeDate === iso(day);
          return (
            <button
              key={day}
              className={`calendar-day ${isToday ? "today" : ""} ${isActive ? "active" : ""}`}
              onClick={() => void openDay(day)}
            >
              {day}
              {hasJournal && <span className="calendar-dot" />}
            </button>
          );
        })}
      </div>
      <button
        className="chip calendar-today-button"
        onClick={async () => {
          const now = new Date();
          setCursor(now);
          const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
            2,
            "0",
          )}-${String(now.getDate()).padStart(2, "0")}`;
          const file = await api.journalEnsure(todayIso);
          openDoc(file.path);
          refreshDocs();
        }}
      >
        Today
      </button>
    </div>
  );
}
