import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "./Icon";

describe("Icon", () => {
  it("is decorative by default", () => {
    const { container } = render(<Icon name="search" size={18} />);
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("width")).toBe("18");
    expect(svg?.getAttribute("height")).toBe("18");
  });

  it("becomes a named image when it has a title", () => {
    render(<Icon name="graph" title="Knowledge graph" />);

    expect(screen.getByRole("img", { name: "Knowledge graph" })).toBeTruthy();
  });
});

