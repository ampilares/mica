import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../../store";
import { createWorkspace, selectActivePath } from "../../workspace";
import Sidebar from "../Sidebar";

const tree = {
  roots: [{
    path: "Notes",
    name: "Notes",
    is_dir: true,
    children: [{ path: "Notes/Alpha.md", name: "Alpha.md", is_dir: false, kind: "note" as const }],
  }],
};

vi.mock("../../api", () => ({
  api: {
    vaultTree: vi.fn(async () => tree),
    tagsList: vi.fn(async () => []),
    vaultOpenExternal: vi.fn(async () => undefined),
  },
}));

describe("Sidebar tree keyboard semantics", () => {
  beforeEach(() => {
    useStore.getState().replaceWorkspace(createWorkspace());
    useStore.setState({ tree, vault: { root: "/vault", name: "Vault" } });
  });

  it("exposes a tree and supports folder, file, traversal, and context-menu keys", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const vaultTree = screen.getByRole("tree", { name: "Vault files" });
    const folder = screen.getByRole("treeitem", { name: /Notes/ });
    const file = screen.getByRole("treeitem", { name: /Alpha.md/ });
    expect(vaultTree.contains(folder)).toBe(true);
    expect(folder.getAttribute("aria-expanded")).toBe("true");

    folder.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(file);
    await user.keyboard("{Enter}");
    expect(selectActivePath(useStore.getState().workspace)).toBe("Notes/Alpha.md");
    expect(file.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(await screen.findByRole("menu", { name: "Actions for Alpha.md" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
  });
});
