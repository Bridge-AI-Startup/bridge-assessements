// client/src/components/StarterCodeIDE/buildFileTree.ts

export type FileTreeFile = {
  type: "file";
  name: string;
  path: string; // full original path
};

export type FileTreeDir = {
  type: "dir";
  name: string;
  children: FileTreeNode[];
};

export type FileTreeNode = FileTreeFile | FileTreeDir;

/**
 * Parses a flat array of {path} objects into a nested tree.
 * E.g. ["src/App.jsx", "src/main.jsx", "package.json"] →
 *   [{ type: "dir", name: "src", children: [...] }, { type: "file", name: "package.json", path: "package.json" }]
 */
export function buildFileTree(files: { path: string }[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        currentLevel.push({ type: "file", name, path: file.path });
      } else {
        let dir = currentLevel.find(
          (n): n is FileTreeDir => n.type === "dir" && n.name === name
        );
        if (!dir) {
          dir = { type: "dir", name, children: [] };
          currentLevel.push(dir);
        }
        currentLevel = dir.children;
      }
    }
  }

  return root;
}
