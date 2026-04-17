import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";
import {
  Trophy,
  Clock,
  UserPlus,
  RefreshCw,
  Loader2,
  LayoutDashboard,
  ExternalLink,
} from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getCompetition,
  getCompetitionLeaderboard,
  joinCompetition,
  CompetitionNotFoundError,
} from "@/api/competition";
import { SINGLE_COMPETITION_SLUG } from "@/config/competition";
import bridgeLogo from "@/assets/bridge-logo.svg";

const BRIDGE_MARKETING_URL = "https://bridge-jobs.com/";

function resolveCompetitionSlug(searchParams) {
  const fromQuery = searchParams.get("slug")?.trim().toLowerCase();
  const fromEnv =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_DEFAULT_COMPETITION_SLUG
      ? String(import.meta.env.VITE_DEFAULT_COMPETITION_SLUG).trim().toLowerCase()
      : "";
  return fromQuery || fromEnv || SINGLE_COMPETITION_SLUG;
}

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

export default function HackathonDashboard() {
  const [searchParams] = useSearchParams();
  const slug = resolveCompetitionSlug(searchParams);

  const [competition, setCompetition] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [missingCompetitionSlug, setMissingCompetitionSlug] = useState(null);
  const [lbError, setLbError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lbLoading, setLbLoading] = useState(false);

  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);

  const loadCompetition = useCallback(async () => {
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

  const loadLeaderboard = useCallback(async () => {
    if (!slug || !competition?.leaderboardPublic) return;
    setLbLoading(true);
    setLbError(null);
    try {
      const data = await getCompetitionLeaderboard(slug, 50);
      setLeaderboard(data);
    } catch (e) {
      setLbError(e?.message || "Failed to load leaderboard");
      setLeaderboard(null);
    } finally {
      setLbLoading(false);
    }
  }, [slug, competition?.leaderboardPublic]);

  useEffect(() => {
    loadCompetition();
  }, [loadCompetition]);

  useEffect(() => {
    if (competition?.leaderboardPublic) {
      loadLeaderboard();
    }
  }, [competition?.leaderboardPublic, loadLeaderboard]);

  useEffect(() => {
    if (!slug || !competition?.leaderboardPublic) return;
    const id = setInterval(() => loadLeaderboard(), 45000);
    return () => clearInterval(id);
  }, [slug, competition?.leaderboardPublic, loadLeaderboard]);

  const handleJoin = async (e) => {
    e.preventDefault();
    setJoinError(null);
    if (!slug) return;
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
              <p className="text-xs text-slate-500">Challenge</p>
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

      <main className="mx-auto max-w-5xl px-4 py-10 md:py-12">
        <div className="mb-10 text-center md:text-left">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
            Join the challenge
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Sign up and we&apos;ll create your candidate link and open the assessment — same flow as
            if you received an invite from an employer.
          </p>
        </div>

        <div className="space-y-10">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-10 w-10 animate-spin text-slate-400" />
            </div>
          ) : missingCompetitionSlug ? (
            <Card className="border-amber-200 bg-amber-50/80">
              <CardHeader>
                <CardTitle className="text-amber-950">Challenge not configured yet</CardTitle>
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
                  Default slug in{" "}
                  <code className="rounded bg-white/60 px-1">client/src/config/competition.js</code>{" "}
                  is <code className="rounded bg-white/60 px-1">{SINGLE_COMPETITION_SLUG}</code>.
                </p>
              </CardContent>
            </Card>
          ) : loadError ? (
            <Card className="border-red-200 bg-red-50/50">
              <CardHeader>
                <CardTitle className="text-red-800">Could not load challenge</CardTitle>
                <CardDescription className="whitespace-pre-wrap text-red-700">
                  {loadError}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : competition ? (
            <>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                  <Trophy className="h-8 w-8 shrink-0 text-amber-500" />
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-slate-900 md:text-2xl">
                      {competition.title}
                    </h2>
                    <p className="mt-2 max-w-3xl text-slate-600">{competition.description}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-slate-400" />
                    Time limit: {competition.assessment?.timeLimit ?? "—"} min
                  </span>
                  {competition.competitionStartsAt ? (
                    <span>Starts: {formatWhen(competition.competitionStartsAt)}</span>
                  ) : null}
                  {competition.competitionEndsAt ? (
                    <span>Ends: {formatWhen(competition.competitionEndsAt)}</span>
                  ) : null}
                </div>
              </motion.div>

              <Card
                id="join"
                className="scroll-mt-24 border-[#1e3a8a]/25 bg-white shadow-sm"
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <UserPlus className="h-6 w-6 text-[#1e3a8a]" />
                    Join the challenge
                  </CardTitle>
                  <CardDescription className="text-base">
                    We create a real candidate submission and send you to the same assessment URL
                    employers use when they share a link (no separate account — your access is your
                    link).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!registrationAllowed ? (
                    <p className="text-sm text-amber-800">
                      Registration is not open for this challenge right now.
                    </p>
                  ) : (
                    <form onSubmit={handleJoin} className="max-w-md space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Display name</Label>
                        <Input
                          id="name"
                          value={candidateName}
                          onChange={(e) => setCandidateName(e.target.value)}
                          placeholder="Shown on the leaderboard"
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

              {competition.rulesMarkdown ? (
                <Card className="border-slate-200 bg-white shadow-sm">
                  <CardHeader>
                    <CardTitle>Rules</CardTitle>
                  </CardHeader>
                  <CardContent className="prose prose-slate max-w-none text-sm">
                    <ReactMarkdown>{competition.rulesMarkdown}</ReactMarkdown>
                  </CardContent>
                </Card>
              ) : null}

              {competition.leaderboardPublic ? (
                <Card className="border-slate-200 bg-white shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <LayoutDashboard className="h-5 w-5 text-slate-600" />
                        Dashboard
                      </CardTitle>
                      <CardDescription>
                        Leaderboard — ranked by overall score (completeness or workflow score as
                        fallback). Auto-refreshes.
                      </CardDescription>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => loadLeaderboard()}
                      disabled={lbLoading}
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${lbLoading ? "animate-spin" : ""}`}
                      />
                      Refresh
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {lbError ? (
                      <p className="text-sm text-red-600">{lbError}</p>
                    ) : leaderboard?.entries?.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16">#</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead className="text-right">Score</TableHead>
                            <TableHead className="text-right hidden sm:table-cell">
                              Submitted
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {leaderboard.entries.map((row) => (
                            <TableRow
                              key={`${row.rank}-${row.displayName}-${row.submittedAt ?? ""}`}
                            >
                              <TableCell className="font-medium">{row.rank}</TableCell>
                              <TableCell>{row.displayName}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {row.score != null ? row.score : "—"}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground text-sm hidden sm:table-cell">
                                {formatWhen(row.submittedAt)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-slate-600">
                        No submissions yet — be the first to complete the assessment.
                      </p>
                    )}
                  </CardContent>
                </Card>
              ) : null}
            </>
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
