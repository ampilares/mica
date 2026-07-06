import CodeBlock from "@tiptap/extension-code-block";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  NodeViewProps,
} from "@tiptap/react";
import DatabaseView from "../components/DatabaseView";
import { resolveRelative } from "./paths";

/**
 * Code block that renders `workspace-database` fences as a live embedded
 * database view (PRD §27). Any other language renders as a normal code block.
 * The fence text stays canonical — the embed is purely presentational.
 */
export default function DatabaseCodeBlock(notePath: string) {
  return CodeBlock.extend({
    addNodeView() {
      return ReactNodeViewRenderer((props: NodeViewProps) =>
        CodeBlockView(props, notePath),
      );
    },
  });
}

function CodeBlockView(props: NodeViewProps, notePath: string) {
  const language = (props.node.attrs.language as string) ?? "";

  if (language === "workspace-database") {
    const text = props.node.textContent;
    const pathMatch = text.match(/path:\s*(.+)/);
    const viewMatch = text.match(/view:\s*(.+)/);
    const relPath = pathMatch?.[1]?.trim();
    const viewId = viewMatch?.[1]?.trim() || "table_default";

    if (relPath) {
      const dbPath = resolveRelative(notePath, relPath);
      return (
        <NodeViewWrapper className="db-embed" contentEditable={false}>
          <DatabaseView path={dbPath} embed initialView={viewId} />
        </NodeViewWrapper>
      );
    }
  }

  return (
    <NodeViewWrapper as="pre" className="code-block">
      {language && <span className="code-lang">{language}</span>}
      <NodeViewContent as="code" />
    </NodeViewWrapper>
  );
}
