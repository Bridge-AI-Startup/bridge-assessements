import JSZip from "jszip";

/** Matches server default when SUBMISSION_UPLOAD_MAX_BYTES is unset. */
export const MAX_SUBMISSION_ARCHIVE_BYTES = 500 * 1024 * 1024;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { formatBytes };

function readEntryFiles(entry, basePath = "") {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      entry.file(
        (file) => {
          const relativePath = basePath ? `${basePath}/${file.name}` : file.name;
          resolve([{ file, path: relativePath }]);
        },
        reject
      );
      return;
    }

    if (!entry.isDirectory) {
      resolve([]);
      return;
    }

    const reader = entry.createReader();
    const entries = [];

    const readBatch = () => {
      reader.readEntries(
        async (batch) => {
          if (!batch.length) {
            try {
              const nested = await Promise.all(
                entries.map((child) =>
                  readEntryFiles(
                    child,
                    basePath ? `${basePath}/${entry.name}` : entry.name
                  )
                )
              );
              resolve(nested.flat());
            } catch (error) {
              reject(error);
            }
            return;
          }
          entries.push(...batch);
          readBatch();
        },
        reject
      );
    };

    readBatch();
  });
}

async function collectFilesFromDataTransfer(dataTransfer) {
  const items = dataTransfer?.items;
  if (items?.length) {
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      const nested = await Promise.all(entries.map((entry) => readEntryFiles(entry)));
      return nested.flat();
    }
  }

  return Array.from(dataTransfer?.files || []).map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
}

function collectFilesFromFileList(fileList) {
  return Array.from(fileList || []).map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
}

function isZipFile(file) {
  return file.name.toLowerCase().endsWith(".zip");
}

async function zipCollectedFiles(collected, archiveName = "submission.zip") {
  if (!collected.length) {
    throw new Error("No files were selected.");
  }

  const zip = new JSZip();
  for (const { file, path } of collected) {
    zip.file(path, file);
  }

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  if (blob.size > MAX_SUBMISSION_ARCHIVE_BYTES) {
    throw new Error(
      `Archive is too large (${formatBytes(blob.size)}). Maximum size is ${formatBytes(MAX_SUBMISSION_ARCHIVE_BYTES)}.`
    );
  }

  return new File([blob], archiveName, { type: "application/zip" });
}

function describeArchive(collected, archiveFile) {
  const topLevel = new Set(
    collected.map(({ path }) => path.split("/")[0]).filter(Boolean)
  );
  const label =
    topLevel.size === 1 ? [...topLevel][0] : `${collected.length} files`;

  return {
    label,
    fileCount: collected.length,
    sizeBytes: archiveFile.size,
    sizeLabel: formatBytes(archiveFile.size),
  };
}

/**
 * Build a submission .zip from drag-and-drop or folder/file picker input.
 * A single dropped .zip is passed through unchanged.
 */
export async function buildSubmissionArchiveFromDataTransfer(dataTransfer) {
  const collected = await collectFilesFromDataTransfer(dataTransfer);
  if (collected.length === 1 && isZipFile(collected[0].file)) {
    const zipFile = collected[0].file;
    if (zipFile.size > MAX_SUBMISSION_ARCHIVE_BYTES) {
      throw new Error(
        `Archive is too large (${formatBytes(zipFile.size)}). Maximum size is ${formatBytes(MAX_SUBMISSION_ARCHIVE_BYTES)}.`
      );
    }
    return {
      archive: zipFile,
      ...describeArchive([{ path: zipFile.name }], zipFile),
    };
  }

  const archive = await zipCollectedFiles(collected);
  return {
    archive,
    ...describeArchive(collected, archive),
  };
}

export async function buildSubmissionArchiveFromFileList(fileList) {
  const collected = collectFilesFromFileList(fileList);
  if (collected.length === 1 && isZipFile(collected[0].file)) {
    const zipFile = collected[0].file;
    if (zipFile.size > MAX_SUBMISSION_ARCHIVE_BYTES) {
      throw new Error(
        `Archive is too large (${formatBytes(zipFile.size)}). Maximum size is ${formatBytes(MAX_SUBMISSION_ARCHIVE_BYTES)}.`
      );
    }
    return {
      archive: zipFile,
      ...describeArchive([{ path: zipFile.name }], zipFile),
    };
  }

  const archive = await zipCollectedFiles(collected);
  return {
    archive,
    ...describeArchive(collected, archive),
  };
}
