import { Link } from "react-router-dom";
import bridgeLogo from "@/assets/bridge-logo.svg";

const BRIDGE_SITE_URL = "https://www.bridge-jobs.com";

/**
 * Site footer for the browsing pages (Home, Gallery, Submission, MySubmissions,
 * About). Its whole job is the Shorts → Bridge connection: say what Bridge is in
 * one sentence, offer the longer argument on /About, and send curious visitors
 * to bridge-jobs.com. Deliberately not mounted on Build or Vote — those are
 * focused task flows.
 */
export default function ShortsFooter() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-8 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="flex items-start gap-3">
          <img
            src={bridgeLogo}
            alt=""
            className="mt-0.5 h-6 w-6 shrink-0 object-contain"
            width={24}
            height={24}
          />
          <div>
            <p className="max-w-md text-sm leading-relaxed text-fog">
              <span className="font-medium text-ink">Bridge Shorts</span> is made
              by{" "}
              <a
                href={BRIDGE_SITE_URL}
                className="font-medium text-ink underline underline-offset-2"
              >
                Bridge
              </a>
              &nbsp;— the hiring platform where employers create AI-powered
              take-home assessments and see how candidates actually work.
            </p>
            <Link
              to="/About"
              className="mt-2 inline-block text-sm text-fog underline underline-offset-2 hover:text-ink"
            >
              Why we built Shorts →
            </Link>
          </div>
        </div>
        <a
          href={BRIDGE_SITE_URL}
          className="btn-pill-secondary shrink-0 self-start"
        >
          Visit Bridge
        </a>
      </div>
    </footer>
  );
}
