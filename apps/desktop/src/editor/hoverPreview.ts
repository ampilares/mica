// Hover previews (FR21-BLK-009). Hovering a wiki link (`.wiki-link`, decorated
// by wikiLinks.ts) for ~350 ms shows a popover with the target's title and its
// first lines (api.noteSection capped client-side). The popover is cached per
// session and disappears on mouse-out. Editor-only per the C3 brief.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { api } from "../api";
import { titleOfPath } from "../store";

const HOVER_DELAY = 350;
const MAX_LINES = 25;

interface CacheEntry {
  title: string;
  lines: string;
}
// Per-session cache keyed by wiki target name (shared across all editors).
const cache = new Map<string, CacheEntry | null>();

/** Whole-body markdown → first N non-empty-ish lines, trimmed. */
function firstLines(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  // Drop a leading run of blank lines.
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  return lines.slice(start, start + MAX_LINES).join("\n").trim();
}

async function load(name: string): Promise<CacheEntry | null> {
  if (cache.has(name)) return cache.get(name) ?? null;
  try {
    const path = await api.resolveWiki(name);
    if (!path) {
      cache.set(name, null);
      return null;
    }
    const body = await api.noteSection(path);
    const entry: CacheEntry = { title: titleOfPath(path), lines: firstLines(body) };
    cache.set(name, entry);
    return entry;
  } catch {
    cache.set(name, null);
    return null;
  }
}

class HoverController {
  private el: HTMLDivElement | null = null;
  private timer: number | null = null;
  private current: string | null = null;
  private readonly onOver = (e: Event) => this.handleOver(e);
  private readonly onOut = (e: Event) => this.handleOut(e);

  constructor(private view: EditorView) {
    view.dom.addEventListener("mouseover", this.onOver);
    view.dom.addEventListener("mouseout", this.onOut);
  }

  private handleOver(e: Event) {
    const link = (e.target as HTMLElement)?.closest?.(".wiki-link") as HTMLElement | null;
    if (!link) return;
    const name = link.getAttribute("data-wiki-target");
    if (!name || name === this.current) return;
    this.clearTimer();
    this.current = name;
    const rect = link.getBoundingClientRect();
    this.timer = window.setTimeout(() => {
      void this.show(name, rect);
    }, HOVER_DELAY);
  }

  private handleOut(e: Event) {
    const to = (e as MouseEvent).relatedTarget as HTMLElement | null;
    const link = (e.target as HTMLElement)?.closest?.(".wiki-link");
    if (!link) return;
    // Ignore moves that stay within the same link.
    if (to && link.contains(to)) return;
    this.clearTimer();
    this.current = null;
    this.hide();
  }

  private async show(name: string, rect: DOMRect) {
    const entry = await load(name);
    // A newer hover superseded this one, or we've moved away.
    if (this.current !== name) return;
    if (!entry) return;
    const el = this.ensureEl();
    el.innerHTML = "";
    const title = document.createElement("div");
    title.className = "doc-preview-title";
    title.textContent = entry.title;
    const body = document.createElement("pre");
    body.className = "doc-preview-lines";
    body.textContent = entry.lines || "(empty)";
    el.append(title, body);
    // Position below the link, clamped to the viewport.
    el.style.visibility = "hidden";
    el.style.left = "0px";
    el.style.top = "0px";
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    let left = rect.left;
    let top = rect.bottom + 6;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - 6;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
    el.style.visibility = "visible";
  }

  private ensureEl(): HTMLDivElement {
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.className = "doc-preview-popover";
      document.body.appendChild(this.el);
    }
    return this.el;
  }

  private hide() {
    if (this.el) this.el.style.visibility = "hidden";
  }

  private clearTimer() {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  destroy() {
    this.clearTimer();
    this.view.dom.removeEventListener("mouseover", this.onOver);
    this.view.dom.removeEventListener("mouseout", this.onOut);
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }
}

export const HoverPreview = Extension.create({
  name: "hoverPreview",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("hoverPreview"),
        view: (editorView) => new HoverController(editorView),
      }),
    ];
  },
});

export default HoverPreview;
