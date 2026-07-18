import { api } from "../api";
import { resourcePath, type ResourceView, type WorkspaceState } from "./model";

export interface MissingWorkspaceResource {
  path: string;
  reason: string;
}

type ResourceProbe = (view: ResourceView) => Promise<unknown>;

const probeResource: ResourceProbe = (view) => {
  if (view.type === "note") return api.noteLoad(view.path);
  if (view.type === "database") return api.dbLoad(view.path);
  return api.canvasLoad(view.path);
};

function resourceView(view: WorkspaceState["tabs"][string]["view"]): ResourceView | undefined {
  if (view.type === "note" || view.type === "database" || view.type === "canvas") return view;
  if (view.type === "missing") return view.original;
  return undefined;
}

/**
 * Resolve restored resources after the shell is visible. This deliberately
 * runs outside restoreWorkspace so document I/O does not block layout restore.
 */
export async function findMissingWorkspaceResources(
  workspace: WorkspaceState,
  probe: ResourceProbe = probeResource,
): Promise<MissingWorkspaceResource[]> {
  const resources = new Map<string, ResourceView>();
  for (const tab of Object.values(workspace.tabs)) {
    for (const view of [tab.view, ...tab.history.map((entry) => entry.view)]) {
      const resource = resourceView(view);
      if (resource && !resources.has(resource.path)) {
        resources.set(resource.path, resource);
      }
    }
  }

  const outcomes = await Promise.all([...resources.values()].map(async (view) => {
    try {
      await probe(view);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "File is unavailable";
      return { path: resourcePath(view)!, reason: message };
    }
  }));
  return outcomes.filter((outcome): outcome is MissingWorkspaceResource => outcome !== null);
}
