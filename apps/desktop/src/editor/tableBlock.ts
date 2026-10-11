// Tables (FR21-BLK-003). GFM pipe tables via @tiptap/extension-table + row/
// header/cell. Serialization is handled by tiptap-markdown's built-in GFM
// table serializer (it recognizes the node named `table` and emits standard
// `| a | b |` / `| --- | --- |` pipe tables); parsing rides markdown-it's
// default GFM table rule. No custom serializer needed.
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";

// resizable:false keeps the DOM free of colgroup/colwidth churn (the GFM
// serializer ignores widths anyway).
export const tableExtensions = [
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];

export default tableExtensions;
