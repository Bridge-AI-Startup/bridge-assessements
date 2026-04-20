import React from "react";
import Employer from "./Employer.jsx";
import Candidate from "./Candidate.jsx";

export default function App() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (path.startsWith("/candidate") || token) {
    return <Candidate initialToken={token || ""} />;
  }
  return <Employer />;
}
