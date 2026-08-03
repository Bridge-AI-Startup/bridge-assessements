import BuildStopModal from "@/components/workspace/BuildStopModal";

/**
 * Shown when a build has spent its whole token budget ("credits").
 *
 * Credits are per build session, so the honest options are: submit what you
 * already made, re-check and retry (the failure may have been a passing upstream
 * hiccup rather than the budget), or close and keep looking at the build.
 *
 * @param {{
 *   tokensUsed?: number,
 *   tokenBudget?: number,
 *   note?: string | null,
 *   checking?: boolean,
 *   onSubmitBuild: () => void,
 *   onTryAgain: () => void,
 *   onClose: () => void,
 * }} props
 */
export default function OutOfCreditsModal({
  tokensUsed = 0,
  tokenBudget = 0,
  note = null,
  checking = false,
  onSubmitBuild,
  onTryAgain,
  onClose,
}) {
  return (
    <BuildStopModal
      labelledById="out-of-credits-title"
      title="You ran out of credits"
      description={
        <>
          Every build gets a set amount of AI credits, and this one has used them
          all. You can&rsquo;t ask for more changes — but everything you made so
          far is saved and ready to submit.
        </>
      }
      meta={
        tokenBudget > 0
          ? `${tokensUsed.toLocaleString()} of ${tokenBudget.toLocaleString()} credits used.`
          : null
      }
      note={note}
      footnote="Try again re-checks your credits and re-sends your last message."
      actions={[
        { label: "Cancel", onClick: onClose, disabled: checking },
        {
          label: checking ? "Checking…" : "Try again",
          onClick: onTryAgain,
          disabled: checking,
        },
        {
          label: "Submit build",
          onClick: onSubmitBuild,
          variant: "primary",
          disabled: checking,
        },
      ]}
      onClose={onClose}
    />
  );
}
