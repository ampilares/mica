import { Component, type ErrorInfo, type ReactNode } from "react";
import { useStore } from "../../store";
import { createWorkspace } from "../../workspace";
import { Icon } from "../ui";

interface State { error: Error | null }

/** Keeps a malformed view/layout from taking down vault navigation. */
export default class WorkspaceErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Workspace rendering failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="workspace-failure" role="alert">
        <Icon name="warning" size={32} />
        <h2>Workspace layout could not be displayed</h2>
        <p className="muted">Your vault files are safe. Reset only the saved pane and tab layout to continue.</p>
        <button
          onClick={() => {
            useStore.getState().replaceWorkspace(createWorkspace());
            this.setState({ error: null });
          }}
        >
          Reset workspace layout
        </button>
      </div>
    );
  }
}
