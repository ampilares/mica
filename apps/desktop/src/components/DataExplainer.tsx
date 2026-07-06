import { useStore } from "../store";

/** "Where is my data" trust explainer (PRD §21.3). */
export default function DataExplainer() {
  const open = useStore((s) => s.dataExplainerOpen);
  const setOpen = useStore((s) => s.setDataExplainerOpen);
  const vault = useStore((s) => s.vault);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal explainer" onClick={(e) => e.stopPropagation()}>
        <h3>Where is my data?</h3>
        <p>
          Everything you create lives as ordinary files in your vault folder:
        </p>
        <p>
          <code>{vault?.root}</code>
        </p>
        <ul>
          <li>
            <strong>Notes</strong> are Markdown (<code>.md</code>) — open them in any
            text editor.
          </li>
          <li>
            <strong>Databases</strong> are readable JSON (<code>.database.json</code>).
          </li>
          <li>
            <strong>Canvases</strong> are draw.io-compatible XML (<code>.drawio</code>)
            — they open in draw.io.
          </li>
        </ul>
        <p className="muted">
          The hidden <code>.workspace/</code> folder holds only settings, backups, and
          a rebuildable search index. Deleting its <code>index/</code> loses nothing.
          Sync or version the vault with Git, Dropbox, Syncthing — anything that
          handles files.
        </p>
        <button className="primary" onClick={() => setOpen(false)}>
          Got it
        </button>
      </div>
    </div>
  );
}
