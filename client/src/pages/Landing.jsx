import { useState } from "react";
import {
  Sparkles,
  MessageCircle,
  Search,
  FlaskConical,
  Upload,
} from "lucide-react";
import bridgeLogo from "@/assets/bridge-logo.svg";
import DemoReplayGlass from "@/components/landing/DemoReplayGlass";
import ProblemSolution from "@/components/landing/ProblemSolution";
import AssessmentGenerator from "@/components/landing/AssessmentGenerator";
import DevToolsStack from "@/components/landing/DevToolsStack";
import WorkflowTimeline from "@/components/landing/WorkflowTimeline";
import {
  AIUsageCard,
  CommunicationCard,
  ResearchCard,
  TestingCard,
  SubmissionCard,
} from "@/components/landing/SignalCards";

/**
 * Marketing landing page — in-code rebuild of the Framer site at bridge-jobs.com.
 * Copy, imagery, and section structure mirror the published site; the animated
 * demos are the actual Framer code components, ported into
 * client/src/components/landing/.
 *
 * One page, anchor-linked sections: #how-it-works, #understand, #demo.
 * Static assets live in /public/landing (pulled from the Framer deploy).
 */

const CALENDLY_URL = "https://calendly.com/smahadkar-ucsd/30min";
const SHORTS_URL = "https://shorts.bridge-jobs.com/";
const NOTES_URL = "https://bridge-jobs.com/notes";
const DEMO_YOUTUBE_ID = "SodTSHtmAI4";

const NAV_LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Signals", href: "#understand" },
  { label: "Demo", href: "#demo" },
  { label: "Notes", href: NOTES_URL },
];

function isExternal(href) {
  return href.startsWith("http");
}

