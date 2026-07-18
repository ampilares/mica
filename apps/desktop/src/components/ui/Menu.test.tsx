import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "./Menu";

function TestMenu({ onSelect = vi.fn() }: { onSelect?: () => void }) {
  return (
    <Menu trigger={<button type="button">Pane actions</button>}>
      <MenuLabel>Pane</MenuLabel>
      <MenuItem icon="plus" onSelect={onSelect}>New tab</MenuItem>
      <MenuSeparator />
      <MenuItem disabled>Unavailable</MenuItem>
      <MenuItem destructive shortcut="⌘W">Close pane</MenuItem>
    </Menu>
  );
}

describe("Menu", () => {
  it("connects the trigger to its menu and focuses the first item", async () => {
    const user = userEvent.setup();
    render(<TestMenu />);
    const trigger = screen.getByRole("button", { name: "Pane actions" });

    await user.click(trigger);

    const menu = screen.getByRole("menu");
    const first = screen.getByRole("menuitem", { name: "New tab" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it("navigates enabled items and wraps with arrow keys", async () => {
    const user = userEvent.setup();
    render(<TestMenu />);
    await user.click(screen.getByRole("button", { name: "Pane actions" }));
    const first = screen.getByRole("menuitem", { name: "New tab" });
    const last = screen.getByRole("menuitem", { name: "Close pane" });
    await waitFor(() => expect(document.activeElement).toBe(first));

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(last);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(first);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(last);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(first);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(last);
  });

  it("selects an item, closes, and restores trigger focus", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TestMenu onSelect={onSelect} />);
    const trigger = screen.getByRole("button", { name: "Pane actions" });
    await user.click(trigger);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "New tab" })));

    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("dismisses with Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    render(<TestMenu />);
    const trigger = screen.getByRole("button", { name: "Pane actions" });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "New tab" })).toBe(document.activeElement));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("supports opening from the keyboard and typeahead", async () => {
    const user = userEvent.setup();
    render(<TestMenu />);
    const trigger = screen.getByRole("button", { name: "Pane actions" });
    trigger.focus();

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "New tab" })));
    await user.keyboard("c");

    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Close pane" }));
  });
});
