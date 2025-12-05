import CreateAssessment from './pages/CreateAssessment';
import AssessmentEditor from './pages/AssessmentEditor';
import CandidateSubmission from './pages/CandidateSubmission';
import SubmissionsDashboard from './pages/SubmissionsDashboard';
import CandidateAssessment from './pages/CandidateAssessment';
import Home from './pages/Home';
import Landing from './pages/Landing';
import GetStarted from './pages/GetStarted';


export const PAGES = {
    "CreateAssessment": CreateAssessment,
    "AssessmentEditor": AssessmentEditor,
    "CandidateSubmission": CandidateSubmission,
    "SubmissionsDashboard": SubmissionsDashboard,
    "CandidateAssessment": CandidateAssessment,
    "Home": Home,
    "Landing": Landing,
    "GetStarted": GetStarted,
}

export const pagesConfig = {
    mainPage: "CreateAssessment",
    Pages: PAGES,
};