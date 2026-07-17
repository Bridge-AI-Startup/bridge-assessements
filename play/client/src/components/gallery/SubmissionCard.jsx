import { Link } from "react-router-dom";
import CardPreview from "@/components/gallery/CardPreview";

export default function SubmissionCard({ item }) {
  return (
    <Link
      to={`/Submission?id=${item.id}`}
      className="overflow-hidden rounded-2xl border border-line bg-paper shadow-card transition-colors hover:border-fog-light"
    >
      <div className="p-2">
        <CardPreview submissionId={item.id} />
      </div>
      <div className="px-4 pb-4 pt-2">
        <div className="mb-2">
          <span className="label-mono">Preview</span>
        </div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[15px] font-medium text-ink">
              {item.displayName}
              {item.isMine ? (
                <span className="ml-2 rounded-full bg-accent-blue/10 px-2 py-0.5 font-mono text-[10px] uppercase text-accent-blue">
                  you
                </span>
              ) : null}
            </p>
            <p className="mt-1 font-mono text-xs text-fog-light">
              #{item.rank ?? "—"} · score {item.score}
              {item.provisional ? " · provisional" : ""}
            </p>
          </div>
          <span className="rounded-full bg-mist px-2 py-0.5 font-mono text-[11px] text-fog">
            {item.wins}-{item.losses}
          </span>
        </div>
      </div>
    </Link>
  );
}
