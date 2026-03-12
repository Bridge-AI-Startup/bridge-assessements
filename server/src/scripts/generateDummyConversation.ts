/**
 * Generate a dummy markdown conversation (~1 hour) that plausibly "helped build" the app
 * in the submission's GitHub repo. Parses the repo (README, package.json) to tailor the conversation.
 *
 * Usage (from server directory):
 *   npx tsx src/scripts/generateDummyConversation.ts <submissionId> [outputPath]
 *   npx tsx src/scripts/generateDummyConversation.ts --assessment <assessmentId> --candidate "Austin" [outputPath]
 *
 * Output: Markdown file with ## User / ## Assistant turns and a metadata block
 * (total_tokens, total_cost, total_time_seconds) for use with replaceTraceWithMarkdown or upload.
 *
 * Env: Ensure config.env (or ATLAS_URI) is loaded. GitHub repo must be public.
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import SubmissionModel from "../models/submission.js";
import connectMongoose from "../db/mongooseConnection.js";
import {
  downloadAndExtractRepoSnapshot,
  cleanupRepoSnapshot,
} from "../utils/repoSnapshot.js";

const TOTAL_TIME_SECONDS = 3600; // 1 hour
const TOTAL_TOKENS = 82000;
const TOTAL_COST = 0.42;

function inferAppInfo(
  packageJson: Record<string, unknown> | null,
  readmeText: string
): { appName: string; description: string; tech: string[] } {
  const name =
    (packageJson?.name as string) ||
    readmeText?.match(/#\s+(.+)/)?.[1]?.trim() ||
    "the app";
  const description =
    (packageJson?.description as string) ||
    readmeText?.slice(0, 200).replace(/\s+/g, " ").trim() ||
    "web application";
  const deps = (packageJson?.dependencies as Record<string, string>) || {};
  const devDeps = (packageJson?.devDependencies as Record<string, string>) || {};
  const tech: string[] = [];
  if (deps.react || deps["react-dom"]) tech.push("React");
  if (deps.express) tech.push("Express");
  if (deps.vue) tech.push("Vue");
  if (deps.next) tech.push("Next.js");
  if (Object.keys(deps).some((k) => k.includes("mongoose") || k === "mongodb"))
    tech.push("MongoDB");
  if (deps.typescript || devDeps.typescript) tech.push("TypeScript");
  if (deps.tailwindcss || (deps as any)["tailwindcss"]) tech.push("Tailwind");
  if (tech.length === 0) tech.push("JavaScript", "Node");
  return {
    appName: typeof name === "string" ? name : "app",
    description: typeof description === "string" ? description : "web app",
    tech,
  };
}

function buildDummyConversation(appName: string, description: string, tech: string[]): string {
  const techStr = tech.join(" / ");
  const turns: { user: string; assistant: string }[] = [
    {
      user: `I want to build ${appName}. Can you help me set up the project with ${techStr}?`,
      assistant: `Sure. Create a new project with \`npm init -y\`, then install the main dependencies (e.g. ${tech.slice(0, 3).join(", ")}). Add a \`src\` folder and an entry point. I can give you exact commands and file contents next.`,
    },
    {
      user: "Give me the exact npm install commands and a basic folder structure.",
      assistant: `Run: \`npm install ${tech.filter((t) => t !== "TypeScript").join(" ")}\`. Create \`src/index.js\` (or \`src/main.tsx\` if using React/TS), \`public/index.html\` if needed, and a \`package.json\` script \`"start": "node src/index.js"\` or the appropriate dev server. Want me to paste a minimal \`src/index.js\` and \`package.json\`?`,
    },
    {
      user: "Yes, paste a minimal working setup.",
      assistant: `Here's a minimal setup. \`package.json\`: \`"main": "src/index.js", "scripts": { "start": "node src/index.js" }\`. \`src/index.js\`: \`console.log('Hello');\` and optionally a simple HTTP server with the framework you chose. Run \`npm start\` to verify.`,
    },
    {
      user: "Now I need a landing page with a header and a CTA button.",
      assistant: `Add a component (or HTML file) with a semantic \`<header>\`, a title, and a \`<button>\` or \`<a>\` for the CTA. Style with CSS or Tailwind. For React: create \`Landing.jsx\`, export it, and render it in your root. I can write the exact JSX/HTML if you tell me the button text and link.`,
    },
    {
      user: "Button should say 'Get started' and link to /signup.",
      assistant: `Use \`<a href="/signup" className="...">Get started</a>\` or \`<Link to="/signup">Get started</Link>\` if using React Router. Add the route for \`/signup\` in your router config so the link works.`,
    },
    {
      user: "I'm getting a 404 on /signup. I have a Signup component.",
      assistant: `Ensure your router has a route for \`/signup\` that renders the Signup component (e.g. \`<Route path="/signup" element={<Signup />} />\`). If you're not using a SPA router, the server must serve the signup page for that path. Check that the route is mounted and the path matches exactly.`,
    },
    {
      user: "Can we add form validation for the signup form?",
      assistant: `Add client-side validation: required fields, email format, password length. You can use native HTML5 (\`required\`, \`type="email"\`, \`pattern\`) or a library (e.g. react-hook-form, zod). Show inline error messages and disable submit until valid. Optionally add server-side validation too.`,
    },
    {
      user: "Let's add a simple API route that saves the user to the DB.",
      assistant: `Create a POST route (e.g. \`/api/signup\`) that reads the body, validates input, hashes the password (e.g. bcrypt), and inserts a document into your DB (e.g. MongoDB). Return 201 with user id or 400 for validation errors. Use environment variables for the DB connection string.`,
    },
    {
      user: "What's the best way to store the DB connection?",
      assistant: `Use a single module that reads \`process.env.MONGODB_URI\` (or similar) and exports a connected client or mongoose connection. Create the connection once at startup and reuse it in routes. Never commit the URI; use \`.env\` and add it to \`.gitignore\`.`,
    },
    {
      user: "I want to add a dashboard page that shows after login.",
      assistant: `Add a protected route that checks for a logged-in user (e.g. JWT in cookie or header). If not authenticated, redirect to login. Render the dashboard component with a layout (sidebar, header) and placeholder content. We can add real data fetching next.`,
    },
    {
      user: "How do I fetch the current user's profile on the dashboard?",
      assistant: `From the frontend, send a request to e.g. \`GET /api/me\` with the auth token (cookie or Authorization header). The server validates the token and returns the user document (excluding password). Store in state or React Query and render in the dashboard.`,
    },
    {
      user: "Can we add error handling so failed requests show a toast?",
      assistant: `Use a toast library (e.g. react-hot-toast) or a simple context that holds error messages. In your API client or fetch wrapper, on non-ok response set the error and trigger the toast. Clear the toast after a few seconds or on dismiss.`,
    },
    {
      user: "Let's add a logout button that clears the session.",
      assistant: `On the client, clear the auth token (remove cookie or localStorage) and redirect to the login page. Optionally call a \`POST /api/logout\` that invalidates the server-side session if you use one. Reset any user state in your app.`,
    },
    {
      user: "I'd like to run the app in Docker for local dev.",
      assistant: `Create a \`Dockerfile\` that copies the app, runs \`npm install\`, and \`npm start\` (or \`npm run build\` and serve). Use a \`.dockerignore\` to exclude \`node_modules\`. For full stack, use docker-compose with a service for the app and one for the DB, with the app depending on the DB.`,
    },
    {
      user: "Should we add tests?",
      assistant: `Yes. Add a test runner (Jest or Vitest) and write unit tests for utilities and API handlers (e.g. supertest for HTTP). For the frontend, consider React Testing Library. Aim for critical paths: auth, signup, and one main feature. Run tests in CI.`,
    },
    {
      user: "One more thing: add a README with setup and run instructions.",
      assistant: `In the README include: project name, short description, prerequisites (Node version), \`npm install\`, how to set \`.env\` (list vars without values), \`npm start\` and \`npm test\`. Optionally add a screenshot and link to the live app.`,
    },
  ];

  let md = "";
  for (const t of turns) {
    md += `## User\n${t.user}\n\n## Assistant\n${t.assistant}\n\n`;
  }
  md += `---\ntotal_tokens: ${TOTAL_TOKENS}\ntotal_cost: ${TOTAL_COST}\ntotal_time_seconds: ${TOTAL_TIME_SECONDS}\n---\n`;
  return md;
}

async function main() {
  let submissionId = process.argv[2];
  let outputPath = process.argv[3];
  let assessmentId: string | null = null;
  let candidateName: string | null = null;

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--assessment" && args[i + 1]) {
      assessmentId = args[i + 1];
      i++;
    } else if (args[i] === "--candidate" && args[i + 1]) {
      candidateName = args[i + 1];
      i++;
    } else if (!args[i].startsWith("--") && !submissionId) {
      submissionId = args[i];
    } else if (!args[i].startsWith("--") && submissionId && !outputPath) {
      outputPath = args[i];
    }
  }

  if (assessmentId && candidateName) {
    // resolve by assessment + candidate
    await connectMongoose();
    const sub = await SubmissionModel.findOne({
      assessmentId,
      candidateName: new RegExp(candidateName, "i"),
      status: "submitted",
    })
      .sort({ submittedAt: -1 })
      .lean();
    if (!sub) {
      console.error("No submitted submission found for that assessment and candidate.");
      process.exit(1);
    }
    submissionId = (sub as any)._id.toString();
    if (!outputPath) outputPath = `dummy_conversation_${submissionId}.md`;
  } else if (!submissionId) {
    console.error(
      "Usage: npx tsx src/scripts/generateDummyConversation.ts <submissionId> [outputPath]\n  or: npx tsx src/scripts/generateDummyConversation.ts --assessment <id> --candidate \"Austin\" [outputPath]"
    );
    process.exit(1);
  }

  if (!outputPath) outputPath = `dummy_conversation_${submissionId}.md`;

  try {
    if (!mongoose.connection.readyState) await connectMongoose();

    const submission = await SubmissionModel.findById(submissionId).lean();
    if (!submission) {
      console.error("Submission not found:", submissionId);
      process.exit(1);
    }

    const gr = (submission as any).githubRepo;
    if (!gr?.owner || !gr?.repo || !gr?.pinnedCommitSha) {
      console.error("Submission has no GitHub repo (owner/repo/pinnedCommitSha).");
      process.exit(1);
    }

    console.log("Downloading repo:", gr.owner, gr.repo, gr.pinnedCommitSha.substring(0, 7));
    const snapshot = await downloadAndExtractRepoSnapshot({
      owner: gr.owner,
      repo: gr.repo,
      pinnedCommitSha: gr.pinnedCommitSha,
      submissionId,
    });

    let packageJson: Record<string, unknown> | null = null;
    let readmeText = "";
    try {
      const pkgPath = join(snapshot.repoRootPath, "package.json");
      packageJson = JSON.parse(await readFile(pkgPath, "utf-8"));
    } catch {
      // no package.json
    }
    try {
      readmeText = await readFile(join(snapshot.repoRootPath, "README.md"), "utf-8");
    } catch {
      try {
        readmeText = await readFile(join(snapshot.repoRootPath, "readme.md"), "utf-8");
      } catch {
        // no readme
      }
    }

    await cleanupRepoSnapshot({ zipPath: snapshot.zipPath, extractDir: snapshot.extractDir });

    const { appName, description, tech } = inferAppInfo(packageJson, readmeText);
    console.log("Inferred app:", appName, "|", description.slice(0, 50) + "...", "|", tech.join(", "));

    const markdown = buildDummyConversation(appName, description, tech);
    const outAbsolute = join(process.cwd(), outputPath);
    await writeFile(outAbsolute, markdown, "utf-8");
    console.log("Wrote dummy conversation to:", outAbsolute);
    console.log("Validate the file, then run: npx tsx src/scripts/replaceTraceWithMarkdown.ts", submissionId, outputPath);
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
