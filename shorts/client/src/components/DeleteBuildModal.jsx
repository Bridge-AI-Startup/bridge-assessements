import BuildStopModal from "@/components/workspace/BuildStopModal";

/**
 * Confirm taking a build out of the gallery. Same cleanup as admin delete
 * (votes pointing at it go too); the copy does not mention that.
 *
 * @param {{
 *   displayName: string,
 *   deleting?: boolean,
 *   error?: string | null,
 *   onConfirm: () => void,
 *   onClose: () => void,
 * }} props
 */
export default function DeleteBuildModal({
  displayName,
  deleting = false,
  error = null,
  onConfirm,
  onClose,
}) {
  return (
    <BuildStopModal
      labelledById="delete-build-title"
      title="Delete this build?"
      description={
        <>
          &ldquo;{displayName}&rdquo; will leave the gallery and the ranking.
          This can&rsquo;t be undone.
        </>
      }
      note={error}
      actions={[
        { label: "Cancel", onClick: onClose, disabled: deleting },
        {
          label: deleting ? "Deleting…" : "Delete",
          onClick: onConfirm,
          variant: "primary",
          disabled: deleting,
        },
      ]}
      onClose={deleting ? () => {} : onClose}
    />
  );
}
