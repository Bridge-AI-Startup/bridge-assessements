/**
 * Build a blob URL for previewing a multi-file HTML project in an iframe.
 * Rewrites relative src/href in the entry HTML to blob: URLs.
 */
export function buildPreviewBlobUrl(files) {
  if (!files?.length) return null;

  const byPath = new Map();
  for (const f of files) {
    const key = f.path.replace(/^\.\//, "").replace(/^\/+/, "");
    byPath.set(key, f.content);
    byPath.set(key.split("/").pop(), f.content);
  }

  const entry =
    files.find((f) => f.path === "index.html" || f.path.endsWith("/index.html")) ||
    files.find((f) => /\.html?$/i.test(f.path));

  if (!entry) return null;

  const entryDir = entry.path.includes("/")
    ? entry.path.slice(0, entry.path.lastIndexOf("/") + 1)
    : "";

  const mimeFor = (path) => {
    const lower = path.toLowerCase();
    if (lower.endsWith(".css")) return "text/css";
    if (lower.endsWith(".js") || lower.endsWith(".mjs"))
      return "text/javascript";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".json")) return "application/json";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
    return "text/plain";
  };

  const blobUrls = new Map();
  const revokeList = [];

  const resolvePath = (fromDir, ref) => {
    if (!ref || /^(https?:|data:|blob:|#|mailto:|javascript:)/i.test(ref)) {
      return null;
    }
    const cleaned = ref.split("?")[0].split("#")[0];
    const parts = (fromDir + cleaned).split("/");
    const out = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    return out.join("/");
  };

  const urlForPath = (relPath) => {
    if (blobUrls.has(relPath)) return blobUrls.get(relPath);
    const content = byPath.get(relPath);
    if (content == null) return null;
    const blob = new Blob([content], { type: mimeFor(relPath) });
    const url = URL.createObjectURL(blob);
    blobUrls.set(relPath, url);
    revokeList.push(url);
    return url;
  };

  // Pre-create blobs for all files so nested refs resolve
  for (const f of files) {
    const key = f.path.replace(/^\.\//, "").replace(/^\/+/, "");
    urlForPath(key);
  }

  let html = entry.content;
  html = html.replace(
    /(src|href)=["']([^"']+)["']/gi,
    (match, attr, ref) => {
      const resolved = resolvePath(entryDir, ref);
      if (!resolved) return match;
      const url = urlForPath(resolved);
      if (!url) return match;
      return `${attr}="${url}"`;
    },
  );

  const htmlBlob = new Blob([html], { type: "text/html" });
  const previewUrl = URL.createObjectURL(htmlBlob);
  revokeList.push(previewUrl);

  return {
    url: previewUrl,
    revoke: () => {
      for (const u of revokeList) URL.revokeObjectURL(u);
    },
  };
}
