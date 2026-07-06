/**
 * The markdown serializer escapes literal brackets, which corrupts
 * `[[Wiki Links]]`; restore them (wiki links live as plain text in the doc).
 */
export function restoreWikiLinks(md: string): string {
  return md.replace(/\\\[\\\[/g, "[[").replace(/\\\]\\\]/g, "]]");
}

/**
 * Split a note into (frontmatterBlock, body). The frontmatter block includes
 * its `---` fences and trailing blank line so `frontmatter + body` rebuilds
 * the file. Mirrors the Rust splitter; the Rust side remains authoritative.
 */
export function splitFrontmatter(content: string): {
  frontmatter: string;
  body: string;
} {
  // Tolerate a UTF-8 BOM from external Windows editors.
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: "", body: content };
  }
  const lines = content.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, "") === "---") {
      let bodyStart = i + 1;
      // skip the conventional single blank line after the fence
      if (bodyStart < lines.length && lines[bodyStart].trim() === "") bodyStart++;
      return {
        frontmatter: lines.slice(0, i + 1).join("\n") + "\n\n",
        body: lines.slice(bodyStart).join("\n"),
      };
    }
  }
  return { frontmatter: "", body: content };
}
