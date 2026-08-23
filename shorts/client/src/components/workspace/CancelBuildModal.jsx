import BuildStopModal from "@/components/workspace/BuildStopModal";

/**
 * Confirm abandoning an in-progress build (kills the sandbox / frees the seat).
 *
 * @param {{
 *   cancelling?: boolean,
 *   error?: string | null,
 *   onConfirm: () => void,
 *   onClose: () => void,
 * }} props
 */
export default function CancelBuildModal({
  cancelling = false,
  error = null,
  onConfirm,
  onClose,
}) {
  return (
    <BuildStopModal
      labelledById="cancel-build-title"
      title="Leave this build?"
      description="This ends the session and takes you back to Shorts home — you can’t come back to it."
      note={error}
      actions={[
        { label: "Keep building", onClick: onClose, disabled: cancelling },
        {
          label: cancelling ? "Leaving…" : "Leave for Shorts",
          onClick: onConfirm,
          variant: "primary",
          disabled: cancelling,
        },
      ]}
      onClose={cancelling ? () => {} : onClose}
    />
  );
}
