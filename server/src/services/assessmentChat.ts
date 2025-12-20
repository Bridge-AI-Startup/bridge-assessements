import OpenAI from "openai";

// Initialize OpenAI client
let openai: OpenAI | null = null;

if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
} else {
  console.warn("⚠️  OPENAI_API_KEY not set. Assessment chat will not work.");
}

export type AssessmentContext = {
  title: string;
  description: string;
  timeLimit: number;
  scoring?: Record<string, number>;
  // Frontend-only fields (not in DB but part of assessment UI)
  rubric?: Array<{ criteria: string; weight: string }>;
  testCases?: Array<{ name: string; type: string; points: number }>;
};

export type ChatRequest = {
  message: string;
  assessmentContext: AssessmentContext;
  allowedSections?: string[]; // Which sections can be modified
};

export type ChatResponse = {
  updates: {
    description?: string;
    title?: string;
    timeLimit?: number;
    scoring?: Record<string, number>;
    rubric?: Array<{ criteria: string; weight: string }>;
    testCases?: Array<{ name: string; type: string; points: number }>;
  };
  changedSections: string[];
  changesSummary: string[];
  responseMessage: string; // Friendly message to show user
};

/**
 * Process chat message and generate assessment updates
 */
export async function processAssessmentChat(
  request: ChatRequest
): Promise<ChatResponse> {
  if (!openai) {
    throw new Error("OpenAI API key not configured");
  }

  const { message, assessmentContext, allowedSections = [] } = request;

  // Determine which sections can be modified
  const canModifyDescription =
    !allowedSections.length || allowedSections.includes("projectDescription");
  const canModifyRubric =
    !allowedSections.length || allowedSections.includes("rubric");
  const canModifyTestCases =
    !allowedSections.length || allowedSections.includes("testCases");

  const sectionRestriction =
    allowedSections.length > 0
      ? `IMPORTANT: You may ONLY modify the following sections: ${allowedSections
          .map((s) => {
            if (s === "projectDescription") return "Project Description";
            if (s === "rubric") return "Scoring & Rubric";
            if (s === "testCases") return "Test Cases";
            return s;
          })
          .join(", ")}. Do NOT change any other sections.`
      : "You may update any sections as needed.";

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are Bridge AI, an expert assistant for creating and refining technical coding assessments. 
Your role is to help users modify their assessments based on their requests.

Current Assessment:
- Title: ${assessmentContext.title}
- Description: ${assessmentContext.description}
- Time Limit: ${assessmentContext.timeLimit} minutes
- Scoring: ${JSON.stringify(assessmentContext.scoring || {})}
${
  assessmentContext.rubric
    ? `- Rubric: ${JSON.stringify(assessmentContext.rubric)}`
    : ""
}
${
  assessmentContext.testCases
    ? `- Test Cases: ${JSON.stringify(assessmentContext.testCases)}`
    : ""
}

${sectionRestriction}

Based on the user's message, generate updates to the assessment. Return a JSON object with:
{
  "updates": {
    "description": "string (if changed, use Markdown formatting)",
    "title": "string (if changed)",
    "timeLimit": number (if changed),
    "scoring": {"Category": percentage} (if changed, must sum to 100),
    "rubric": [{"criteria": "string", "weight": "string"}] (if changed),
    "testCases": [{"name": "string", "type": "unit|integration|e2e", "points": number}] (if changed)
  },
  "changedSections": ["list of section names that were changed - MUST use exact names: 'projectDescription', 'rubric', 'testCases', 'title', 'timeLimit', 'scoring'"],
  "changesSummary": ["brief bullet points of what was changed"],
  "responseMessage": "friendly message explaining what you changed"
}

CRITICAL: The "changedSections" array MUST use these exact section identifiers:
- "projectDescription" (for description changes)
- "rubric" (for rubric/scoring changes)
- "testCases" (for test case changes)
- "title" (for title changes)
- "timeLimit" (for time limit changes)
- "scoring" (for scoring category changes)

Guidelines:
- Only include fields in "updates" that actually changed
- Use Markdown formatting in description (## headers, **bold**, lists, \`code\`)
- Scoring percentages must sum to exactly 100
- Be helpful and make meaningful improvements based on the user's request`,
        },
        {
          role: "user",
          content: message,
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("No content in OpenAI response");
    }

    console.log("📥 [assessmentChat] Raw response:", content);

    const result = JSON.parse(content) as ChatResponse;

    // Validate response structure
    if (!result.updates || !result.changedSections || !result.changesSummary) {
      throw new Error("Invalid response format from OpenAI");
    }

    // Normalize section names to match frontend expectations
    const sectionNameMap: Record<string, string> = {
      description: "projectDescription",
      Description: "projectDescription",
      "Project Description": "projectDescription",
      "project description": "projectDescription",
      Rubric: "rubric",
      "Scoring & Rubric": "rubric",
      Scoring: "rubric",
      "Test Cases": "testCases",
      "test cases": "testCases",
      TestCases: "testCases",
      Title: "title",
      title: "title",
      "Time Limit": "timeLimit",
      "time limit": "timeLimit",
      TimeLimit: "timeLimit",
      "Scoring Categories": "scoring",
      scoring: "scoring",
    };

    // Normalize changed sections
    const normalizedSections = result.changedSections.map((section) => {
      return sectionNameMap[section] || section;
    });

    // Ensure projectDescription is included if description was updated
    if (
      result.updates.description &&
      !normalizedSections.includes("projectDescription")
    ) {
      normalizedSections.push("projectDescription");
    }

    result.changedSections = normalizedSections;

    // Validate scoring if provided
    if (result.updates.scoring) {
      const total = Object.values(result.updates.scoring).reduce(
        (sum, val) => sum + val,
        0
      );
      if (total !== 100) {
        // Normalize to 100
        const normalized: Record<string, number> = {};
        for (const [key, value] of Object.entries(result.updates.scoring)) {
          normalized[key] = Math.round((value / total) * 100);
        }
        const normalizedTotal = Object.values(normalized).reduce(
          (sum, val) => sum + val,
          0
        );
        if (normalizedTotal !== 100) {
          const largestKey = Object.keys(normalized).reduce((a, b) =>
            normalized[a] > normalized[b] ? a : b
          );
          normalized[largestKey] += 100 - normalizedTotal;
        }
        result.updates.scoring = normalized;
      }
    }

    console.log("✅ [assessmentChat] Processed updates:", {
      changedSections: result.changedSections,
      hasDescription: !!result.updates.description,
      hasTitle: !!result.updates.title,
      hasTimeLimit: !!result.updates.timeLimit,
      hasScoring: !!result.updates.scoring,
    });

    return result;
  } catch (error) {
    console.error("❌ [assessmentChat] Error:", error);
    throw error;
  }
}
