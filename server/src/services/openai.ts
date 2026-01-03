import {
  PROMPT_GENERATE_ASSESSMENT_COMPONENTS,
  PROMPT_GENERATE_INTERVIEW_SUMMARY,
} from "../prompts/index.js";
import {
  createChatCompletion,
  initializeLangChainAI,
  type ChatMessage,
} from "./langchainAI.js";

// Initialize LangChain AI on module load
initializeLangChainAI();

/**
 * Domain list for adding narrative variability to assessments
 * These are decorative only and must never override user instructions or job description
 */
const ASSESSMENT_DOMAINS = [
  "Music streaming website",
  "Social media platform",
  "E-commerce marketplace",
  "Fitness or health tracking app",
  "Online learning platform",
  "Travel booking or itinerary planner",
  "Food delivery or restaurant app",
  "Personal finance or budgeting tool",
  "Project or task management app",
  "Customer support or help-desk system",
  "News or content publishing site",
  "Real-time chat or messaging app",
  "Job board or recruiting platform",
  "Event management or ticketing system",
  "Inventory or asset tracking system",
  "Analytics or reporting dashboard",
  "Recommendation or discovery platform",
  "Productivity or note-taking app",
  "Media library or file management system",
  "Device or system monitoring dashboard",
];

/**
 * Generate a random seed for naming/examples (8-12 characters)
 */
function generateRandomSeed(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const length = Math.floor(Math.random() * 5) + 8; // 8-12 chars
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/**
 * Select a random domain from the list
 */
function selectRandomDomain(): string {
  return ASSESSMENT_DOMAINS[Math.floor(Math.random() * ASSESSMENT_DOMAINS.length)];
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
}> {
  console.log("🤖 [AI] Generating assessment components in single call...");

  // Select random domain and seed for this request
  const selectedDomain = selectRandomDomain();
  const seed = generateRandomSeed();
  
  console.log(`🎲 [AI] Selected domain: ${selectedDomain}, seed: ${seed}`);

  try {
    const messages: ChatMessage[] = [
        {
          role: "system",
          content: PROMPT_GENERATE_ASSESSMENT_COMPONENTS.system,
        },
        {
          role: "user",
          content:
            PROMPT_GENERATE_ASSESSMENT_COMPONENTS.userTemplate(
              jobDescription,
              selectedDomain,
              seed
            ),
        },
    ];

    const response = await createChatCompletion(
      "assessment_generation",
      messages,
      {
      temperature: 0.5,
        maxTokens: 3000, // Increased to handle full descriptions (300-650 words + JSON overhead)
        responseFormat: { type: "json_object" },
        // Use provider/model from prompt config if specified
        provider: PROMPT_GENERATE_ASSESSMENT_COMPONENTS.provider,
        model: PROMPT_GENERATE_ASSESSMENT_COMPONENTS.model,
      }
    );

    const content = response.content.trim();
    if (!content) {
      throw new Error("No content in AI response");
    }

    console.log("📥 [AI] Raw response content:", content);

    let result: {
      title?: string;
      description?: string;
      timeLimit?: number;
    };

    try {
      result = JSON.parse(content);
      console.log(
        "✅ [AI] Parsed JSON result:",
        JSON.stringify(result, null, 2)
      );
    } catch (parseError) {
      console.error("❌ [AI] JSON parse error:", parseError);
      console.error("   Content that failed to parse:", content);
      
      // Check if the response was truncated
      if (content.length > 0 && !content.trim().endsWith("}")) {
        console.warn("⚠️ [AI] Response appears to be truncated. Content length:", content.length);
        console.warn("   Last 200 chars:", content.slice(-200));
        
        // Try to fix incomplete JSON by closing it
        try {
          // Try to extract what we have and close the JSON
          const lastBrace = content.lastIndexOf("}");
          if (lastBrace === -1) {
            // No closing brace, try to add one
            const fixedContent = content.trim() + "\n}";
            result = JSON.parse(fixedContent);
            console.log("✅ [AI] Fixed truncated JSON by adding closing brace");
          } else {
            // Has closing brace but might be incomplete string
            const beforeBrace = content.substring(0, lastBrace + 1);
            // Try to fix incomplete string values
            const fixedContent = beforeBrace.replace(/"([^"]*)$/, '"$1"') + "}";
            result = JSON.parse(fixedContent);
            console.log("✅ [AI] Attempted to fix incomplete JSON");
          }
        } catch (fixError) {
          console.error("❌ [AI] Could not fix truncated JSON:", fixError);
          throw new Error("Failed to parse AI response as JSON - response appears truncated");
        }
      } else {
        throw new Error("Failed to parse AI response as JSON");
      }
    }

    // Validate and normalize the response
    const title = result.title?.trim() || "New Assessment";
    const finalTitle =
      title.length > 100 ? title.substring(0, 97) + "..." : title;

    const description = result.description?.trim();
    if (!description || description.length < 50) {
      console.warn(
        "⚠️ [AI] Invalid or missing description, using job description as fallback"
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
      };
    }

    // Extract and validate timeLimit
    let timeLimit = result.timeLimit;
    console.log(
      "🔍 [AI] Raw timeLimit from API:",
      timeLimit,
      typeof timeLimit
    );

    // Handle timeLimit - could be string, number, or missing
    if (timeLimit === undefined || timeLimit === null) {
      console.warn("⚠️ [AI] timeLimit missing from AI response, using default 60");
      timeLimit = 60;
    } else if (typeof timeLimit === "string") {
      timeLimit = parseInt(timeLimit, 10);
      if (isNaN(timeLimit)) {
        console.warn("⚠️ [AI] timeLimit string could not be parsed, using default 60");
        timeLimit = 60;
      }
    }
    
    // Validate timeLimit range
    if (!timeLimit || isNaN(timeLimit) || timeLimit < 30) {
      console.warn("⚠️ [AI] Invalid timeLimit (too low or invalid), using default 60");
      timeLimit = 60;
    }
    if (timeLimit > 480) {
      console.warn("⚠️ [AI] timeLimit too high, clamping to 240");
      timeLimit = 240;
    }

    console.log("✅ [AI] Generated components:", {
      title: finalTitle,
      descriptionLength: description.length,
      timeLimit,
    });

    return {
      title: finalTitle,
      description,
      timeLimit,
    };
  } catch (error) {
    console.error("❌ [AI] Error generating assessment components:", error);
    // Fallback to simple defaults
    console.log("🔄 [AI] Falling back to simple defaults...");
    const firstSentence = jobDescription.split(/[.!?]/)[0].trim();
    const title =
      firstSentence.length > 0 && firstSentence.length <= 100
        ? firstSentence
        : jobDescription.substring(0, 50).trim() + "...";
    return { title, description: jobDescription, timeLimit: 60 };
  }
}

