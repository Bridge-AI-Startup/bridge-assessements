function basename(path) {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

/**
 * Nested file tree from flat path list.
 */
export default function FileTree({ files, activePath, onSelect }) {
  const paths = (files || []).map((f) => f.path).sort();

  if (paths.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-slate-400">No files yet.</p>
    );
  }

  return (
    <ul className="space-y-0.5 px-1 py-1 text-sm">
      {paths.map((path) => {
        const active = path === activePath;
        return (
          <li key={path}>
            <button
              type="button"
              onClick={() => onSelect(path)}
              title={path}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left font-mono text-xs ${
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span className="truncate">{basename(path)}</span>
            </button>
            {path.includes("/") && !active && (
              <p className="truncate px-2 pb-0.5 font-mono text-[10px] text-slate-400">
                {path}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
