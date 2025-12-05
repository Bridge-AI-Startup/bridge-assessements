import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Users, 
  CheckCircle, 
  Clock, 
  TrendingDown, 
  Search,
  Filter,
  ChevronDown,
  Eye,
  Star,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function SubmissionsDashboard() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Mock data
  const stats = {
    totalInvited: 156,
    started: 112,
    completed: 87,
    avgScore: 74,
    avgTimeSpent: "3h 12m"
  };

  const dropoffRate = Math.round(((stats.started - stats.completed) / stats.started) * 100);
  const startRate = Math.round((stats.started / stats.totalInvited) * 100);
  const completionRate = Math.round((stats.completed / stats.started) * 100);

  const submissions = [
    { id: 1, name: "Sarah Chen", email: "sarah.chen@email.com", status: "completed", score: 87, submittedAt: "2024-01-15T14:30:00Z", timeSpent: "3h 42m" },
    { id: 2, name: "Marcus Johnson", email: "marcus.j@email.com", status: "completed", score: 92, submittedAt: "2024-01-15T10:15:00Z", timeSpent: "2h 58m" },
    { id: 3, name: "Emily Rodriguez", email: "emily.r@email.com", status: "in_progress", score: null, submittedAt: null, timeSpent: "1h 20m" },
    { id: 4, name: "David Kim", email: "david.kim@email.com", status: "completed", score: 68, submittedAt: "2024-01-14T16:45:00Z", timeSpent: "4h 10m" },
    { id: 5, name: "Lisa Wang", email: "lisa.wang@email.com", status: "not_started", score: null, submittedAt: null, timeSpent: null },
    { id: 6, name: "James Miller", email: "james.m@email.com", status: "completed", score: 79, submittedAt: "2024-01-14T09:20:00Z", timeSpent: "3h 05m" },
    { id: 7, name: "Anna Thompson", email: "anna.t@email.com", status: "expired", score: null, submittedAt: null, timeSpent: null },
    { id: 8, name: "Michael Brown", email: "michael.b@email.com", status: "in_progress", score: null, submittedAt: null, timeSpent: "0h 45m" },
  ];

  const filteredSubmissions = submissions.filter(sub => {
    const matchesSearch = sub.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          sub.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || sub.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status) => {
    const styles = {
      completed: 'bg-green-100 text-green-700',
      in_progress: 'bg-blue-100 text-blue-700',
      not_started: 'bg-gray-100 text-gray-600',
      expired: 'bg-red-100 text-red-700'
    };
    const labels = {
      completed: 'Completed',
      in_progress: 'In Progress',
      not_started: 'Not Started',
      expired: 'Expired'
    };
    return <Badge className={styles[status]}>{labels[status]}</Badge>;
  };

  const getScoreColor = (score) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-8"
                      >
                        <Link to={createPageUrl('Home')} className="text-sm text-gray-500 hover:text-[#1E3A8A] mb-1 block">
                          ← Back to Assessments
                        </Link>
                        <h1 className="text-2xl font-bold text-[#1E3A8A]">Submissions Dashboard</h1>
          <p className="text-gray-500 text-sm">Track candidate progress and review submissions</p>
        </motion.div>

        {/* Stats Cards */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-5 gap-4 mb-8"
        >
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.totalInvited}</p>
            <p className="text-sm text-gray-500">Total Invited</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-5 h-5 text-blue-500" />
              <span className="text-xs text-green-600 flex items-center gap-0.5">
                <ArrowUpRight className="w-3 h-3" />
                {startRate}%
              </span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.started}</p>
            <p className="text-sm text-gray-500">Started</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-xs text-green-600 flex items-center gap-0.5">
                <ArrowUpRight className="w-3 h-3" />
                {completionRate}%
              </span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.completed}</p>
            <p className="text-sm text-gray-500">Completed</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <TrendingDown className="w-5 h-5 text-red-500" />
              <span className="text-xs text-red-600 flex items-center gap-0.5">
                <ArrowDownRight className="w-3 h-3" />
                {dropoffRate}%
              </span>
            </div>
            <p className="text-2xl font-bold text-red-600">{stats.started - stats.completed}</p>
            <p className="text-sm text-gray-500">Dropoff</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <Star className="w-5 h-5 text-yellow-500" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.avgScore}%</p>
            <p className="text-sm text-gray-500">Avg Score</p>
          </div>
        </motion.div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex items-center gap-4"
        >
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search candidates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20"
            >
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="in_progress">In Progress</option>
              <option value="not_started">Not Started</option>
              <option value="expired">Expired</option>
            </select>
          </div>
        </motion.div>

        {/* Submissions Table */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-xl border border-gray-200 overflow-hidden"
        >
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Candidate</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Score</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Time Spent</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredSubmissions.map((submission) => (
                <tr key={submission.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#1E3A8A] flex items-center justify-center text-white text-sm font-medium">
                        {submission.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{submission.name}</p>
                        <p className="text-xs text-gray-500">{submission.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    {getStatusBadge(submission.status)}
                  </td>
                  <td className="px-5 py-4">
                    {submission.score !== null ? (
                      <span className={`font-semibold ${getScoreColor(submission.score)}`}>
                        {submission.score}%
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600">
                    {submission.timeSpent || '—'}
                  </td>
                  <td className="px-5 py-4 text-right">
                    {submission.status === 'completed' && (
                      <Link to={createPageUrl('CandidateSubmission')}>
                        <Button variant="ghost" size="sm" className="text-[#1E3A8A] hover:bg-[#1E3A8A]/10">
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>
    </div>
  );
}