import React, { useState, lazy, Suspense } from "react";
import { ChevronRight, ChevronDown, File, Folder, Download, Copy, Check, Plus, Trash2 } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import JSZip from "jszip";
import { buildFileTree, type FileTreeNode } from "./buildFileTree";

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.Editor }))
);

export type StarterCodeFile = { path: string; content: string };

interface StarterCodeIDEProps {
  files: StarterCodeFile[];
  readOnly: boolean;
  onChange?: (files: StarterCodeFile[]) => void;
}

function getLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    py: "python", go: "go", rs: "rust", java: "java", rb: "ruby",
    json: "json", md: "markdown", css: "css", html: "html",
    yml: "yaml", yaml: "yaml", sh: "shell",
  };
  return map[ext] ?? "plaintext";
}

// File tree node rendered recursively
function TreeNode({
  node,
  activePath,
  onSelect,
  readOnly,
  onDelete,
  expanded,
  onToggle,
}: {
  node: FileTreeNode;
  activePath: string;
  onSelect: (path: string) => void;
  readOnly: boolean;
  onDelete?: (path: string) => void;
  expanded: Record<string, boolean>;
  onToggle: (name: string) => void;
}) {
  if (node.type === "file") {
    const isActive = node.path === activePath;
    return (
      <div
        className={`group flex items-center gap-1.5 px-2 py-1 cursor-pointer text-xs rounded-sm select-none ${
          isActive ? "bg-[#1E3A8A] text-white" : "text-slate-700 hover:bg-slate-100"
        }`}
        onClick={() => onSelect(node.path)}
      >
        <File className="w-3.5 h-3.5 shrink-0 opacity-70" />
        <span className="flex-1 font-mono truncate">{node.name}</span>
        {!readOnly && onDelete && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(node.path); }}
            className={`shrink-0 opacity-0 group-hover:opacity-100 ${isActive ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-red-500"}`}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  // Directory
  const isOpen = expanded[node.name] !== false; // default open
  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer text-xs text-slate-700 hover:bg-slate-100 rounded-sm select-none"
        onClick={() => onToggle(node.name)}
      >
        {isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500" />
        <span className="font-mono text-xs">{node.name}</span>
      </div>
      {isOpen && (
        <div className="pl-3">
          {node.children.map((child, i) => (
            <TreeNode
              key={i}
              node={child}
              activePath={activePath}
              onSelect={onSelect}
              readOnly={readOnly}
              onDelete={onDelete}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StarterCodeIDE({ files, readOnly, onChange }: StarterCodeIDEProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draftPath, setDraftPath] = useState("");

  if (!files.length) return null;

  const activeFile = files[Math.min(activeIndex, files.length - 1)];
  const tree = buildFileTree(files);

  const handleSelect = (path: string) => {
    const idx = files.findIndex((f) => f.path === path);
    if (idx !== -1) setActiveIndex(idx);
  };

  const handleToggle = (dirName: string) => {
    setExpanded((prev) => ({ ...prev, [dirName]: prev[dirName] === false ? true : false }));
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownloadZip = async () => {
    const zip = new JSZip();
    files.forEach(({ path, content }) => zip.file(path, content));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "starter-code.zip";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleContentChange = (value: string | undefined) => {
    if (!onChange) return;
    const updated = files.map((f, i) => i === activeIndex ? { ...f, content: value ?? "" } : f);
    onChange(updated);
  };

  const handleDeleteFile = (path: string) => {
    if (!onChange) return;
    const updated = files.filter((f) => f.path !== path);
    onChange(updated);
    setActiveIndex(Math.min(activeIndex, updated.length - 1));
  };

  const handleAddFile = () => {
    if (!onChange) return;
    const newFile = { path: "new-file.txt", content: "" };
    const updated = [...files, newFile];
    onChange(updated);
    setActiveIndex(updated.length - 1);
  };

  const handleClearAll = () => {
    if (!onChange) return;
    if (!confirm("Clear all starter code files?")) return;
    onChange([]);
  };

  const commitPathRename = () => {
    if (!onChange || editingPath === null) return;
    const trimmed = draftPath.trim();
    if (!trimmed || (trimmed !== editingPath && files.some((f) => f.path === trimmed))) {
      setEditingPath(null);
      return; // reject duplicate or empty
    }
    const updated = files.map((f) => f.path === editingPath ? { ...f, path: trimmed } : f);
    onChange(updated);
    setEditingPath(null);
  };

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Starter Code</span>
          {!readOnly && (
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs px-2 py-0.5 rounded border border-slate-200 text-red-500 hover:bg-red-50 ml-2"
            >
              Clear all
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleDownloadZip}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
        >
          <Download className="w-3.5 h-3.5" />
          Download ZIP
        </button>
      </div>

      <div className="flex" style={{ minHeight: 320 }}>
        {/* File tree */}
        <div className="w-52 shrink-0 border-r border-slate-200 py-2 overflow-y-auto bg-slate-50/50">
          {tree.map((node, i) => (
            <TreeNode
              key={i}
              node={node}
              activePath={activeFile.path}
              onSelect={handleSelect}
              readOnly={readOnly}
              onDelete={readOnly ? undefined : handleDeleteFile}
              expanded={expanded}
              onToggle={handleToggle}
            />
          ))}
          {!readOnly && (
            <button
              type="button"
              onClick={handleAddFile}
              className="flex items-center gap-1.5 px-2 py-1 mt-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-sm w-full"
            >
              <Plus className="w-3.5 h-3.5" />
              Add file
            </button>
          )}
        </div>

        {/* Code pane */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Code pane header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 bg-white">
            {!readOnly && editingPath === activeFile.path ? (
              <input
                autoFocus
                value={draftPath}
                onChange={(e) => setDraftPath(e.target.value)}
                onBlur={commitPathRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitPathRename();
                  if (e.key === "Escape") setEditingPath(null);
                }}
                className="text-xs font-mono border border-slate-300 rounded px-1 py-0.5 w-64 focus:outline-none focus:ring-1 focus:ring-[#1E3A8A]/30"
              />
            ) : (
              <span
                className={`text-xs font-mono text-slate-600 ${!readOnly ? "cursor-pointer hover:text-slate-900" : ""}`}
                onClick={() => {
                  if (!readOnly) {
                    setEditingPath(activeFile.path);
                    setDraftPath(activeFile.path);
                  }
                }}
                title={!readOnly ? "Click to rename" : undefined}
              >
                {activeFile.path}
              </span>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Code content */}
          {readOnly ? (
            <div className="flex-1 overflow-auto">
              <SyntaxHighlighter
                language={getLanguage(activeFile.path)}
                style={oneLight}
                showLineNumbers
                customStyle={{ margin: 0, fontSize: "0.8rem", minHeight: "100%", background: "white" }}
                codeTagProps={{ style: { fontFamily: "ui-monospace, monospace" } }}
              >
                {activeFile.content}
              </SyntaxHighlighter>
            </div>
          ) : (
            <div className="flex-1">
              <Suspense fallback={<div className="p-4 text-xs text-slate-400">Loading editor…</div>}>
                <MonacoEditor
                  height="100%"
                  language={getLanguage(activeFile.path)}
                  value={activeFile.content}
                  onChange={handleContentChange}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    wordWrap: "off",
                    tabSize: 2,
                    automaticLayout: true,
                  }}
                />
              </Suspense>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
