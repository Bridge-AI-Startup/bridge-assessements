import { Link } from "react-router-dom";
import ShortsHeader from "@/components/ShortsHeader";
import ShortsFooter from "@/components/ShortsFooter";
import bridgeLogo from "@/assets/bridge-logo.svg";

const BRIDGE_SITE_URL = "https://www.bridge-jobs.com";

/**
 * The "what is this and why does it exist" page.
 *
 * Shorts is a promotional product for Bridge, and the connection is the whole
 * point, but a footer sentence can only assert it. This page argues it: the
 * thesis (interviews stopped measuring the job), the format that tests it, and
 * the hiring platform built on the same idea. Linked from the nav and footer.
 */

const STEPS = [
  {
    n: "01",
    title: "Get the challenge",
    body: "Identical for everyone. Small enough to finish in a sitting.",
  },
  {
    n: "02",
    title: "Build it with AI",
    body: "You get a workspace and a credit budget. Describe what you want, judge what comes back, keep going until it's yours.",
  },
  {
    n: "03",
    title: "Submit it",
    body: "Ship up to three builds this round. No countdown to beat. The round ends when it ends, and a build is saved the moment you send it.",
  },
  {
    n: "04",
    title: "Vote, and get ranked",
    body: "Builds go head to head, two at a time. Enough matchups and a ranking falls out of it.",
  },
];

export default function About() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <ShortsHeader active="about" cta={{ label: "Start building", to: "/Build" }} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 lg:py-16">
        {/* Hero */}
        <section className="max-w-3xl">
          <p className="label-mono">What is Bridge Shorts</p>
          <h1 className="mt-5 text-[40px] font-medium leading-[1.1] tracking-tight lg:text-[52px]">
            <span className="text-ink">
              Everyone gets the same challenge and the same model.
            </span>{" "}
            <span className="text-fog-light">The difference is you.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-fog">
            Shorts is a build challenge. One per round, a fixed credit
            budget, and an AI that will write whatever you ask it to. What
            separates the builds isn't access to better tools. It's taste,
            judgment, and knowing when something is done.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/Build" className="btn-pill px-6 py-3">
              Start building
            </Link>
            <Link to="/Gallery" className="btn-pill-secondary px-6 py-3">
              Browse builds
            </Link>
          </div>
        </section>

        {/* Thesis */}
        <section className="mt-16 border-t border-line pt-12 lg:mt-24 lg:pt-16">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-16">
            <div className="lg:sticky lg:top-12 lg:self-start">
              <p className="label-mono">Why it exists</p>
              <h2 className="mt-4 text-[28px] font-medium leading-tight tracking-tight text-ink lg:text-[34px]">
                Coding interviews stopped measuring the job.
              </h2>
            </div>
            <div className="space-y-5 text-[17px] leading-relaxed text-fog">
              <p>
                For twenty years, the way to prove you could build software was
                to reproduce a data structure on a whiteboard while someone
                watched. That was always a proxy. Now it's a broken one. The
                model in your editor recalls the algorithm faster than you can.
              </p>
              <p>
                The skill that actually separates people is harder to name and
                much harder to fake:{" "}
                <span className="font-medium text-ink">
                  knowing what to build, directing a model that will confidently
                  do the wrong thing, catching it when it does, and deciding when
                  the thing is finished.
                </span>
              </p>
              <p>
                That's what a round of Shorts puts on display. Everyone starts
                from the same blank workspace, the same challenge, the same budget.
                Nobody has a better model than anyone else. What you have at the
                end is a build that could only have come from you.
              </p>
            </div>
          </div>
        </section>

        {/* How a round works */}
        <section className="mt-16 border-t border-line pt-12 lg:mt-24 lg:pt-16">
          <p className="label-mono">How a round works</p>
          <h2 className="mt-4 max-w-2xl text-[28px] font-medium leading-tight tracking-tight text-ink lg:text-[34px]">
            Build something small. Let people pick their favourite.
          </h2>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <div
                key={step.n}
                className={`punch-card-sm px-5 py-6 transition-transform duration-200 hover:rotate-0 ${
                  i % 2 === 0 ? "-rotate-1" : "rotate-1"
                }`}
              >
                <span className="font-mono text-[11px] tracking-label text-fog-light">
                  {step.n}
                </span>
                <h3 className="mt-3 text-[17px] font-medium tracking-tight text-ink">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-fog">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* The Bridge connection */}
        <section className="mt-16 border-t border-line pt-12 lg:mt-24 lg:pt-16">
          <div className="punch-card overflow-hidden bg-cream">
            <div className="grid gap-8 px-6 py-10 sm:px-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14 lg:py-14">
              <div>
                <div className="flex items-center gap-2.5">
                  <img
                    src={bridgeLogo}
                    alt=""
                    className="h-6 w-6 object-contain"
                    width={24}
                    height={24}
                  />
                  <p className="label-mono">Made by Bridge</p>
                </div>
                <h2 className="mt-5 text-[28px] font-medium leading-tight tracking-tight text-ink lg:text-[34px]">
                  We built the serious version first.
                </h2>
              </div>

              <div className="space-y-5 text-[17px] leading-relaxed text-fog">
                <p>
                  Bridge is a hiring platform built on the same idea. Employers
                  generate take-home assessments with AI, send them to
                  candidates, and see how the work actually happened: the
                  prompts, the dead ends, the fixes, instead of guessing from a
                  final diff.
                </p>
                <p>
                  Shorts is that thesis with the stakes removed. Same question,
                  asked for fun, in public, on a weekly clock.
                </p>
                <div className="flex flex-wrap gap-3 pt-1">
                  <a href={BRIDGE_SITE_URL} className="btn-pill px-6 py-3">
                    Visit Bridge
                  </a>
                  <Link to="/Build" className="btn-pill-secondary px-6 py-3">
                    Play a round
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <ShortsFooter />
    </div>
  );
}
