import { api } from "../api";
import type { WorkspaceState } from "./model";
import { restoreWorkspace, serializeWorkspace } from "./operations";

export const WORKSPACE_PRESET_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9 _-]{0,78}[A-Za-z0-9])?$/;

export function validateWorkspacePresetName(name: string): string {
  if (!WORKSPACE_PRESET_NAME_PATTERN.test(name)) {
    throw new Error(
      "Preset names must be 1–80 characters, start and end with a letter or number, and use only spaces, hyphens, or underscores between them.",
    );
  }
  return name;
}

export async function listWorkspacePresets(): Promise<string[]> {
  return api.workspacePresetList();
}

export async function saveWorkspacePreset(name: string, state: WorkspaceState): Promise<void> {
  await api.workspacePresetWrite(
    validateWorkspacePresetName(name),
    serializeWorkspace(state, new Date().toISOString()),
  );
}

export async function loadWorkspacePreset(name: string): Promise<WorkspaceState | null> {
  const snapshot = await api.workspacePresetRead(validateWorkspacePresetName(name));
  return snapshot ? restoreWorkspace(snapshot) : null;
}

export async function deleteWorkspacePreset(name: string): Promise<boolean> {
  return api.workspacePresetDelete(validateWorkspacePresetName(name));
}
