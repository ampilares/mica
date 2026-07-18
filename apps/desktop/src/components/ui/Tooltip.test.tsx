import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  it("describes its child while keyboard focus is within the anchor", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Open the quick switcher">
        <button type="button">Open</button>
      </Tooltip>,
    );

    const button = screen.getByRole("button", { name: "Open" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    await user.tab();

    const tooltip = screen.getByRole("tooltip");
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);

    await user.tab();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("preserves an existing accessible description", async () => {
    const user = userEvent.setup();
    render(
      <>
        <p id="existing-description">Existing detail</p>
        <Tooltip content="Additional detail">
          <button type="button" aria-describedby="existing-description">Action</button>
        </Tooltip>
      </>,
    );

    await user.hover(screen.getByRole("button", { name: "Action" }));
    const tooltip = screen.getByRole("tooltip");
    expect(screen.getByRole("button").getAttribute("aria-describedby"))
      .toBe(`existing-description ${tooltip.id}`);
  });
});

