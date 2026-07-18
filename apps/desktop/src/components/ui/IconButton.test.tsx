import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("provides an accessible name and invokes button actions", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton label="New tab" icon="plus" tooltip={false} onClick={onClick} />);

    const button = screen.getByRole("button", { name: "New tab" });
    await user.click(button);

    expect(onClick).toHaveBeenCalledOnce();
    expect(button.getAttribute("type")).toBe("button");
  });

  it("exposes pressed state and its default tooltip", async () => {
    const user = userEvent.setup();
    render(<IconButton label="Pin tab" icon="pin" pressed />);

    const button = screen.getByRole("button", { name: "Pin tab" });
    expect(button.getAttribute("aria-pressed")).toBe("true");

    await user.hover(button);
    expect(screen.getByRole("tooltip").textContent).toBe("Pin tab");
  });
});

