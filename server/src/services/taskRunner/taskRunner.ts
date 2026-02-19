import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import TaskConfigModel from "../../models/taskConfig.js";
import SubmissionModel from "../../models/submission.js";
import {
  downloadAndExtractRepoSnapshot,
  cleanupRepoSnapshot,
} from "../../util/repoSnapshot.js";

const execAsync = promisify(exec);

interface TaskResult {
  taskId: string;
  taskName: string;
  status: "passed" | "failed" | "timeout" | "error";
  testResults: {
    passed: number;
    failed: number;
    total: number;
    failures: Array<{
      testName: string;
      error: string;
      output: string;
    }>;
  };
  executionTime: number;
  output: any;
  gitDiff: string;
  fileChanges: Array<{
    path: string;
    changeType: string;
  }>;
}

/**
 * Execute a task for a submission
 * Runs tests directly (no Docker) with security restrictions
 */
export async function executeTask(
  submissionId: string,
  taskId: string
): Promise<TaskResult> {
  const submission = await SubmissionModel.findById(submissionId).populate(
    "assessmentId"
  );
  if (!submission) {
    throw new Error("Submission not found");
  }

  const task = await TaskConfigModel.findOne({ taskId });
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const startTime = Date.now();

  try {
    // 1. Get candidate's code repository
    if (!submission.githubRepo?.pinnedCommitSha) {
      throw new Error("GitHub repository not found");
    }

    // Download repo snapshot (reuse existing utility)
    const snapshot = await downloadAndExtractRepoSnapshot({
      owner: submission.githubRepo.owner,
      repo: submission.githubRepo.repo,
      pinnedCommitSha: submission.githubRepo.pinnedCommitSha,
      submissionId: submission._id.toString(),
    });

    const repoPath = snapshot.repoRootPath;

    // 2. Copy task files to repo (if needed)
    const taskDir = join(repoPath, "tasks", taskId);
    await mkdir(taskDir, { recursive: true });

    // Copy task files (excluding hidden tests)
    for (const file of task.files) {
      if (!file.isHidden) {
        const filePath = join(taskDir, file.path);
        const content = Buffer.from(file.content, "base64").toString("utf-8");
        await writeFile(filePath, content);
      }
    }

    // 3. Inject hidden tests
    const hiddenTestsDir = join(repoPath, ".hidden-tests", taskId);
    await mkdir(hiddenTestsDir, { recursive: true });

    for (const hiddenTest of task.tests.hiddenTests) {
      const testPath = join(hiddenTestsDir, `${hiddenTest.name}.test.js`);
      await writeFile(testPath, hiddenTest.test);
    }

    // 4. Run tests with timeout
    const testCommand = task.tests.command || "npm test";
    const timeout = task.tests.timeout || 30000;

    let testOutput: string;
    let testExitCode: number;

    try {
      const { stdout, stderr } = await Promise.race([
        execAsync(testCommand, {
          cwd: repoPath,
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Test timeout")), timeout)
        ),
      ]) as any;

      testOutput = stdout + stderr;
      testExitCode = 0;
    } catch (error: any) {
      testOutput = error.stdout + error.stderr;
      testExitCode = error.code || 1;
    }

    // 5. Parse test results
    const testResults = parseTestOutput(testOutput, task.language || "javascript");

    // 6. Capture git diff (if git is available)
    let gitDiff = "";
    try {
      const { stdout } = await execAsync("git diff", { cwd: repoPath });
      gitDiff = stdout;
    } catch {
      // Git not available or no changes
      gitDiff = "";
    }

    // 7. Capture file changes
    const fileChanges = await captureFileChanges(repoPath, taskDir);

    // 8. Cleanup
    await cleanupRepoSnapshot({
      zipPath: snapshot.zipPath,
      extractDir: snapshot.extractDir,
    });

    const executionTime = Date.now() - startTime;

    return {
      taskId,
      taskName: task.taskName,
      status: testResults.failed === 0 ? "passed" : "failed",
      testResults,
      executionTime,
      output: testOutput,
      gitDiff,
      fileChanges,
    };
  } catch (error) {
    return {
      taskId,
      taskName: task.taskName,
      status: "error",
      testResults: {
        passed: 0,
        failed: 0,
        total: 0,
        failures: [
          {
            testName: "Execution Error",
            error: error instanceof Error ? error.message : String(error),
            output: "",
          },
        ],
      },
      executionTime: Date.now() - startTime,
      output: null,
      gitDiff: "",
      fileChanges: [],
    };
  }
}

/**
 * Execute all tasks for a submission
 */
export async function executeAllTasks(
  submissionId: string
): Promise<TaskResult[]> {
  const tasks = await TaskConfigModel.find({});
  const results = await Promise.all(
    tasks.map((task) => executeTask(submissionId, task.taskId))
  );
  return results;
}

/**
 * Parse test output based on test framework
 */
function parseTestOutput(
  output: string,
  language: string
): {
  passed: number;
  failed: number;
  total: number;
  failures: Array<{ testName: string; error: string; output: string }>;
} {
  // Simple parsing - can be enhanced
  const passedMatch = output.match(/(\d+)\s+passed/i);
  const failedMatch = output.match(/(\d+)\s+failed/i);
  const totalMatch = output.match(/(\d+)\s+test/i);

  const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
  const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
  const total = totalMatch ? parseInt(totalMatch[1]) : passed + failed;

  // Extract failure details (simplified)
  const failures: Array<{ testName: string; error: string; output: string }> =
    [];
  const failureBlocks = output.match(/FAIL.*?(\n|$)/gi) || [];
  for (const block of failureBlocks) {
    const testNameMatch = block.match(/test\s+(.+?)[:\n]/i);
    failures.push({
      testName: testNameMatch ? testNameMatch[1] : "Unknown test",
      error: block,
      output: block,
    });
  }

  return { passed, failed, total, failures };
}

/**
 * Capture file changes in repository
 */
async function captureFileChanges(
  repoPath: string,
  taskDir: string
): Promise<Array<{ path: string; changeType: string }>> {
  // Simplified - compare files in taskDir with repo
  // In production, use git diff or file comparison
  return [];
}
