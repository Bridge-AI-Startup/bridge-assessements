import AssessmentModel from "../models/assessment.js";
import TaskConfigModel from "../models/taskConfig.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

/**
 * Generate assessment package for candidate download
 * Creates a zip file with:
 * - Task files
 * - Test harness
 * - LLM proxy SDK wrapper
 * - README with instructions
 */
export async function generateAssessmentPackage(
  assessmentId: string,
  submissionId: string
): Promise<{
  packagePath: string;
  packageUrl: string;
}> {
  const assessment = await AssessmentModel.findById(assessmentId);
  if (!assessment) {
    throw new Error("Assessment not found");
  }

  // Get tasks for this assessment (for now, use default tasks)
  // In future, tasks can be assigned per assessment
  const tasks = await TaskConfigModel.find({}); // Get all tasks for now

  // Create temp directory
  const packageDir = join(process.cwd(), "temp", `package-${submissionId}`);
  await mkdir(packageDir, { recursive: true });

  // Create package structure
  // 1. Tasks directory
  const tasksDir = join(packageDir, "tasks");
  await mkdir(tasksDir, { recursive: true });

  // 2. Copy task files
  for (const task of tasks) {
    const taskDir = join(tasksDir, task.taskId);
    await mkdir(taskDir, { recursive: true });

    for (const file of task.files) {
      if (!file.isHidden) {
        // Don't include hidden test files
        const filePath = join(taskDir, file.path);
        const content = Buffer.from(file.content, "base64").toString("utf-8");
        await writeFile(filePath, content);
      }
    }
  }

  // 3. Create LLM SDK wrapper file
  const sdkContent = `// LLM Proxy SDK
// Use this instead of direct OpenAI/Anthropic clients

const API_BASE_URL = "${process.env.APP_URL || "http://localhost:5173"}/api";

class LLMClient {
  constructor(sessionId, submissionId) {
    this.sessionId = sessionId;
    this.submissionId = submissionId;
  }

  async chat(messages, options = {}) {
    const response = await fetch(\`\${API_BASE_URL}/llm-proxy/chat\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: this.sessionId,
        submissionId: this.submissionId,
        model: options.model,
        provider: options.provider || "openai",
        messages,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "LLM call failed");
    }

    return await response.json();
  }
}

module.exports = { LLMClient };
`;

  await writeFile(join(packageDir, "llm-client.js"), sdkContent);

  // 4. Create README
  const readmeContent = `# Assessment Package

## Instructions

1. Work on tasks in the \`tasks/\` directory
2. Use \`llm-client.js\` for all LLM calls (required)
3. Run tests: \`npm test\` or \`pytest\`
4. Export your LLM trace when done (see below)

## Using the LLM Client

\`\`\`javascript
const { LLMClient } = require("./llm-client");

const sessionId = "your-session-id"; // Get from assessment page
const submissionId = "${submissionId}";
const llm = new LLMClient(sessionId, submissionId);

// Make LLM calls
const response = await llm.chat([
  { role: "user", content: "Write a function to..." }
]);
\`\`\`

## Exporting LLM Trace

After completing your work, export the trace:
- The trace is automatically logged via the proxy
- Download trace.json from the assessment page
- Upload it when submitting

## Tasks

${tasks.map((t) => `- ${t.taskName}: ${t.description}`).join("\n")}
`;

  await writeFile(join(packageDir, "README.md"), readmeContent);

  // 5. Create package.json for Node.js tasks
  const packageJson = {
    name: "assessment-package",
    version: "1.0.0",
    scripts: {
      test: "echo 'Run tests for your tasks'",
    },
  };
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // 6. Zip the package (use archiver or similar)
  // For now, return directory path (implement zipping later)

  return {
    packagePath: packageDir,
    packageUrl: `/api/submissions/${submissionId}/package`, // Endpoint to download
  };
}
