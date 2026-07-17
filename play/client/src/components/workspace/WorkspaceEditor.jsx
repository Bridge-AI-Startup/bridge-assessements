import { useCallback, useEffect, useRef, useState } from "react";
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "@/api/workspace";
import FileTree from "./FileTree";
import MonacoPane from "./MonacoPane";

const SAVE_DEBOUNCE_MS = 500;
const PREFERRED_OPEN = ["index.html", "main.js", "style.css", "CHALLENGE.md"];

/**
 * HackerRank-style file tree + Monaco, synced to E2B via Bridge /file APIs.
 */
export default function WorkspaceEditor({
  sessionId,
  refreshKey = 0,
  onSaved,
  onSandboxLost,
}) {
  const [files, setFiles] = useState([]);
  const [activePath, setActivePath] = useState(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [sandboxDead, setSandboxDead] = useState(false);
  const saveTimer = useRef(null);
  const contentRef = useRef("");
  const activePathRef = useRef(null);
  const savedContentRef = useRef("");
  const lostNotified = useRef(false);

  contentRef.current = content;
  activePathRef.current = activePath;
  savedContentRef.current = savedContent;

  const dirty = activePath != null && content !== savedContent;

  function maybeNotifySandboxLost(message) {
    const msg = String(message || "");
    if (!/sandbox no longer reachable|session_not_active/i.test(msg)) {
      return;
    }
    setSandboxDead(true);
    if (!lostNotified.current) {
      lostNotified.current = true;
      onSandboxLost?.(msg);
    }
  }

  const loadList = useCallback(async () => {
    if (sandboxDead) return [];
    setLoadingList(true);
    setError(null);
    const result = await listWorkspaceFiles(sessionId);
    setLoadingList(false);
    if (result.status === "error") {
      setError(result.message);
      maybeNotifySandboxLost(result.message);
      return [];
    }
    setFiles(result.files);
    return result.files;
  }, [sessionId, sandboxDead]);

  const openFile = useCallback(
    async (path) => {
      if (!path) return;
      setLoadingFile(true);
      setError(null);
      const result = await readWorkspaceFile(sessionId, path);
      setLoadingFile(false);
      if (result.status === "error") {
        setError(result.message);
        maybeNotifySandboxLost(result.message);
        return;
      }
      setActivePath(result.path);
      setContent(result.content);
      setSavedContent(result.content);
    },
    [sessionId],
  );

  const saveNow = useCallback(async () => {
    const path = activePathRef.current;
    const next = contentRef.current;
    if (!path || next === savedContentRef.current) return true;
    setSaving(true);
    setError(null);
    const result = await writeWorkspaceFile(sessionId, path, next);
    setSaving(false);
    if (result.status === "error") {
      setError(result.message);
      maybeNotifySandboxLost(result.message);
      return false;
    }
    setSavedContent(next);
    onSaved?.();
    return true;
  }, [sessionId, onSaved]);

  useEffect(() => {
    lostNotified.current = false;
    setSandboxDead(false);
  }, [sessionId]);

  // Initial load + refresh after Claude — skip once sandbox is known dead
  useEffect(() => {
    if (sandboxDead) return undefined;
    let cancelled = false;
    (async () => {
      const list = await loadList();
      if (cancelled) return;
      const paths = list.map((f) => f.path);
      const current = activePathRef.current;
      if (current && paths.includes(current)) {
        await openFile(current);
        return;
      }
      const preferred =
        PREFERRED_OPEN.find((p) => paths.includes(p)) || paths[0] || null;
      if (preferred) await openFile(preferred);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey, loadList, openFile, sandboxDead]);

  // Debounced autosave
  useEffect(() => {
    if (!activePath || content === savedContent) return undefined;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveNow();
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [content, savedContent, activePath, saveNow]);

  async function handleSelect(path) {
    if (path === activePath) return;
    if (dirty) {
      const ok = await saveNow();
      if (!ok) return;
    }
    await openFile(path);
  }

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <aside className="flex w-44 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50 md:w-52">
        <div className="flex items-center justify-between border-b border-slate-200 px-2 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Files
          </span>
          {saving ? (
            <span className="text-[10px] text-slate-400">Saving…</span>
          ) : dirty ? (
            <span className="text-[10px] text-amber-600">Unsaved</span>
          ) : (
            <span className="text-[10px] text-slate-400">Saved</span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingList ? (
            <p className="px-2 py-3 text-xs text-slate-400">Loading…</p>
          ) : (
            <FileTree
              files={files}
              activePath={activePath}
              onSelect={handleSelect}
            />
          )}
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-2 py-1">
          <span className="truncate font-mono text-xs text-slate-600">
            {activePath || "No file selected"}
          </span>
          <button
            type="button"
            onClick={() => saveNow()}
            disabled={!dirty || saving}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Save
          </button>
        </div>
        {error && (
          <p className="border-b border-red-100 bg-red-50 px-2 py-1 text-xs text-red-700">
            {sandboxDead
              ? "Workspace sandbox died. Use Try again on the error screen to start a new one."
              : error}
          </p>
        )}
        <div className="relative min-h-0 flex-1">
          {loadingFile && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-xs text-slate-500">
              Loading file…
            </div>
          )}
          {activePath ? (
            <MonacoPane
              path={activePath}
              value={content}
              onChange={setContent}
              onSave={saveNow}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Select a file to edit
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
