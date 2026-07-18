import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from "react";

export type TooltipSide = "top" | "right" | "bottom" | "left";

export interface TooltipProps {
  children: ReactElement;
  content: ReactNode;
  side?: TooltipSide;
  disabled?: boolean;
  className?: string;
}

/** A non-interactive tooltip that appears for both pointer hover and keyboard focus. */
export function Tooltip({ children, content, side = "top", disabled = false, className }: TooltipProps) {
  const generatedId = useId();
  const id = `tooltip-${generatedId.replace(/:/g, "")}`;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const visible = !disabled && Boolean(content) && (hovered || focused);

  if (!isValidElement(children)) return children;

  const childProps = children.props as Record<string, unknown>;
  const existingDescription = childProps["aria-describedby"] as string | undefined;
  const child = cloneElement(children as ReactElement<Record<string, unknown>>, {
    "aria-describedby": visible
      ? [existingDescription, id].filter(Boolean).join(" ")
      : existingDescription,
  });

  return (
    <span
      className={["ui-tooltip-anchor", className].filter(Boolean).join(" ")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      data-tooltip-open={visible ? "true" : undefined}
    >
      {child}
      {visible ? (
        <span id={id} role="tooltip" className="ui-tooltip" data-side={side}>
          {content}
        </span>
      ) : null}
    </span>
  );
}
