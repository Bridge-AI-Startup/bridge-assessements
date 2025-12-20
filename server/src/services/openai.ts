import OpenAI from "openai";

// Initialize OpenAI client
let openai: OpenAI | null = null;

if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  console.log("✅ OpenAI client initialized");
} else {
  console.warn(
    "⚠️  OPENAI_API_KEY not set in config.env. AI generation will use fallback logic."
  );
  console.warn(
    "   Add OPENAI_API_KEY=your_api_key_here to your config.env file"
  );
}

/**
 * Generate assessment title from job description
 */
export async function generateTitle(description: string): Promise<string> {
  if (!openai) {
    // Fallback to simple extraction
    const firstSentence = description.split(/[.!?]/)[0].trim();
    return firstSentence.length > 0 && firstSentence.length <= 100
      ? firstSentence
      : description.substring(0, 50).trim() + "...";
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert at creating concise, professional assessment titles for technical hiring. Generate a clear, descriptive title (max 100 characters) that captures the essence of the role or project.",
        },
        {
          role: "user",
          content: `Generate a professional assessment title based on this job description:\n\n${description}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 50,
    });

    const title =
      response.choices[0]?.message?.content?.trim() || "New Assessment";
    return title.length > 100 ? title.substring(0, 97) + "..." : title;
  } catch (error) {
    console.error("❌ [OpenAI] Error generating title:", error);
    // Fallback to simple extraction
    const firstSentence = description.split(/[.!?]/)[0].trim();
    return firstSentence.length > 0 && firstSentence.length <= 100
      ? firstSentence
      : description.substring(0, 50).trim() + "...";
  }
}

/**
 * Generate appropriate time limit (in minutes) for the assessment
 */
export async function generateTimeLimit(description: string): Promise<number> {
  if (!openai) {
    return 60; // Default fallback
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert at estimating appropriate time limits for technical assessments. Based on the complexity and scope of the project, suggest a reasonable time limit in minutes. Consider:\n- Simple tasks: 30-60 minutes\n- Medium complexity: 60-120 minutes\n- Complex projects: 120-240 minutes\n\nReturn only a number (the time in minutes).",
        },
        {
          role: "user",
          content: `Estimate an appropriate time limit (in minutes) for this assessment:\n\n${description}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 10,
    });

    const timeLimitStr = response.choices[0]?.message?.content?.trim();
    const timeLimit = parseInt(timeLimitStr || "60", 10);

    // Validate and clamp to reasonable range
    if (isNaN(timeLimit) || timeLimit < 30) return 60;
    if (timeLimit > 480) return 240; // Max 8 hours
    return timeLimit;
  } catch (error) {
    console.error("❌ [OpenAI] Error generating time limit:", error);
    return 60; // Default fallback
  }
}

/**
 * Generate scoring categories and weights based on job description
 */
// Fallback scoring used when OpenAI is unavailable
const FALLBACK_SCORING = {
  "Code Quality": 30,
  Functionality: 25,
  Architecture: 20,
  Testing: 15,
  Documentation: 10,
};

export async function generateScoring(
  description: string
): Promise<Record<string, number>> {
  if (!openai) {
    return FALLBACK_SCORING;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert at creating fair, comprehensive scoring rubrics for technical assessments. 
Generate 4-6 scoring categories with percentage weights that total 100%. 

Consider these common categories:
- Code Quality (clean code, best practices, readability)
- Functionality (does it work, meets requirements)
- Architecture/Design (system design, scalability, maintainability)
- Testing (test coverage, test quality)
- Documentation (code comments, README, API docs)
- Performance (efficiency, optimization)
- Security (vulnerabilities, best practices)

Return a JSON object with category names as keys and percentages (0-100) as values. 
The percentages must sum to exactly 100. Format: {"Category Name": percentage}`,
        },
        {
          role: "user",
          content: `Generate appropriate scoring categories and weights for this assessment:\n\n${description}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("No content in OpenAI response");
    }

    const scoring = JSON.parse(content) as Record<string, number>;

    // Validate and normalize percentages
    const total = Object.values(scoring).reduce((sum, val) => sum + val, 0);
    if (total === 0) {
      return FALLBACK_SCORING;
    }

    // Normalize to sum to 100
    const normalized: Record<string, number> = {};
    for (const [key, value] of Object.entries(scoring)) {
      normalized[key] = Math.round((value / total) * 100);
    }

    // Ensure it sums to exactly 100 (adjust the largest category if needed)
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

    return normalized;
  } catch (error) {
    console.error("❌ [OpenAI] Error generating scoring:", error);
    return FALLBACK_SCORING;
  }
}

