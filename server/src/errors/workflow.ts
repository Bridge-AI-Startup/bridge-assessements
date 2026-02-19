import { CustomError } from "./errors.ts";

export class WorkflowError extends CustomError {
  static TRACE_REQUIRED = new WorkflowError(
    0,
    400,
    "LLM trace is required for submission"
  );
  static INVALID_TRACE_FORMAT = new WorkflowError(
    1,
    400,
    "Invalid trace file format"
  );
  static BUDGET_EXCEEDED = new WorkflowError(
    2,
    429,
    "LLM usage budget exceeded"
  );
  static TASK_EXECUTION_FAILED = new WorkflowError(
    3,
    500,
    "Task execution failed"
  );
  static SCORING_FAILED = new WorkflowError(
    4,
    500,
    "Workflow scoring failed"
  );
}
