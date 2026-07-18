import { useEffect, useState } from "react";
import {
  getDocumentSnapshot,
  subscribeDocument,
  type DocumentSnapshot,
} from "./sessionRegistry";

/** React bridge for the imperative path-scoped document registry. */
export function useDocumentSnapshot(path?: string): DocumentSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<DocumentSnapshot | undefined>(() =>
    path ? getDocumentSnapshot(path) : undefined,
  );

  useEffect(() => {
    if (!path) {
      setSnapshot(undefined);
      return;
    }
    setSnapshot(getDocumentSnapshot(path));
    return subscribeDocument(path, ({ snapshot: next }) => setSnapshot(next));
  }, [path]);

  return snapshot;
}
