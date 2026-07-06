export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

/** Simple LCS line diff — enough for a readable conflict preview. */
export function diffLines(a: string, b: string): DiffLine[] {
  const al = a.split("\n");
  const bl = b.split("\n");
  // Cap quadratic work on very large files.
  if (al.length * bl.length > 400_000) {
    return [
      { kind: "removed", text: `(${al.length} lines of your version)` },
      { kind: "added", text: `(${bl.length} lines of the disk version)` },
    ];
  }
  const m = al.length;
  const n = bl.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = al[i] === bl[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (al[i] === bl[j]) {
      out.push({ kind: "same", text: al[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "removed", text: al[i++] });
    } else {
      out.push({ kind: "added", text: bl[j++] });
    }
  }
  while (i < m) out.push({ kind: "removed", text: al[i++] });
  while (j < n) out.push({ kind: "added", text: bl[j++] });
  return out;
}

/** Collapse long same-runs so the preview focuses on changes. */
export function compactDiff(lines: DiffLine[], context = 2): DiffLine[] {
  const out: DiffLine[] = [];
  let sameRun: DiffLine[] = [];
  const flush = (isEnd: boolean) => {
    if (sameRun.length <= context * 2 + 1) {
      out.push(...sameRun);
    } else {
      out.push(...sameRun.slice(0, isEnd ? 0 : context));
      out.push({ kind: "same", text: `… ${sameRun.length - context * 2} unchanged lines …` });
      if (!isEnd) out.push(...sameRun.slice(-context));
    }
    sameRun = [];
  };
  for (const line of lines) {
    if (line.kind === "same") sameRun.push(line);
    else {
      flush(false);
      out.push(line);
    }
  }
  flush(true);
  return out;
}
