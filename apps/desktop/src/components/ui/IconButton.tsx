import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { Tooltip, type TooltipSide } from "./Tooltip";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  label: string;
  icon: IconName | ReactNode;
  iconSize?: number | string;
  tooltip?: ReactNode | false;
  tooltipSide?: TooltipSide;
  pressed?: boolean;
  children?: never;
}

/** Icon-only control with a mandatory accessible name and optional visible tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, iconSize = 18, tooltip = label, tooltipSide, pressed, className, type = "button", ...props },
  ref,
) {
  const button = (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={["ui-icon-button", className].filter(Boolean).join(" ")}
    >
      {typeof icon === "string" ? <Icon name={icon as IconName} size={iconSize} /> : icon}
    </button>
  );

  return tooltip ? <Tooltip content={tooltip} side={tooltipSide}>{button}</Tooltip> : button;
});

