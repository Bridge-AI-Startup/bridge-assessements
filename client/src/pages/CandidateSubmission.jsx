import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  ArrowLeft, 
  User, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Code, 
  FileText, 
  MessageSquare, 
  Star,
  ExternalLink,
  Play,
  Download,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function CandidateSubmission() {
  const [expandedSections, setExpandedSections] = useState({
    code: true,
    tests: true,
    interview: false
  });

  // Mock data - in real app, this would come from URL params and API
  const candidate = {
    name: "Sarah Chen",
    email: "sarah.chen@email.com",
    submittedAt: "2024-01-15T14:30:00Z",
    status: "reviewed",
    overallScore: 87,
    githubUrl: "https://github.com/sarahchen/task-api",
    timeSpent: "3h 42m"
  };

  const assessment = {
    title: "Backend API Assessment",
    projectDescription: "Build a simple REST API for a task management system."
  };


  const testResults = [
    { name: "User registration creates valid JWT", type: "unit", passed: true, points: 10, maxPoints: 10 },
    { name: "Tasks CRUD operations work correctly", type: "integration", passed: true, points: 15, maxPoints: 15 },
    { name: "Unauthorized access returns 401", type: "unit", passed: true, points: 10, maxPoints: 10 },
    { name: "Database relationships are maintained", type: "integration", passed: false, points: 10, maxPoints: 15 }
  ];

  const interviewQuestions = [
    { 
      question: "Walk me through how you structured your database schema and why.", 
      answer: "I used a normalized structure with users and tasks tables. The tasks table has a foreign key to users for ownership. I chose PostgreSQL for its reliability and JSON support for flexible task metadata.",
      aiNotes: "Candidate demonstrated solid understanding of relational database design principles.",
      score: 85,
      videoUrl: "https://example.com/video1.mp4"
    },
    { 
      question: "How did you handle authentication? What alternatives did you consider?", 
      answer: "I implemented JWT-based authentication with refresh tokens. I considered session-based auth but chose JWT for stateless scalability. I also looked at OAuth but it was overkill for this scope.",
      aiNotes: "Good awareness of trade-offs. Could have mentioned security considerations more.",
      score: 78,
      videoUrl: "https://example.com/video2.mp4"
    },
    { 
      question: "How would you scale this API to handle 10,000 concurrent users?", 
      answer: "I'd add Redis for caching frequently accessed data, implement connection pooling, and consider read replicas for the database. For the API layer, horizontal scaling with a load balancer.",
      aiNotes: "Strong technical knowledge. Mentioned key scaling strategies appropriately.",
      score: 92,
      videoUrl: "https://example.com/video3.mp4"
    }
  ];

  const interviewAvgScore = Math.round(interviewQuestions.reduce((sum, q) => sum + q.score, 0) / interviewQuestions.length);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBg = (score) => {
    if (score >= 90) return 'bg-green-100';
    if (score >= 70) return 'bg-yellow-100';
    return 'bg-red-100';
  };

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <Link 
            to={createPageUrl('AssessmentEditor')} 
            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Assessment
          </Link>

          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-[#1E3A8A] flex items-center justify-center text-white text-xl font-semibold">
                {candidate.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{candidate.name}</h1>
                <p className="text-gray-500">{candidate.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" className="gap-2">
                <Download className="w-4 h-4" />
                Export PDF
              </Button>
              <Button className="gap-2 bg-[#1E3A8A] hover:bg-[#152a66]">
                <MessageSquare className="w-4 h-4" />
                Send Feedback
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Overview Cards */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-4 gap-4 mb-6"
        >
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500 mb-1">Overall Score</p>
            <p className={`text-3xl font-bold ${getScoreColor(candidate.overallScore)}`}>
              {candidate.overallScore}%
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500 mb-1">Time Spent</p>
            <p className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-gray-400" />
              {candidate.timeSpent}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500 mb-1">Tests Passed</p>
            <p className="text-xl font-semibold text-gray-900">
              {testResults.filter(t => t.passed).length}/{testResults.length}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500 mb-1">Submission</p>
            <a 
              href={candidate.githubUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-[#1E3A8A] hover:underline flex items-center gap-1 text-sm font-medium"
            >
              View on GitHub
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </motion.div>


        {/* Test Results */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-xl border border-gray-200 mb-6"
        >
          <button 
            onClick={() => toggleSection('tests')}
            className="w-full flex items-center justify-between p-5 text-left"
          >
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Code className="w-5 h-5 text-[#1E3A8A]" />
              Test Results
            </h2>
            {expandedSections.tests ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
          </button>
          {expandedSections.tests && (
            <div className="px-5 pb-5 space-y-2">
              {testResults.map((test, index) => (
                <div 
                  key={index}
                  className={`flex items-center justify-between p-3 rounded-lg ${test.passed ? 'bg-green-50' : 'bg-red-50'}`}
                >
                  <div className="flex items-center gap-3">
                    {test.passed ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-gray-900">{test.name}</p>
                      <Badge variant="outline" className="text-xs mt-1">{test.type}</Badge>
                    </div>
                  </div>
                  <span className={`text-sm font-semibold ${test.passed ? 'text-green-600' : 'text-red-600'}`}>
                    {test.points}/{test.maxPoints} pts
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* AI Interview Responses */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-white rounded-xl border border-gray-200"
        >
          <button 
            onClick={() => toggleSection('interview')}
            className="w-full flex items-center justify-between p-5 text-left"
          >
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-[#1E3A8A]" />
                AI Interview Responses
              </h2>
              <div className={`px-2.5 py-1 rounded-full text-sm font-semibold ${getScoreBg(interviewAvgScore)} ${getScoreColor(interviewAvgScore)}`}>
                Avg: {interviewAvgScore}%
              </div>
            </div>
            {expandedSections.interview ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
          </button>
          {expandedSections.interview && (
            <div className="px-5 pb-5 space-y-4">
              {interviewQuestions.map((item, index) => (
                <div key={index} className="border border-gray-100 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-sm font-medium text-gray-900">{item.question}</p>
                    <div className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getScoreBg(item.score)} ${getScoreColor(item.score)}`}>
                      {item.score}%
                    </div>
                  </div>
                  
                  {/* Video Player */}
                  <div className="mb-3 rounded-lg overflow-hidden bg-gray-900 aspect-video flex items-center justify-center relative group cursor-pointer">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                        <Play className="w-6 h-6 text-[#1E3A8A] ml-1" />
                      </div>
                    </div>
                    <p className="text-white/60 text-xs absolute bottom-3 left-3">Video response • 1:24</p>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-3 mb-3">
                    <p className="text-xs text-gray-500 mb-1">Transcript</p>
                    <p className="text-sm text-gray-700 italic">"{item.answer}"</p>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-[#1E3A8A] bg-blue-50 rounded-lg p-2">
                    <Star className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>{item.aiNotes}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}