/**
 * Generate all assessment components in a single API call
 * This is more cost-effective and produces more coherent results
 */
export async function generateAssessmentComponents(
  jobDescription: string
): Promise<{
  title: string;
  description: string;
  timeLimit: number;
  scoring: Record<string, number>;
}> {
  console.log("🤖 [OpenAI] Generating assessment components in single call...");

  if (!openai) {
    // Fallback to individual functions if OpenAI is not available
    console.log("⚠️  OpenAI not available, using fallback logic");
    const [title, timeLimit, scoring] = await Promise.all([
      generateTitle(jobDescription),
      generateTimeLimit(jobDescription),
      generateScoring(jobDescription),
    ]);
    // Use job description as fallback description
    return { title, description: jobDescription, timeLimit, scoring };
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert at creating comprehensive coding assessments and take-home projects for technical hiring. 
Your goal is to create realistic, practical coding projects that replace platforms like HackerRank and LeetCode.

Based on a job description, you must generate a complete coding assessment that includes:
1. A project description that candidates will implement
2. A title for the assessment
3. An appropriate time limit
4. A scoring rubric

CRITICAL: You MUST return a valid JSON object with ALL four required fields:
{
  "title": "string (max 100 characters, concise and professional)",
  "description": "string (detailed project description, 200-500 words)",
  "timeLimit": number (time in minutes, must be between 30 and 480),
  "scoring": {
    "Category Name": number (percentage 0-100)
  }
}

REQUIREMENTS:
1. Title: Create a clear, professional title that captures the essence of the assessment (max 100 chars)
   Example: "REST API for Task Management System" or "Full-Stack E-Commerce Application"

2. Description: Create a detailed, realistic project description that candidates will implement. This should be:
   - A practical, real-world coding project (not algorithmic puzzles)
   - Clear about what needs to be built
   - Includes specific requirements and features
   - Mentions technologies/frameworks relevant to the role
   - Similar to what they'd build on the job
   - 200-500 words in length
   - Written as instructions for the candidate
   - Use Markdown formatting for better readability:
     * Use ## for section headers (e.g., ## Requirements, ## Technical Stack)
     * Use **bold** for important terms and technologies
     * Use - or * for bullet lists
     * Use backticks (backtick character) for code snippets, file names, or technical terms
     * Use numbered lists (1., 2., 3.) for step-by-step instructions
   
   Example format:
   "## Overview\\n\\nBuild a REST API for a task management system. This project tests practical backend skills in a realistic scenario.\\n\\n## Requirements\\n\\n- User registration and login\\n- Task CRUD operations\\n- Task assignment to users\\n- Basic authorization\\n\\n## Technical Stack\\n\\nUse **Node.js** with **Express** and **PostgreSQL**."

3. Time Limit: MUST be a number (not a string) between 30-480 minutes. Estimate based on project complexity:
   - Simple projects: 60-120 minutes
   - Medium complexity: 120-240 minutes  
   - Complex projects: 240-360 minutes
   - Very complex: 360-480 minutes

4. Scoring: MUST be an object with 4-6 categories. Each value must be a number (percentage).
   The percentages MUST sum to exactly 100.
   Consider these categories based on the role:
   - Code Quality (clean code, best practices, readability)
   - Functionality (does it work, meets requirements)
   - Architecture/Design (system design, scalability, maintainability)
   - Testing (test coverage, test quality)
   - Documentation (code comments, README, API docs)
   - Performance (efficiency, optimization)
   - Security (vulnerabilities, best practices)
   - Problem Solving (algorithm efficiency, approach)
   
   Choose 4-6 categories most relevant to the role. All percentages must be numbers that sum to exactly 100.

EXAMPLE OUTPUT:
{
  "title": "REST API for Task Management System",
  "description": "## Overview\n\nBuild a REST API for a task management system. This project tests practical backend skills in a realistic scenario.\n\n## Requirements\n\n- User registration and login with JWT authentication\n- Task CRUD operations (create, read, update, delete)\n- Task assignment to users\n- Basic authorization (users can only modify their own tasks)\n\n## Technical Stack\n\nUse **Node.js** with **Express** and **PostgreSQL**. Implement proper error handling and validation.\n\n## Deliverables\n\n1. Working API with all endpoints\n2. Database schema and migrations\n3. Basic tests for core functionality\n4. README with setup instructions",
  "timeLimit": 120,
  "scoring": {
    "Code Quality": 30,
    "Functionality": 25,
    "Architecture": 20,
    "Testing": 15,
    "Documentation": 10
  }
}`,
        },
        {
          role: "user",
          content: `Create a complete coding assessment project based on this job description:\n\n${jobDescription}\n\nGenerate a realistic, practical coding project that candidates can implement to demonstrate their skills.`,
        },
      ],
      temperature: 0.5,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("No content in OpenAI response");
    }

    console.log("📥 [OpenAI] Raw response content:", content);

    let result: {
      title?: string;
      description?: string;
      timeLimit?: number;
      scoring?: Record<string, number>;
    };

    try {
      result = JSON.parse(content);
      console.log(
        "✅ [OpenAI] Parsed JSON result:",
        JSON.stringify(result, null, 2)
      );
    } catch (parseError) {
      console.error("❌ [OpenAI] JSON parse error:", parseError);
      console.error("   Content that failed to parse:", content);
      throw new Error("Failed to parse OpenAI response as JSON");
    }

    // Validate and normalize the response
    const title = result.title?.trim() || "New Assessment";
    const finalTitle =
      title.length > 100 ? title.substring(0, 97) + "..." : title;

    const description = result.description?.trim();
    if (!description || description.length < 50) {
      console.warn(
        "⚠️ [OpenAI] Invalid or missing description, using job description as fallback"
      );
      // Fallback: use a basic description based on job description
      const fallbackDescription = `Build a practical coding project based on: ${jobDescription.substring(
        0,
        200
      )}. This assessment will evaluate your ability to implement real-world features and solve practical problems.`;
      return {
        title: finalTitle,
        description: fallbackDescription,
        timeLimit: 60,
        scoring: FALLBACK_SCORING,
      };
    }

    let timeLimit = result.timeLimit;
    console.log(
      "🔍 [OpenAI] Raw timeLimit from API:",
      timeLimit,
      typeof timeLimit
    );

    // Handle timeLimit - could be string or number
    if (typeof timeLimit === "string") {
      timeLimit = parseInt(timeLimit, 10);
    }
    if (!timeLimit || isNaN(timeLimit) || timeLimit < 30) {
      console.warn("⚠️ [OpenAI] Invalid timeLimit, using default 60");
      timeLimit = 60;
    }
    if (timeLimit > 480) {
      console.warn("⚠️ [OpenAI] timeLimit too high, clamping to 240");
      timeLimit = 240;
    }

    let scoring = result.scoring;
    console.log("🔍 [OpenAI] Raw scoring from API:", scoring);

    if (
      !scoring ||
      typeof scoring !== "object" ||
      Object.keys(scoring).length === 0
    ) {
      console.warn("⚠️ [OpenAI] Invalid or missing scoring, using fallback");
      scoring = FALLBACK_SCORING;
    }

    // Validate and normalize scoring percentages
    const total = Object.values(scoring).reduce((sum, val) => sum + val, 0);
    if (total === 0 || !scoring || Object.keys(scoring).length === 0) {
      scoring = FALLBACK_SCORING;
    } else {
      // Normalize to sum to 100
      const normalized: Record<string, number> = {};
      for (const [key, value] of Object.entries(scoring)) {
        normalized[key] = Math.round((value / total) * 100);
      }

      // Ensure it sums to exactly 100 (adjust the largest category if needed)
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
      scoring = normalized;
    }

    console.log("✅ [OpenAI] Generated components:", {
      title: finalTitle,
      descriptionLength: description.length,
      timeLimit,
      scoringKeys: Object.keys(scoring),
    });

    return {
      title: finalTitle,
      description,
      timeLimit,
      scoring,
    };
  } catch (error) {
    console.error("❌ [OpenAI] Error generating assessment components:", error);
    // Fallback to individual functions
    console.log(
      "🔄 [OpenAI] Falling back to individual generation functions..."
    );
    const [title, timeLimit, scoring] = await Promise.all([
      generateTitle(jobDescription),
      generateTimeLimit(jobDescription),
      generateScoring(jobDescription),
    ]);
    // Use job description as fallback description
    return { title, description: jobDescription, timeLimit, scoring };
  }
}
