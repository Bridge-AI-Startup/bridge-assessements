import Editor from "@monaco-editor/react";

const EXT_LANG = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  html: "html",
  htm: "html",
  css: "css",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  sh: "shell",
  bash: "shell",
  yml: "yaml",
  yaml: "yaml",
  svg: "xml",
  xml: "xml",
  txt: "plaintext",
};

export function languageFromPath(path) {
  if (!path) return "plaintext";
  const base = path.split("/").pop() || "";
  const ext = base.includes(".") ? base.split(".").pop().toLowerCase() : "";
  return EXT_LANG[ext] || "plaintext";
}

export default function MonacoPane({
  path,
  value,
  onChange,
  onSave,
  readOnly = false,
}) {
  return (
    <div className="h-full min-h-0 w-full">
      <Editor
        height="100%"
        theme="vs"
        path={path || "untitled"}
        language={languageFromPath(path)}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          padding: { top: 8 },
        }}
        onMount={(editor, monaco) => {
          editor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
            () => {
              onSave?.();
            },
          );
        }}
      />
    </div>
  );
}
