/**
 * Interview Test Page
 *
 * Generate interview questions first, then use this page to start and complete the interview.
 * This is a minimal testing page for Phase 1 interview flow.
 *
 * Flow:
 * 1. Enter submissionId
 * 2. Click "Start Interview" (assumes questions were already generated)
 * 3. View interviewer's prompt
 * 4. Type answer and submit
 * 5. Repeat until interview is completed
 * 6. View transcript of the conversation
 */

import React, { useState } from "react";

export default function InterviewTestPage() {
  const [submissionId, setSubmissionId] = useState("");
  const [sessionId, setSessionId] = useState(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(null);
  const [totalQuestions, setTotalQuestions] = useState(null);
  const [interviewerText, setInterviewerText] = useState("");
  const [candidateAnswer, setCandidateAnswer] = useState("");
  const [transcript, setTranscript] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isCompleted, setIsCompleted] = useState(false);

  const handleStartInterview = async () => {
    if (!submissionId.trim()) {
      setError("Please enter a submission ID");
      return;
    }

    setIsLoading(true);
    setError(null);
    setTranscript([]);
    setCandidateAnswer("");
    setIsCompleted(false);

    try {
      const response = await fetch("/api/interviews/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ submissionId: submissionId.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409 && data.error?.includes("not ready")) {
          setError(
            "Please generate interview questions before starting the interview."
          );
        } else {
          setError(data.error || "Failed to start interview");
        }
        setIsLoading(false);
        return;
      }

      // Interview started successfully
      setSessionId(data.sessionId);
      setCurrentQuestionIndex(data.questionIndex);
      setTotalQuestions(data.totalQuestions);
      setInterviewerText(data.interviewerText);

      // Add first question to transcript
      setTranscript([
        {
          role: "interviewer",
          text: data.interviewerText,
        },
      ]);

      setIsLoading(false);
    } catch (err) {
      console.error("Error starting interview:", err);
      setError(err.message || "Failed to start interview");
      setIsLoading(false);
    }
  };

  const handleSubmitAnswer = async () => {
    if (!sessionId || !candidateAnswer.trim() || isCompleted) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/interviews/${sessionId}/answer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: candidateAnswer.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to submit answer");
        setIsLoading(false);
        return;
      }

      // Add candidate answer to transcript
      setTranscript((prev) => [
        ...prev,
        {
          role: "candidate",
          text: candidateAnswer.trim(),
        },
      ]);

      // Clear answer input
      setCandidateAnswer("");

      if (data.done) {
        // Interview completed
        setIsCompleted(true);
        setInterviewerText(data.interviewerText);

        // Add final interviewer message to transcript
        setTranscript((prev) => [
          ...prev,
          {
            role: "interviewer",
            text: data.interviewerText,
          },
        ]);
      } else {
        // More questions remain
        setCurrentQuestionIndex(data.questionIndex);
        setInterviewerText(data.interviewerText);

        // Add next interviewer question to transcript
        setTranscript((prev) => [
          ...prev,
          {
            role: "interviewer",
            text: data.interviewerText,
          },
        ]);
      }

      setIsLoading(false);
    } catch (err) {
      console.error("Error submitting answer:", err);
      setError(err.message || "Failed to submit answer");
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isLoading && !isCompleted) {
      e.preventDefault();
      handleSubmitAnswer();
    }
  };

  return (
    <div style={{ maxWidth: "800px", margin: "40px auto", padding: "20px" }}>
      <h1 style={{ marginBottom: "30px" }}>Interview Test Page</h1>

      {/* Submission ID Input */}
      <div style={{ marginBottom: "20px" }}>
        <label
          style={{ display: "block", marginBottom: "8px", fontWeight: "bold" }}
        >
          Submission ID:
        </label>
        <div style={{ display: "flex", gap: "10px" }}>
          <input
            type="text"
            value={submissionId}
            onChange={(e) => setSubmissionId(e.target.value)}
            placeholder="Enter submission ID"
            disabled={!!sessionId && !isCompleted}
            style={{
              flex: 1,
              padding: "8px 12px",
              fontSize: "14px",
              border: "1px solid #ccc",
              borderRadius: "4px",
            }}
          />
          <button
            onClick={handleStartInterview}
            disabled={isLoading || (!!sessionId && !isCompleted)}
            style={{
              padding: "8px 16px",
              fontSize: "14px",
              backgroundColor: sessionId && !isCompleted ? "#ccc" : "#1E3A8A",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor:
                isLoading || (sessionId && !isCompleted)
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {isLoading ? "Starting..." : "Start Interview"}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div
          style={{
            padding: "12px",
            marginBottom: "20px",
            backgroundColor: "#fee",
            border: "1px solid #fcc",
            borderRadius: "4px",
            color: "#c00",
          }}
        >
          {error}
        </div>
      )}

      {/* Interview Status */}
      {sessionId && (
        <div style={{ marginBottom: "20px" }}>
          <div style={{ marginBottom: "10px" }}>
            <strong>Session ID:</strong> {sessionId}
          </div>
          {currentQuestionIndex !== null && totalQuestions && (
            <div style={{ marginBottom: "10px" }}>
              <strong>
                Question {currentQuestionIndex + 1} of {totalQuestions}
              </strong>
            </div>
          )}
          {isCompleted && (
            <div
              style={{
                padding: "12px",
                backgroundColor: "#dfd",
                border: "1px solid #afa",
                borderRadius: "4px",
                color: "#060",
                fontWeight: "bold",
              }}
            >
              Interview Complete
            </div>
          )}
        </div>
      )}

      {/* Interviewer Prompt */}
      {interviewerText && (
        <div style={{ marginBottom: "20px" }}>
          <h3 style={{ marginBottom: "10px" }}>Interviewer:</h3>
          <div
            style={{
              padding: "16px",
              backgroundColor: "#f5f5f5",
              border: "1px solid #ddd",
              borderRadius: "4px",
              minHeight: "60px",
            }}
          >
            {interviewerText}
          </div>
        </div>
      )}

      {/* Candidate Answer Input */}
      {sessionId && !isCompleted && (
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontWeight: "bold",
            }}
          >
            Your Answer:
          </label>
          <textarea
            value={candidateAnswer}
            onChange={(e) => setCandidateAnswer(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your answer here..."
            disabled={isLoading || !sessionId || isCompleted}
            style={{
              width: "100%",
              minHeight: "120px",
              padding: "12px",
              fontSize: "14px",
              border: "1px solid #ccc",
              borderRadius: "4px",
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          <button
            onClick={handleSubmitAnswer}
            disabled={
              isLoading || !sessionId || !candidateAnswer.trim() || isCompleted
            }
            style={{
              marginTop: "10px",
              padding: "10px 20px",
              fontSize: "14px",
              backgroundColor:
                isLoading ||
                !sessionId ||
                !candidateAnswer.trim() ||
                isCompleted
                  ? "#ccc"
                  : "#1E3A8A",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor:
                isLoading ||
                !sessionId ||
                !candidateAnswer.trim() ||
                isCompleted
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {isLoading ? "Submitting..." : "Submit Answer"}
          </button>
          <div style={{ marginTop: "8px", fontSize: "12px", color: "#666" }}>
            Press Enter to submit (Shift+Enter for new line)
          </div>
        </div>
      )}

      {/* Transcript */}
      {transcript.length > 0 && (
        <div style={{ marginTop: "40px" }}>
          <h2 style={{ marginBottom: "16px" }}>Transcript</h2>
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "4px",
              maxHeight: "400px",
              overflowY: "auto",
              padding: "16px",
              backgroundColor: "#fafafa",
            }}
          >
            {transcript.map((entry, index) => (
              <div
                key={index}
                style={{
                  marginBottom: "16px",
                  padding: "12px",
                  backgroundColor:
                    entry.role === "interviewer" ? "#e3f2fd" : "#fff",
                  borderLeft: `4px solid ${
                    entry.role === "interviewer" ? "#1E3A8A" : "#4caf50"
                  }`,
                  borderRadius: "4px",
                }}
              >
                <div
                  style={{
                    fontWeight: "bold",
                    marginBottom: "6px",
                    color: entry.role === "interviewer" ? "#1E3A8A" : "#4caf50",
                  }}
                >
                  {entry.role === "interviewer" ? "Interviewer" : "Candidate"}:
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{entry.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
