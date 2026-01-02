import { useState, useMemo, useRef, useEffect } from "react";
import { useConversation } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import { Loader2, Phone, PhoneOff, CheckCircle } from "lucide-react";
import { get } from "@/api/requests";

/**
 * ElevenLabs Voice Interview Client Component
 *
 * Manages voice interview sessions using ElevenLabs Agents Platform.
 * Fetches the interview prompt from backend and passes it as a conversation override.
 */
export default function ElevenLabsInterviewClient({
  submissionId,
  userId,
  interviewStatus,
  onInterviewStatusChange,
  token,
}) {
  // Local UI state
  const [prompt, setPrompt] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [isInterviewComplete, setIsInterviewComplete] = useState(false);
  const transcriptEndRef = useRef(null);

  // Get agent ID from environment variable
  // @ts-ignore - Vite env types
  const agentId = import.meta.env?.VITE_ELEVENLABS_AGENT_ID;

  // Memoize overrides to ensure they update when prompt changes
  // Important: Overrides must be enabled in ElevenLabs agent Security settings
  const overrides = useMemo(() => {
    if (!prompt) {
      return undefined;
    }

    return {
      agent: {
        prompt: {
          prompt: prompt,
        },
        firstMessage:
          "Hey — I'm going to ask you a few questions about your submission. Ready?",
      },
    };
  }, [prompt]);

  // Use a ref to track current overrides for use in async handlers
  const overridesRef = useRef(overrides);
  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);

  // Auto-scroll transcript to bottom when new messages are added
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript]);

  // Initialize ElevenLabs conversation hook with memoized overrides
  // Key the hook by prompt to force re-initialization when prompt changes
  // This ensures overrides are applied when the prompt is set
  const conversation = useConversation({
    overrides: overrides,
    // Note: The hook should be reactive, but using a key pattern ensures it re-initializes
    // Callbacks
    onConnect: () => {
      setError(null);
    },
    onDisconnect: () => {
      setConversationId(null);
    },
    onError: (err) => {
      // @ts-ignore - Error type varies
      const errorMessage =
        (err && typeof err === "object" && err.message) ||
        (err ? String(err) : "An error occurred with the voice interview");
      setError(errorMessage);
    },
    onMessage: (message) => {
      // Add messages to transcript
      if (!message || typeof message !== "object") return;

      // @ts-ignore - MessagePayload type from ElevenLabs
      const messageType = message.type || "";
      // @ts-ignore - MessagePayload type from ElevenLabs
      const text =
        message.text ||
        message.content ||
        message.message ||
        message.data ||
        "";

      // Handle different message types - be more permissive to catch all messages
      if (text && text.trim()) {
        // Determine role based on message type or content
        // IMPORTANT: ElevenLabs typically sends:
        // - "transcript" or "user_transcript" for candidate/user speech
        // - "llm_response" or "agent_response" for interviewer/agent speech
        let role = "candidate"; // Default to candidate (user speech)

        // @ts-ignore - MessagePayload type from ElevenLabs
        const msgType = (messageType || "").toLowerCase();
        // @ts-ignore - MessagePayload type from ElevenLabs
        const msgRole = (message.role || "").toString().toLowerCase();
        // @ts-ignore - MessagePayload type from ElevenLabs
        const msgSpeaker = (message.speaker || "").toString().toLowerCase();
        // @ts-ignore - MessagePayload type from ElevenLabs
        const msgFrom = (message.from || "").toString().toLowerCase();
        // @ts-ignore - MessagePayload type from ElevenLabs
        const msgSource = (message.source || "").toString().toLowerCase();

        // Check if this is an interviewer/agent message
        // Be very explicit about what constitutes an interviewer message
        const isInterviewer =
          msgType === "llm_response" ||
          msgType === "agent_response" ||
          msgType === "agent_speech" ||
          msgType === "assistant" ||
          msgType === "agent" ||
          msgType === "system" ||
          msgRole === "assistant" ||
          msgRole === "agent" ||
          msgRole === "system" ||
          msgSpeaker === "agent" ||
          msgSpeaker === "assistant" ||
          msgSpeaker === "system" ||
          msgFrom === "agent" ||
          msgFrom === "assistant" ||
          msgSource === "agent" ||
          msgSource === "assistant";

        // Explicitly check for user/candidate messages
        const isCandidate =
          msgType === "transcript" ||
          msgType === "user_transcript" ||
          msgType === "user" ||
          msgType === "user_speech" ||
          msgRole === "user" ||
          msgSpeaker === "user" ||
          msgFrom === "user";

        if (isInterviewer) {
          role = "interviewer";
        } else if (isCandidate) {
          role = "candidate";
        }
        // If neither matches, default stays as "candidate"

        const trimmedText = text.trim();
        setTranscript((prev) => [
          ...prev,
          {
            role,
            text: trimmedText,
            timestamp: new Date(),
          },
        ]);

        // Check if interviewer is signaling completion
        if (role === "interviewer") {
          const completionPhrases = [
            "completes our interview",
            "completes the interview",
            "completes this interview",
            "covers all the questions",
            "that's all the questions",
            "thank you for your time",
            "thank you for participating",
            "interview is complete",
            "interview is finished",
            "we're done",
            "we are done",
          ];

          const lowerText = trimmedText.toLowerCase();
          const isCompletionMessage = completionPhrases.some((phrase) =>
            lowerText.includes(phrase)
          );

          if (isCompletionMessage && !isInterviewComplete) {
            setIsInterviewComplete(true);
            // Notify parent component that interview is complete
            if (onInterviewStatusChange) {
              onInterviewStatusChange("completed");
            }
            // Wait a moment for the message to be fully spoken, then end the session
            setTimeout(async () => {
              try {
                await conversation.endSession();
              } catch {
                // Silently handle error
              }
            }, 3000); // Wait 3 seconds for the completion message to finish
          }
        }
      }
    },
  });

  // Start button handler
  const handleStartInterview = async () => {
    setError(null);
    setLoading(true);
    setTranscript([]); // Clear transcript on new start
    setIsInterviewComplete(false); // Reset completion state

    try {
      // Check if agent ID is configured
      if (!agentId) {
        setError("Missing VITE_ELEVENLABS_AGENT_ID environment variable");
        setLoading(false);
        return;
      }

      // Step 1: Fetch prompt from backend
      let fetchedPrompt = null;
      try {
        // Include token in query params if provided (for candidate access)
        const url = token
          ? `/submissions/${submissionId}/interview-agent-prompt?token=${token}`
          : `/submissions/${submissionId}/interview-agent-prompt`;
        const response = await get(url);
        const data = await response.json();
        fetchedPrompt = data.prompt;
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
        setLoading(false);
        return;
      }

      // Step 2: Request microphone permission
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
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

      // Build overrides directly instead of waiting for React state updates
      // This ensures overrides are ready on the first click
      const directOverrides = {
        agent: {
          prompt: {
            prompt: fetchedPrompt,
          },
          firstMessage:
            "Hey — I'm going to ask you a few questions about your submission. Ready?",
        },
      };

      // Wait for React to update state and useMemo to re-compute overrides
      // But use directOverrides as fallback to ensure they're always available
      let attempts = 0;
      let currentOverrides = directOverrides; // Start with direct overrides
      while (
        attempts < 20 &&
        (!overridesRef.current || overridesRef.current === undefined)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (overridesRef.current) {
          currentOverrides = overridesRef.current;
          break;
        }
        attempts++;
      }

      // If ref still doesn't have overrides, use the direct ones we built
      if (!currentOverrides || currentOverrides === undefined) {
        currentOverrides = directOverrides;
      }

      if (!currentOverrides) {
        setError(
          "Failed to load overrides. Please check that System prompt override is enabled in ElevenLabs agent settings."
        );
        setLoading(false);
        return;
      }

      // Ensure submissionId is a string (MongoDB ObjectId might be an object)
      const submissionIdString = String(submissionId);

      // Pass overrides directly to startSession to ensure they're applied on first click
      const id = await conversation.startSession({
        agentId: agentId,
        connectionType: "webrtc",
        userId: userId || undefined,
        dynamicVariables: {
          submissionId: submissionIdString,
        },
        overrides: currentOverrides, // Pass overrides directly to ensure they're applied
      });

      setConversationId(id);

      // Store conversationId on the submission for webhook attribution
      try {
        const { updateInterviewConversationId } = await import(
          "@/api/submission"
        );
        await updateInterviewConversationId(submissionIdString, id, token);
      } catch {
        // Don't fail the interview if storing conversationId fails
      }
    } catch (err) {
      setError(err.message || "Failed to start voice interview");
    } finally {
      setLoading(false);
    }
  };

  // End button handler
  const handleEndInterview = async () => {
    try {
      await conversation.endSession();
    } catch (err) {
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

      {/* Interview Already Completed */}
      {interviewStatus === "completed" && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <h3 className="text-sm font-semibold text-green-900">
              Interview Completed
            </h3>
          </div>
          <p className="text-sm text-green-800">
            You have already completed this interview. Thank you for your
            participation!
          </p>
        </div>
      )}

      {/* Action Buttons */}
      {interviewStatus !== "completed" && (
        <div className="flex gap-3 mb-4">
          <Button
            onClick={handleStartInterview}
            disabled={
              loading ||
              isConnected ||
              !agentId ||
              interviewStatus === "completed"
            }
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
            disabled={!isConnected || isInterviewComplete}
            variant="destructive"
            className="flex-1"
          >
            <PhoneOff className="w-4 h-4 mr-2" />
            {isInterviewComplete ? "Interview Complete" : "End Interview"}
          </Button>
        </div>
      )}

      {/* Interview Complete Message (during active session) */}
      {isInterviewComplete && interviewStatus !== "completed" && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
          ✅ Interview completed! The session has been ended automatically.
        </div>
      )}

      {/* Transcript - Always show when connected, even if empty */}
      {(isConnected || transcript.length > 0) && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Conversation Transcript
          </h3>
          <div className="bg-gray-50 rounded-xl border border-gray-200 max-h-[500px] overflow-y-auto p-4">
            {transcript.length > 0 ? (
              <div className="space-y-4">
                {transcript.map((entry, index) => (
                  <div
                    key={index}
                    className={`p-4 rounded-lg border-l-4 ${
                      entry.role === "interviewer"
                        ? "bg-blue-50 border-blue-500"
                        : "bg-white border-green-500"
                    }`}
                  >
                    <div
                      className={`text-sm font-semibold mb-2 ${
                        entry.role === "interviewer"
                          ? "text-blue-700"
                          : "text-green-700"
                      }`}
                    >
                      {entry.role === "interviewer"
                        ? "Interviewer"
                        : "Candidate"}
                      :
                    </div>
                    <p className="text-gray-900 whitespace-pre-wrap">
                      {entry.text}
                    </p>
                  </div>
                ))}
                {/* Invisible element at the end to scroll to */}
                <div ref={transcriptEndRef} />
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 text-sm">
                {isConnected
                  ? "Conversation will appear here as you speak..."
                  : "Start the interview to see the conversation transcript"}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <p className="font-medium mb-1">Instructions:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Click "Start Voice Interview" to begin</li>
          <li>Allow microphone access when prompted</li>
          <li>The agent will ask questions based on your submission</li>
          <li>You only have one chance to record your answers</li>
          <li>
            The interview will end automatically when all questions are answered
          </li>
        </ul>
      </div>
    </div>
  );
}
