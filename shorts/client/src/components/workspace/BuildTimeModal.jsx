import BuildStopModal from "@/components/workspace/BuildStopModal";

/**
 * The two clock pop-ups.
 *
 * `warning` fires shortly before the build clock runs out, while submitting is
 * still ordinary. `timeUp` fires at zero: building is over, but the server
 * accepts a submit for a short grace window (`canSubmit`), so the pop-up leads
 * with it and counts the window down.
 *
 * @param {{
 *   kind: "warning" | "timeUp",
 *   timeLabel?: string,
 *   graceLabel?: string | null,
 *   canSubmit?: boolean,
 *   note?: string | null,
 *   busy?: boolean,
 *   onSubmitBuild: () => void,
 *   onTryAgain: () => void,
 *   onClose: () => void,
 * }} props
 */
export default function BuildTimeModal({
  kind,
  timeLabel = "",
  graceLabel = null,
  canSubmit = true,
  note = null,
  busy = false,
  onSubmitBuild,
  onTryAgain,
  onClose,
}) {
  if (kind === "warning") {
    return (
      <BuildStopModal
        labelledById="build-time-warning-title"
        title="Almost out of time"
        description={
          <>
            The build clock runs out in about a minute. After that you can&rsquo;t
            make more changes — so if what you have is good, submit it now.
          </>
        }
        meta={timeLabel ? `${timeLabel} left to build.` : null}
        footnote="Submitting saves your build and ends this session."
        actions={[
          { label: "Keep building", onClick: onClose },
          {
            label: "Submit build",
            onClick: onSubmitBuild,
            variant: "primary",
          },
        ]}
        onClose={onClose}
      />
    );
  }

  return (
    <BuildStopModal
      labelledById="build-time-up-title"
      title="Time's up"
      description={
        canSubmit ? (
          <>
            The build clock ran out, so no more changes can be made. Everything
            you made is saved — send it in now, before the last-minute window
            closes.
          </>
        ) : (
          <>
            The build clock ran out and the window to submit has closed. You can
            start a fresh build if a seat is free.
          </>
        )
      }
      meta={
        canSubmit && graceLabel ? `${graceLabel} left to submit.` : null
      }
      note={note}
      footnote="Try again starts a new build with a new clock, if a seat is free."
      actions={[
        { label: "Cancel", onClick: onClose, disabled: busy },
        {
          label: busy ? "Starting…" : "Try again",
          onClick: onTryAgain,
          // With the submit window closed this is the only way forward.
          variant: canSubmit ? "secondary" : "primary",
          disabled: busy,
        },
        ...(canSubmit
          ? [
              {
                label: "Submit build",
                onClick: onSubmitBuild,
                variant: "primary",
                disabled: busy,
              },
            ]
          : []),
      ]}
      onClose={onClose}
    />
  );
}