/**
 * Generate interview summary from transcript
 */
export async function generateInterviewSummary(
  transcript: Array<{ role: "agent" | "candidate"; text: string }>
): Promise<string> {
  try {
    // Format transcript for LLM
    const transcriptText = transcript
      .map((turn) => {
        const speaker = turn.role === "agent" ? "Interviewer" : "Candidate";
        return `${speaker}: ${turn.text}`;
      })
      .join("\n\n");

    console.log("🤖 [AI] Generating interview summary...");

    const messages: ChatMessage[] = [
        {
          role: "system",
          content: PROMPT_GENERATE_INTERVIEW_SUMMARY.system,
        },
        {
          role: "user",
          content:
            PROMPT_GENERATE_INTERVIEW_SUMMARY.userTemplate(transcriptText),
        },
    ];

    const response = await createChatCompletion(
      "interview_summary",
      messages,
      {
      temperature: 0.5,
        maxTokens: 600, // Enough for 200-400 word summary
        // Use provider/model from prompt config if specified
        provider: PROMPT_GENERATE_INTERVIEW_SUMMARY.provider,
        model: PROMPT_GENERATE_INTERVIEW_SUMMARY.model,
      }
    );

    const summary = response.content.trim();
    if (!summary) {
      throw new Error("No content in AI response");
    }

    console.log("✅ [AI] Generated interview summary");
    return summary;
  } catch (error) {
    console.error("❌ [AI] Error generating interview summary:", error);
    // Fallback: return a simple summary
    const totalTurns = transcript.length;
    const candidateTurns = transcript.filter(
      (t) => t.role === "candidate"
    ).length;
    return `Interview completed with ${totalTurns} total turns. Candidate participated in ${candidateTurns} turns.`;
  }
}
