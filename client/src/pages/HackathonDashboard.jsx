import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { UserPlus, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getCompetition,
  getHackathonDefaultSlug,
  joinCompetition,
  CompetitionNotFoundError,
} from "@/api/competition";
import {
  CHALLENGE_BRAND_NAME,
  SINGLE_COMPETITION_SLUG,
  hackathonReleaseAtIso,
  hackathonReleaseCountdownEnabled,
  isHackathonJoinBlocked,
} from "@/config/competition";
import ReleaseCountdownBanner from "@/components/hackathon/ReleaseCountdownBanner.jsx";
import bridgeLogo from "@/assets/bridge-logo.svg";

const BRIDGE_MARKETING_URL = "https://bridge-jobs.com/";

export default function HackathonDashboard() {
  const [searchParams] = useSearchParams();
  const fromQuery = searchParams.get("slug")?.trim().toLowerCase() || "";
  const fromEnv =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_DEFAULT_COMPETITION_SLUG
      ? String(import.meta.env.VITE_DEFAULT_COMPETITION_SLUG).trim().toLowerCase()
      : "";

  const [remoteDefaultSlug, setRemoteDefaultSlug] = useState(undefined);
  useEffect(() => {
    let cancelled = false;
    if (fromQuery || fromEnv) {
      setRemoteDefaultSlug(null);
      return undefined;
    }
    getHackathonDefaultSlug()
      .then((s) => {
        if (!cancelled) setRemoteDefaultSlug(s);
      })
      .catch(() => {
        if (!cancelled) setRemoteDefaultSlug(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fromQuery, fromEnv]);

  const slug =
    fromQuery ||
    fromEnv ||
    (remoteDefaultSlug !== undefined
      ? remoteDefaultSlug || SINGLE_COMPETITION_SLUG
      : null);

  const slugPending = !fromQuery && !fromEnv && remoteDefaultSlug === undefined;

  const [competition, setCompetition] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [missingCompetitionSlug, setMissingCompetitionSlug] = useState(null);
  const [loading, setLoading] = useState(true);

  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);

  /** Advances once per second while countdown mode is on so registration unlocks at go-live without refresh. */
  const [releaseClockMs, setReleaseClockMs] = useState(() => Date.now());
  useEffect(() => {
    if (!hackathonReleaseCountdownEnabled()) return undefined;
    const id = setInterval(() => setReleaseClockMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const loadCompetition = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setLoadError(null);
    setMissingCompetitionSlug(null);
    try {
      const data = await getCompetition(slug);
      setCompetition(data);
    } catch (e) {
      setCompetition(null);
      if (e instanceof CompetitionNotFoundError) {
        setMissingCompetitionSlug(e.slug);
      } else {
        setLoadError(e?.message || "Failed to load competition");
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (slugPending || !slug) return;
    loadCompetition();
  }, [loadCompetition, slug, slugPending]);

  const handleJoin = async (e) => {
    e.preventDefault();
    setJoinError(null);
    if (!slug) return;
    if (isHackathonJoinBlocked()) {
      setJoinError(`${CHALLENGE_BRAND_NAME} hasn't started yet.`);
      return;
    }
    setJoining(true);
    try {
      const res = await joinCompetition(slug, {
        candidateName: candidateName.trim(),
        candidateEmail: candidateEmail.trim(),
      });
      // Same candidate URL as employer "generate link" / email invite — full navigation like opening the link.
      const target =
        res.shareLink ||
        `${window.location.origin}/CandidateAssessment?token=${encodeURIComponent(res.token)}`;
      window.location.assign(target);
    } catch (err) {
      setJoinError(err?.message || "Could not register");
    } finally {
      setJoining(false);
    }
  };

  const registrationAllowed =
    competition?.registrationOpen &&
    (!competition?.competitionEndsAt ||
      new Date(competition.competitionEndsAt).getTime() >= Date.now()) &&
    (!competition?.competitionStartsAt ||
      new Date(competition.competitionStartsAt).getTime() <= Date.now());

  const notStartedYet = isHackathonJoinBlocked(releaseClockMs);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3.5">
          <a
            href={BRIDGE_MARKETING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 transition-opacity hover:opacity-90"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200/80">
              <img
                src={bridgeLogo}
                alt="Bridge"
                className="h-8 w-8 object-contain"
                width={32}
                height={32}
              />
            </span>
            <div className="text-left">
              <p className="text-sm font-semibold tracking-tight text-slate-900">Bridge</p>
              <p className="text-xs text-slate-500">{CHALLENGE_BRAND_NAME}</p>
            </div>
          </a>
          <a
            href={BRIDGE_MARKETING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 text-sm font-medium text-[#1e3a8a] hover:underline sm:inline-flex"
          >
            bridge-jobs.com
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      {hackathonReleaseCountdownEnabled() ? (
        <ReleaseCountdownBanner releaseAtIso={hackathonReleaseAtIso()} />
      ) : null}

      <main className="mx-auto max-w-5xl px-4 py-10 md:py-12">
        <div className="mb-10 text-center md:text-left">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
            {CHALLENGE_BRAND_NAME}
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Enter your details to get a personal link. Instructions and assessment details appear on
            the next screen — same as a normal candidate invite, nothing is shown until then.
          </p>
        </div>

        <div className="space-y-10">
          {loading || slugPending ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-10 w-10 animate-spin text-slate-400" />
            </div>
          ) : missingCompetitionSlug ? (
            <Card className="border-amber-200 bg-amber-50/80">
              <CardHeader>
                <CardTitle className="text-amber-950">{CHALLENGE_BRAND_NAME} isn't configured yet</CardTitle>
                <CardDescription className="text-base text-amber-950/90">
                  There is no competition in the database for slug{" "}
                  <span className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-sm">
                    {missingCompetitionSlug}
                  </span>
                  . Link it to your assessment (e.g. Basic Python Program for Restaurant Order
                  Processing — Saaz) in MongoDB.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-amber-950/85">
                <p className="font-medium">Seed script (from server/)</p>
                <pre className="overflow-x-auto rounded-lg bg-[#0c1222] p-4 text-xs text-slate-100">
                  npx tsx src/scripts/seedCompetition.ts YOUR_ASSESSMENT_ID {missingCompetitionSlug}
                </pre>
                <p className="text-xs text-amber-900/80">
                  Fallback slug in{" "}
                  <code className="rounded bg-white/60 px-1">client/src/config/competition.js</code>{" "}
                  is <code className="rounded bg-white/60 px-1">{SINGLE_COMPETITION_SLUG}</code>
                  (used if the server has no default). The designated admin can set the live default from
                  the Bridge home dashboard.
                </p>
              </CardContent>
            </Card>
          ) : loadError ? (
            <Card className="border-red-200 bg-red-50/50">
              <CardHeader>
                <CardTitle className="text-red-800">Could not load {CHALLENGE_BRAND_NAME}</CardTitle>
                <CardDescription className="whitespace-pre-wrap text-red-700">
                  {loadError}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : competition ? (
            <div className="space-y-10">
              <Card
                id="join"
                className="scroll-mt-24 border-[#1e3a8a]/25 bg-white shadow-sm"
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <UserPlus className="h-6 w-6 text-[#1e3a8a]" />
                    Register
                  </CardTitle>
                  <CardDescription className="text-base">
                    We create a real candidate submission and send you to the same assessment URL
                    employers use when they share a link (no separate account — your access is your
                    link).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {notStartedYet ? (
                    <p className="text-sm font-medium text-amber-900">
                      {CHALLENGE_BRAND_NAME} hasn&apos;t started yet.
                    </p>
                  ) : !registrationAllowed ? (
                    <p className="text-sm text-amber-800">
                      Registration is not open for {CHALLENGE_BRAND_NAME} right now.
                    </p>
                  ) : (
                    <form onSubmit={handleJoin} className="max-w-md space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Display name</Label>
                        <Input
                          id="name"
                          value={candidateName}
                          onChange={(e) => setCandidateName(e.target.value)}
                          placeholder="Your name for this submission"
                          required
                          maxLength={200}
                          autoComplete="name"
                          className="h-11"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={candidateEmail}
                          onChange={(e) => setCandidateEmail(e.target.value)}
                          placeholder="you@example.com"
                          required
                          autoComplete="email"
                          className="h-11"
                        />
                      </div>
                      {joinError ? (
                        <p className="text-sm text-red-600">{joinError}</p>
                      ) : null}
                      <Button
                        type="submit"
                        disabled={joining}
                        className="h-11 w-full bg-[#1e3a8a] hover:bg-[#172554] sm:w-auto"
                      >
                        {joining ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Starting…
                          </>
                        ) : (
                          "Continue to assessment"
                        )}
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 text-center sm:flex-row sm:text-left">
          <p className="text-xs text-slate-500">
            Powered by{" "}
            <a
              href={BRIDGE_MARKETING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#1e3a8a] hover:underline"
            >
              Bridge
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
