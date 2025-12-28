import { useState, useMemo, useRef, useEffect } from "react";
import { useConversation } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import { Loader2, Phone, PhoneOff } from "lucide-react";
import { get } from "@/api/requests";

/**
 * ElevenLabs Voice Interview Client Component
 *
 * Manages voice interview sessions using ElevenLabs Agents Platform.
 * Fetches the interview prompt from backend and passes it as a conversation override.
 */
export default function ElevenLabsInterviewClient({ submissionId, userId }) {
  // Local UI state
  const [prompt, setPrompt] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [connectionLog, setConnectionLog] = useState([]);

  // Get agent ID from environment variable
  const agentId = import.meta.env.VITE_ELEVENLABS_AGENT_ID;

  // Memoize overrides to ensure they update when prompt changes
  // Important: Overrides must be enabled in ElevenLabs agent Security settings
  const overrides = useMemo(() => {
    if (!prompt) {
      console.log(
        "⚠️ [ElevenLabs] Overrides are undefined - prompt is not set yet"
      );
      return undefined;
    }

    const overrideObj = {
      agent: {
        prompt: {
          prompt: prompt,
        },
        firstMessage:
          "Hey — I'm going to ask you a few questions about your submission. Ready?",
      },
    };

    console.log("✅ [ElevenLabs] Overrides computed:", {
      hasPrompt: !!prompt,
      promptLength: prompt.length,
      firstMessage: overrideObj.agent.firstMessage,
      overrideStructure: overrideObj,
    });

    return overrideObj;
  }, [prompt]);

  // Use a ref to track current overrides for use in async handlers
  const overridesRef = useRef(overrides);
  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);

  // Initialize ElevenLabs conversation hook with memoized overrides
  // Key the hook by prompt to force re-initialization when prompt changes
  // This ensures overrides are applied when the prompt is set
  const conversation = useConversation({
    overrides: overrides,
    // Note: The hook should be reactive, but using a key pattern ensures it re-initializes
    // Callbacks
    onConnect: () => {
      setConnectionLog((prev) => [...prev, "✅ Connected to ElevenLabs"]);
      setError(null);
    },
    onDisconnect: () => {
      setConnectionLog((prev) => [...prev, "❌ Disconnected from ElevenLabs"]);
      setConversationId(null);
    },
    onError: (err) => {
      console.error("ElevenLabs error:", err);
      setError(err.message || "An error occurred with the voice interview");
      setConnectionLog((prev) => [
        ...prev,
        `❌ Error: ${err.message || "Unknown error"}`,
      ]);
    },
    onMessage: (message) => {
      // Optional: log messages for debugging
      if (message.type === "transcript" || message.type === "llm_response") {
        setConnectionLog((prev) => [
          ...prev,
          `💬 ${message.type}: ${message.text || message.content || ""}`,
        ]);
      }
    },
  });

  // Start button handler
  const handleStartInterview = async () => {
    setError(null);
    setLoading(true);
    setConnectionLog([]);

    try {
      // Check if agent ID is configured
      if (!agentId) {
        setError("Missing VITE_ELEVENLABS_AGENT_ID environment variable");
        setLoading(false);
        return;
      }

      // Step 1: Fetch prompt from backend
      setConnectionLog((prev) => [...prev, "📡 Fetching interview prompt..."]);

      let fetchedPrompt = null;
      try {
        const response = await get(
          `/submissions/${submissionId}/interview-agent-prompt`
        );
        const data = await response.json();
        fetchedPrompt = data.prompt;
        setConnectionLog((prev) => [
          ...prev,
          `✅ Prompt loaded (${data.questionCount} questions)`,
        ]);
      } catch (fetchError) {
        // Handle API errors - assertOk throws errors with status codes
        let errorMessage = "Failed to fetch interview prompt";

        if (fetchError.message) {
          // Try to extract status code and error message
          if (fetchError.message.includes("409")) {
            errorMessage = "Generate interview questions first";
          } else if (fetchError.message.includes("404")) {
            errorMessage = "Submission not found";
          } else {
            // Try to parse JSON error from the message
            try {
              const jsonMatch = fetchError.message.match(/\{.*\}/);
              if (jsonMatch) {
                const errorData = JSON.parse(jsonMatch[0]);
                errorMessage = errorData.error || errorMessage;
              } else {
                errorMessage = fetchError.message;
              }
            } catch {
              errorMessage = fetchError.message;
            }
          }
        }

        setError(errorMessage);
        setConnectionLog((prev) => [...prev, `❌ ${errorMessage}`]);
        setLoading(false);
        return;
      }

      // Step 2: Request microphone permission
      setConnectionLog((prev) => [
        ...prev,
        "🎤 Requesting microphone permission...",
      ]);
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        setConnectionLog((prev) => [
          ...prev,
          "✅ Microphone permission granted",
        ]);
      } catch {
        setError(
          "Microphone permission denied. Please allow microphone access to start the interview."
        );
        setLoading(false);
        return;
      }

      // Step 3: Ensure prompt is set and wait for React to update
      if (!fetchedPrompt) {
        setError("Failed to load interview prompt");
        setLoading(false);
        return;
      }

      // Set the prompt in state - this will trigger useMemo to update overrides
      setPrompt(fetchedPrompt);
      setConnectionLog((prev) => [
        ...prev,
        `📝 Prompt set in state (${fetchedPrompt.length} characters)`,
      ]);

      // Wait for React to update state and useMemo to re-compute overrides
      // We need multiple render cycles to ensure the hook picks up the new overrides
      let attempts = 0;
      let currentOverrides = null;
      while (attempts < 10 && !currentOverrides) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        currentOverrides = overridesRef.current;
        attempts++;
      }

      const expectedOverrides = {
        agent: {
          prompt: { prompt: fetchedPrompt },
          firstMessage:
            "Hey — I'm going to ask you a few questions about your submission. Ready?",
        },
      };

      console.log("🔍 [ElevenLabs] Starting session - Overrides check:", {
        promptInState: prompt
          ? `${prompt.substring(0, 50)}... (${prompt.length} chars)`
          : "null",
        fetchedPromptLength: fetchedPrompt.length,
        hasOverridesFromMemo: !!currentOverrides,
        hasOverridesFromRef: !!overridesRef.current,
        overridesFirstMessage:
          currentOverrides?.agent?.firstMessage || "NOT SET",
        expectedFirstMessage: expectedOverrides.agent.firstMessage,
        overridesStructure: currentOverrides || "UNDEFINED",
        promptMatches: prompt === fetchedPrompt ? "YES" : "NO - MISMATCH!",
        attempts: attempts,
      });

      if (!currentOverrides) {
        console.error(
          "❌ [ElevenLabs] CRITICAL: Overrides are undefined when starting session!"
        );
        console.error(
          "   This means the prompt state update didn't trigger useMemo properly."
        );
        console.error("   Current prompt state:", prompt);
        console.error("   Fetched prompt length:", fetchedPrompt.length);
        console.error("   Overrides ref value:", overridesRef.current);
        setError(
          "Failed to load overrides. Please check that System prompt override is enabled in ElevenLabs agent settings."
        );
        setLoading(false);
        return;
      }

      setConnectionLog((prev) => [...prev, "🚀 Starting voice session..."]);
      setConnectionLog((prev) => [
        ...prev,
        "✅ Overrides active - custom prompt and first message will be used",
      ]);

      const id = await conversation.startSession({
        agentId: agentId,
        connectionType: "webrtc",
        userId: userId || undefined,
        dynamicVariables: {
          submissionId: submissionId,
        },
      });

      setConversationId(id);
      setConnectionLog((prev) => [...prev, `✅ Session started (ID: ${id})`]);
    } catch (err) {
      console.error("Failed to start interview:", err);
      setError(err.message || "Failed to start voice interview");
      setConnectionLog((prev) => [
        ...prev,
        `❌ Failed: ${err.message || "Unknown error"}`,
      ]);
    } finally {
      setLoading(false);
    }
  };

  // End button handler
  const handleEndInterview = async () => {
    try {
      setConnectionLog((prev) => [...prev, "🛑 Ending session..."]);
      await conversation.endSession();
      setConnectionLog((prev) => [...prev, "✅ Session ended"]);
      // Keep prompt in state for potential restart
    } catch (err) {
      console.error("Failed to end interview:", err);
      setError(err.message || "Failed to end voice interview");
    }
  };

  const isConnected = conversation.status === "connected";

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-white rounded-xl border border-gray-200 shadow-sm">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">
        Voice Interview (ElevenLabs)
      </h2>

      {/* Agent ID Check */}
      {!agentId && (
        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          ⚠️ Missing VITE_ELEVENLABS_AGENT_ID environment variable
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Status Display */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Status:</span>
          <span
            className={`px-2 py-1 rounded ${
              isConnected
                ? "bg-green-100 text-green-800"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            {conversation.status || "disconnected"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Agent speaking:</span>
          <span
            className={`px-2 py-1 rounded ${
              conversation.isSpeaking
                ? "bg-blue-100 text-blue-800"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            {conversation.isSpeaking ? "yes" : "no"}
          </span>
        </div>
        {conversationId && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="font-medium">Conversation ID:</span>
            <span className="font-mono text-xs">{conversationId}</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 mb-4">
        <Button
          onClick={handleStartInterview}
          disabled={loading || isConnected || !agentId}
          className="flex-1 bg-[#1E3A8A] hover:bg-[#152a66] text-white"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Phone className="w-4 h-4 mr-2" />
              Start Voice Interview
            </>
          )}
        </Button>
        <Button
          onClick={handleEndInterview}
          disabled={!isConnected}
          variant="destructive"
          className="flex-1"
        >
          <PhoneOff className="w-4 h-4 mr-2" />
          End Interview
        </Button>
      </div>

      {/* Connection Log */}
      {connectionLog.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Connection Log:
          </h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {connectionLog.map((log, index) => (
              <div key={index} className="text-xs text-gray-600 font-mono">
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Debug Info - Show if prompt is loaded */}
      {prompt && (
        <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs">
          <p className="font-medium mb-1 text-gray-700">Debug Info:</p>
          <p className="text-gray-600">
            Prompt loaded: {prompt.length} characters
          </p>
          <p className="text-gray-600 mt-1">
            Overrides active: {prompt ? "Yes" : "No"}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-gray-600 hover:text-gray-800">
              View prompt preview
            </summary>
            <pre className="mt-2 p-2 bg-white rounded text-xs overflow-auto max-h-32">
              {prompt.substring(0, 500)}
              {prompt.length > 500 ? "..." : ""}
            </pre>
          </details>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <p className="font-medium mb-1">Instructions:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Click "Start Voice Interview" to begin</li>
          <li>Allow microphone access when prompted</li>
          <li>The agent will ask questions based on your submission</li>
          <li>Click "End Interview" when finished</li>
        </ul>
        <div className="mt-2 pt-2 border-t border-blue-200">
          <p className="font-medium text-xs">⚠️ Troubleshooting:</p>
          <p className="text-xs mt-1">
            If overrides aren't working, verify in ElevenLabs UI: Agent Settings
            → Security → Enable "System prompt override"
          </p>
        </div>
      </div>
    </div>
  );
}
