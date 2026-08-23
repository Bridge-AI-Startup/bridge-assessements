import BuildStopModal from "@/components/workspace/BuildStopModal";

/**
 * Confirm resetting an in-progress build back to the starter (one per session).
 *
 * @param {{
 *   restarting?: boolean,
 *   error?: string | null,
 *   onConfirm: () => void,
 *   onClose: () => void,
 * }} props
 */
export default function RestartBuildModal({
  restarting = false,
  error = null,
  onConfirm,
  onClose,
}) {
  return (
    <BuildStopModal
      labelledById="restart-build-title"
      title="Restart this build?"
      description="This clears your chat and workspace back to the starter. You get one restart per build."
      note={error}
      actions={[
        { label: "Keep building", onClick: onClose, disabled: restarting },
        {
          label: restarting ? "Restarting…" : "Restart",
          onClick: onConfirm,
          variant: "primary",
          disabled: restarting,
        },
      ]}
      onClose={restarting ? () => {} : onClose}
    />
  );
}
