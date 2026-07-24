import { Link } from "react-router-dom";

const NAV = [
  { id: "browse", label: "Browse", to: "/Gallery" },
  { id: "vote", label: "Vote", to: "/Vote" },
  { id: "leaderboard", label: "Leaderboard", to: "/Leaderboard" },
];

/**
 * Shared Shorts nav — matches bridge-jobs.com mono uppercase labels + pill CTA.
 * @param {{ active?: "browse"|"vote"|"leaderboard"|null, cta?: { label: string, to: string }|null, children?: import("react").ReactNode }} props
 */
export default function ShortsHeader({ active = null, cta = null, children = null }) {
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <div className="flex min-w-0 items-center gap-8">
          <Link
            to="/"
            className="shrink-0 text-[15px] font-semibold tracking-tight"
          >
            <span className="text-ink">Bridge</span>{" "}
            <span className="text-fog-light">Shorts</span>
          </Link>
          <nav className="hidden items-center gap-5 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.id}
                to={item.to}
                className={`label-mono hover:text-ink ${
                  active === item.id ? "text-ink" : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {children}
          {cta ? (
            <Link to={cta.to} className="btn-pill">
              {cta.label}
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
