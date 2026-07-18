import type { SVGProps } from "react";

/** Icons used by the app shell and workspace. All artwork uses a 24px stroke grid. */
export type IconName =
  | "app"
  | "arrowDown"
  | "arrowLeft"
  | "arrowRight"
  | "arrowUp"
  | "back"
  | "canvas"
  | "check"
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "chevronUp"
  | "close"
  | "code"
  | "command"
  | "database"
  | "edit"
  | "file"
  | "files"
  | "folder"
  | "forward"
  | "graph"
  | "history"
  | "info"
  | "link"
  | "menu"
  | "minus"
  | "moon"
  | "moreHorizontal"
  | "moreVertical"
  | "note"
  | "panelLeft"
  | "panelRight"
  | "pin"
  | "pinOff"
  | "plus"
  | "redo"
  | "search"
  | "settings"
  | "splitDown"
  | "splitRight"
  | "sun"
  | "trash"
  | "undo"
  | "warning";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** CSS size. Numeric values are interpreted as pixels. */
  size?: number | string;
  /** Stroke width in the 24px coordinate system. */
  strokeWidth?: number;
  /** Provide a title only when the icon itself conveys meaning. */
  title?: string;
}

const paths: Record<IconName, React.ReactNode> = {
  app: <><path d="M6 3h12l3 5-9 13L3 8Z"/><path d="m3 8 9 4 9-4M12 12v9"/></>,
  arrowDown: <><path d="M12 4v16"/><path d="m6 14 6 6 6-6"/></>,
  arrowLeft: <><path d="M20 12H4"/><path d="m10 6-6 6 6 6"/></>,
  arrowRight: <><path d="M4 12h16"/><path d="m14 6 6 6-6 6"/></>,
  arrowUp: <><path d="M12 20V4"/><path d="m6 10 6-6 6 6"/></>,
  back: <><path d="m11 17-5-5 5-5"/><path d="M18 12H6"/></>,
  canvas: <><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/><path d="M10 7h3a4 4 0 0 1 4 4v3"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  chevronDown: <path d="m6 9 6 6 6-6"/>,
  chevronLeft: <path d="m15 18-6-6 6-6"/>,
  chevronRight: <path d="m9 18 6-6-6-6"/>,
  chevronUp: <path d="m18 15-6-6-6 6"/>,
  close: <><path d="m6 6 12 12"/><path d="M18 6 6 18"/></>,
  code: <><path d="m8 9-3 3 3 3"/><path d="m16 9 3 3-3 3"/><path d="m14 5-4 14"/></>,
  command: <path d="M9 6V5a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v14a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3Z"/>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>,
  edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></>,
  file: <><path d="M6 2h8l5 5v15H6Z"/><path d="M14 2v6h5"/></>,
  files: <><path d="M3.5 5.5h5l1.5 2h10.5v11H3.5Z"/><path d="M3.5 5.5v-2h6l1.5 2h5"/></>,
  folder: <path d="M3 6h7l2 2h9v11H3Z"/>,
  forward: <><path d="m13 17 5-5-5-5"/><path d="M6 12h12"/></>,
  graph: <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="11" cy="18" r="2"/><path d="m7.8 6.3 8.2 1.4M7.2 7.7l2.7 8.5m6.8-6.5-4.5 6.7"/></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  link: <><path d="m10 13 4-4"/><path d="M7.5 15.5 5 18a3.5 3.5 0 0 0 5 5l3-3"/><path d="m16.5 8.5 2.5-2.5a3.5 3.5 0 0 0-5-5l-3 3"/></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  minus: <path d="M5 12h14"/>,
  moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>,
  moreHorizontal: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
  moreVertical: <><circle cx="12" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/></>,
  note: <><path d="M5 3h14v18H5Z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  panelLeft: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>,
  panelRight: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></>,
  pin: <><path d="m14 4 6 6-3 1-4 4-1 5-2-2-4-4-2-2 5-1 4-4Z"/><path d="m9 15-5 5"/></>,
  pinOff: <><path d="m3 3 18 18M10 6l3-3 7 7-3 1-2 2M11 15l-1 5-2-2-2-2M9 15l-5 5"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  redo: <><path d="m15 6 4 4-4 4"/><path d="M19 10h-7a7 7 0 0 0-7 7"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3A1.7 1.7 0 0 0 14 21v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14h-.2v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  splitDown: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/><path d="m9 15 3 3 3-3"/></>,
  splitRight: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="m15 9 3 3-3 3"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  trash: <><path d="M4 7h16M9 3h6l1 4M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/></>,
  undo: <><path d="m9 6-4 4 4 4"/><path d="M5 10h7a7 7 0 0 1 7 7"/></>,
  warning: <><path d="M12 3 2.5 20h19Z"/><path d="M12 9v5M12 17h.01"/></>,
};

export function Icon({ name, size = "1em", strokeWidth = 1.8, title, ...props }: IconProps) {
  const accessible = Boolean(title);
  return (
    <svg
      {...props}
      className={["ui-icon", props.className].filter(Boolean).join(" ")}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={accessible ? undefined : true}
      role={accessible ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {paths[name]}
    </svg>
  );
}

