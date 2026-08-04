import { Link } from "react-router-dom";
import CardPreview from "@/components/gallery/CardPreview";

/** Podium tint for the top three — everything below is plain. */
const TOP_RANK = {
  1: "bg-accent-amber/15 text-accent-amber",
  2: "bg-accent-violet/15 text-accent-violet",
  3: "bg-accent-blue/15 text-accent-blue",
};

export default function SubmissionCard({ item }) {
  const rank = item.rank ?? null;

  return (
    <Link
      to={`/Submission?id=${item.id}`}
      className="overflow-hidden rounded-2xl border border-line bg-paper shadow-card transition-colors hover:border-fog-light"
    >
      <div className="relative p-2">
        <CardPreview
          submissionId={item.id}
          previewRevision={item.previewRevision}
        />
        {rank ? (
          <span
            className={`absolute left-4 top-4 rounded-full px-2.5 py-1 font-mono text-[13px] font-semibold tabular-nums shadow-card ${
              TOP_RANK[rank] || "bg-paper/90 text-ink"
            }`}
          >
            #{rank}
          </span>
        ) : null}
      </div>
      <div className="px-4 pb-4 pt-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-ink">
              {item.displayName}
              {item.isMine ? (
                <span className="ml-2 rounded-full bg-accent-blue/10 px-2 py-0.5 font-mono text-[10px] uppercase text-accent-blue">
                  you
                </span>
              ) : null}
            </p>
            <p className="mt-1 font-mono text-xs text-fog-light">
              score {item.score}
              {item.provisional ? " · provisional" : ""}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-mist px-2 py-0.5 font-mono text-[11px] text-fog">
            {item.wins}-{item.losses}
          </span>
        </div>
      </div>
    </Link>
  );
}
