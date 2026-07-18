import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./Icon";

type MenuContextValue = { close: (restoreFocus?: boolean) => void };
const MenuContext = createContext<MenuContextValue | null>(null);

export interface MenuProps {
  trigger: ReactElement;
  children: ReactNode;
  label?: string;
  align?: "start" | "end";
  side?: "top" | "right" | "bottom" | "left";
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  menuClassName?: string;
}

function menuItems(container: HTMLElement | null) {
  return container
    ? Array.from(container.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])'))
    : [];
}

/** Popup menu with outside-click dismissal, focus restoration and roving keyboard focus. */
export function Menu({
  trigger,
  children,
  label,
  align = "start",
  side = "bottom",
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  className,
  menuClassName,
}: MenuProps) {
  const generatedId = useId().replace(/:/g, "");
  const menuId = `menu-${generatedId}`;
  const triggerId = `menu-trigger-${generatedId}`;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const rootRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const setOpen = useCallback((next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = requestAnimationFrame(() => menuItems(menuRef.current)[0]?.focus());
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = current;
    if (event.key === "ArrowDown") next = current < items.length - 1 ? current + 1 : 0;
    else if (event.key === "ArrowUp") next = current > 0 ? current - 1 : items.length - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    } else if (event.key === "Tab") {
      close(false);
      return;
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const query = event.key.toLocaleLowerCase();
      const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
      const match = ordered.find((item) => (item.textContent ?? "").trim().toLocaleLowerCase().startsWith(query));
      if (match) {
        event.preventDefault();
        match.focus();
      }
      return;
    } else return;

    event.preventDefault();
    items[next]?.focus();
  };

  if (!isValidElement(trigger)) return null;
  const original = trigger.props as Record<string, unknown>;
  const originalClick = original.onClick as ((event: ReactMouseEvent) => void) | undefined;
  const originalKeyDown = original.onKeyDown as ((event: KeyboardEvent) => void) | undefined;
  const menuTrigger = cloneElement(trigger as ReactElement<Record<string, unknown>>, {
    id: original.id ?? triggerId,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
    onClick: (event: ReactMouseEvent) => {
      originalClick?.(event);
      if (!event.defaultPrevented) setOpen(!open);
    },
    onKeyDown: (event: KeyboardEvent) => {
      originalKeyDown?.(event);
      if (!event.defaultPrevented && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        setOpen(true);
      }
    },
  });

  return (
    <span
      ref={rootRef}
      className={["ui-menu-root", className].filter(Boolean).join(" ")}
      data-open={open ? "true" : undefined}
    >
      <span
        ref={(node) => {
          triggerRef.current = node?.querySelector<HTMLElement>('[aria-haspopup="menu"]')
            ?? node?.firstElementChild as HTMLElement | null;
        }}
        className="ui-menu-trigger"
      >
        {menuTrigger}
      </span>
      {open ? (
        <MenuContext.Provider value={{ close }}>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            aria-labelledby={label ? undefined : String(original.id ?? triggerId)}
            className={["ui-menu", menuClassName].filter(Boolean).join(" ")}
            data-align={align}
            data-side={side}
            onKeyDown={onMenuKeyDown}
          >
            {children}
          </div>
        </MenuContext.Provider>
      ) : null}
    </span>
  );
}

export interface MenuItemProps extends Omit<HTMLAttributes<HTMLButtonElement>, "onSelect"> {
  children: ReactNode;
  icon?: IconName | ReactNode;
  shortcut?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  closeOnSelect?: boolean;
}

export function MenuItem({
  children,
  icon,
  shortcut,
  disabled = false,
  destructive = false,
  checked,
  onSelect,
  closeOnSelect = true,
  className,
  onClick,
  ...props
}: MenuItemProps) {
  const context = useContext(MenuContext);
  if (!context) throw new Error("MenuItem must be rendered inside Menu");
  const role = checked === undefined ? "menuitem" : "menuitemcheckbox";

  return (
    <button
      {...props}
      type="button"
      role={role}
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      aria-checked={checked}
      className={["ui-menu-item", className].filter(Boolean).join(" ")}
      data-destructive={destructive ? "true" : undefined}
      data-checked={checked ? "true" : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (disabled || event.defaultPrevented) return;
        onSelect?.();
        if (closeOnSelect) context.close(true);
      }}
    >
      <span className="ui-menu-item-icon" aria-hidden="true">
        {checked ? <Icon name="check" size={16} /> : typeof icon === "string" ? <Icon name={icon as IconName} size={16} /> : icon}
      </span>
      <span className="ui-menu-item-label">{children}</span>
      {shortcut ? <span className="ui-menu-item-shortcut" aria-hidden="true">{shortcut}</span> : null}
    </button>
  );
}

export function MenuSeparator(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} role="separator" className={["ui-menu-separator", props.className].filter(Boolean).join(" ")} />;
}

export interface MenuLabelProps extends HTMLAttributes<HTMLDivElement> {}

export function MenuLabel(props: MenuLabelProps) {
  return <div {...props} className={["ui-menu-label", props.className].filter(Boolean).join(" ")} />;
}