function PillLink({ href, children, variant = "dark", className = "" }) {
  const styles =
    variant === "dark"
      ? "bg-ink text-cream hover:bg-ink/85"
      : "bg-white text-ink border border-ink/15 hover:border-ink/35";
  return (
    <a
      href={href}
      target={isExternal(href) ? "_blank" : undefined}
      rel={isExternal(href) ? "noreferrer" : undefined}
      className={`inline-flex items-center justify-center rounded-pill px-5 py-2.5 font-mono text-xs uppercase tracking-[0.03em] transition-colors ${styles} ${className}`}
    >
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Nav                                                                 */
/* ------------------------------------------------------------------ */

function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink/5 bg-cream/85 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2.5">
          <img src={bridgeLogo} alt="Bridge" className="h-6 w-auto" />
          <span className="text-[15px] font-medium tracking-tight text-ink">Bridge</span>
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target={isExternal(link.href) ? "_blank" : undefined}
              rel={isExternal(link.href) ? "noreferrer" : undefined}
              className="font-mono text-xs uppercase tracking-[0.03em] text-ink/70 transition-colors hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          <PillLink href={SHORTS_URL} variant="light" className="hidden sm:inline-flex">
            Shorts
          </PillLink>
          <PillLink href={CALENDLY_URL}>Book a demo</PillLink>
        </div>
      </nav>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <section id="top" className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-16 lg:grid-cols-2 lg:gap-16 lg:pt-24">
      <div>
        <h1 className="text-4xl leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[3.4rem]">
          Engineering Has Changed.{" "}
          <span className="text-ink/40">Coding Tests Haven&apos;t.</span>
        </h1>
        <p className="mt-5 max-w-md text-base leading-relaxed text-ink/65">
          Bridge analyzes how candidates research, use AI, debug, and write code, not
          just whether tests pass.
        </p>
        <div className="mt-8">
          <PillLink href={CALENDLY_URL}>Book demo</PillLink>
        </div>
      </div>
      <DemoReplayGlass placeholderImageUrl="/landing/screen-recording.png" />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Statement + Legacy-vs-Bridge comparison                             */
/* ------------------------------------------------------------------ */

function Statement() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <h2 className="max-w-2xl text-3xl tracking-tight text-ink sm:text-4xl">
        Coding tests weren&apos;t built for the AI era.
      </h2>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-ink/65">
        AI tools make passing coding tests easier than ever. What matters now is how
        engineers research, use AI, debug, and iterate. Bridge captures this entire
        workflow.
      </p>

      {/* Comparison panel floats on the pale landscape, as on the live site. */}
      <div className="relative mt-12 overflow-hidden rounded-2xl">
        <img
          src="/landing/statement.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="relative px-4 py-10 sm:px-10 sm:py-14">
          <ProblemSolution />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const HOW_CARDS = [
  {
    title: "Generate a custom assessment",
    image: "/landing/card-generate.jpg",
    Demo: AssessmentGenerator,
    description:
      "Bridge turns your job description into a real engineering task. Not another question bank.",
  },
  {
    title: "Candidates work in their own environment",
    image: "/landing/card-environment.jpg",
    Demo: DevToolsStack,
    description:
      "Candidates complete the task using the tools they normally work with, including AI assistants, research, and debugging tools, while explaining their thinking to the Bridge agent.",
  },
  {
    title: "Bridge analyzes the workflow",
    image: "/landing/card-workflow.jpg",
    Demo: WorkflowTimeline,
    description:
      "Bridge captures signals like research, AI usage, debugging, and communication. Submissions are also run and analyzed in our cloud to generate structured insights.",
  },
];

/**
 * Plus that morphs into a minus: two white 20×2 bars, the vertical one rotates
 * flat on hover — same construction as the Framer button (48px round,
 * white/10 fill).
 */
function PlusMinusButton({ open, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? "Hide description" : "Show description"}
      className="relative h-12 w-12 shrink-0 rounded-full bg-white/10"
    >
      <span className="absolute left-1/2 top-1/2 h-[2px] w-5 -translate-x-1/2 -translate-y-1/2 bg-white" />
      <span
        className={`absolute left-1/2 top-1/2 h-[2px] w-5 -translate-x-1/2 -translate-y-1/2 bg-white transition-transform duration-300 ${
          open ? "rotate-0" : "rotate-90"
        }`}
      />
    </button>
  );
}

function HowCard({ card }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false); // touch fallback: tap the button
  const open = hovered || pinned;
  const { Demo } = card;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex h-[460px] flex-col overflow-hidden rounded-xl"
    >
      <img
        src={card.image}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="relative flex min-h-0 flex-1 flex-col justify-between px-6 py-5">
        <h3 className="max-w-[16rem] text-2xl font-medium leading-snug tracking-tight text-[#111]">
          {card.title}
        </h3>

        {/* Animation always running; squeezed when the description opens. */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <Demo style={{ width: "100%", height: 280 }} />
        </div>

        <div className="flex items-end justify-end gap-3">
          <div
            className="flex-1 overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
            style={{ maxHeight: open ? 220 : 0, opacity: open ? 1 : 0 }}
          >
            <p className="text-lg leading-[1.4] text-white/80">
              {card.description}
            </p>
          </div>
          <PlusMinusButton open={open} onClick={() => setPinned((v) => !v)} />
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <h2 className="text-3xl tracking-tight text-ink sm:text-4xl">How it works</h2>
      <p className="mt-3 text-base text-ink/60">
        A view into how your candidates think.
      </p>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {HOW_CARDS.map((card) => (
          <HowCard key={card.title} card={card} />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Signals                                                             */
/* ------------------------------------------------------------------ */

const SIGNALS = [
  {
    label: "AI Usage",
    icon: Sparkles,
    image: "/landing/signal-ai-usage.jpg",
    Card: AIUsageCard,
    caption: "Bridge analyzes how candidates prompt, iterate, and apply AI suggestions.",
  },
  {
    label: "Communication",
    icon: MessageCircle,
    image: "/landing/signal-communication.jpg",
    Card: CommunicationCard,
    caption:
      "Bridge captures how candidates reason about their solutions during the assessment.",
  },
  {
    label: "Research",
    icon: Search,
    image: "/landing/signal-research.jpg",
    Card: ResearchCard,
    caption:
      "Bridge captures how candidates use documentation, examples, and resources while solving problems.",
  },
  {
    label: "Testing",
    icon: FlaskConical,
    image: "/landing/signal-testing.jpg",
    Card: TestingCard,
    caption:
      "Bridge captures how candidates run tests, identify failures, and iterate on their solutions.",
  },
  {
    label: "Submission",
    icon: Upload,
    image: "/landing/signal-submission.jpg",
    Card: SubmissionCard,
    caption:
      "Bridge evaluates the structure, correctness, and quality of the final implementation.",
  },
];

function Signals() {
  const [active, setActive] = useState(0);
  const signal = SIGNALS[active];
  const { Card } = signal;

  return (
    <section id="understand" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <h2 className="text-3xl tracking-tight text-ink sm:text-4xl">
        Understand how candidates work
      </h2>

      {/* Panorama with the analysis card; caption sits in a glass bar at the
          bottom of the image, as on the live site. */}
      <div className="relative mt-10 flex min-h-[600px] flex-col overflow-hidden rounded-[32px]">
        <img
          src={signal.image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="relative flex flex-1 items-center justify-center px-4 py-10 sm:px-10">
          <Card />
        </div>
        <div className="relative bg-black/25 px-8 py-8 backdrop-blur-[30px]">
          <p className="text-center text-base text-white">{signal.caption}</p>
        </div>
      </div>

      {/* Tab pills */}
      <div className="mt-6 flex justify-center">
        <div className="flex flex-wrap justify-center gap-1 rounded-pill border border-ink/10 bg-white p-1">
          {SIGNALS.map((s, i) => {
            const Icon = s.icon;
            return (
              <button
                key={s.label}
                type="button"
                onClick={() => setActive(i)}
                className={`flex items-center gap-1.5 rounded-pill px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.03em] transition-colors ${
                  i === active ? "bg-ink text-cream" : "text-ink/50 hover:text-ink"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

function Demo() {
  return (
    <section id="demo" className="mx-auto max-w-5xl scroll-mt-20 px-5 py-20">
      <div className="text-center">
        <h2 className="text-3xl tracking-tight text-ink sm:text-4xl">See how it works</h2>
        <p className="mt-3 text-base text-ink/60">Check out the demo below.</p>
      </div>
      <div className="mt-10 overflow-hidden rounded-2xl border border-ink/10 bg-ink shadow-sm">
        <div className="aspect-video">
          <iframe
            className="h-full w-full"
            src={`https://www.youtube.com/embed/${DEMO_YOUTUBE_ID}?iv_load_policy=3&rel=0&modestbranding=1&playsinline=1`}
            title="Bridge demo"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

function Footer() {
  return (
    <footer className="relative overflow-hidden bg-ink text-cream">
      {/* Ambient video band behind the closing CTA (from the Framer deploy). */}
      <video
        src="/landing/hero-video.mp4"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-25"
        autoPlay
        loop
        muted
        playsInline
      />
      <div className="relative mx-auto max-w-6xl px-5 py-20 text-center">
        <h2 className="text-3xl tracking-tight sm:text-4xl">
          Hiring engineers for the AI era.
        </h2>
        <div className="mt-8 flex justify-center">
          <a
            href={CALENDLY_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-pill bg-cream px-6 py-3 font-mono text-xs uppercase tracking-[0.03em] text-ink transition-colors hover:bg-white"
          >
            Book a demo
          </a>
        </div>
      </div>

      <div className="relative border-t border-cream/10 bg-ink/60 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 px-5 py-8 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <img src={bridgeLogo} alt="" className="h-5 w-auto invert" />
            <span className="text-sm font-medium tracking-tight">Bridge</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {[...NAV_LINKS, { label: "Shorts", href: SHORTS_URL }].map((link) => (
              <a
                key={link.label}
                href={link.href}
                target={isExternal(link.href) ? "_blank" : undefined}
                rel={isExternal(link.href) ? "noreferrer" : undefined}
                className="font-mono text-xs uppercase tracking-[0.03em] text-cream/50 transition-colors hover:text-cream"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */

export default function Landing() {
  return (
    <div className="min-h-screen bg-cream text-ink">
      <LandingNav />
      <main>
        <Hero />
        <Statement />
        <HowItWorks />
        <Signals />
        <Demo />
      </main>
      <Footer />
    </div>
  );
}
