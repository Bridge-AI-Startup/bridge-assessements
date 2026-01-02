import CreateAssessment from "./pages/CreateAssessment";
import AssessmentEditor from "./pages/AssessmentEditor";
import CandidateSubmission from "./pages/CandidateSubmission";
import SubmissionsDashboard from "./pages/SubmissionsDashboard";
import CandidateAssessment from "./pages/CandidateAssessment";
import CandidateSubmitted from "./pages/CandidateSubmitted";
import Home from "./pages/Home";
import Landing from "./pages/Landing";
import GetStarted from "./pages/GetStarted";
import Subscription from "./pages/Subscription";
import BillingSuccess from "./pages/BillingSuccess";
import BillingCancel from "./pages/BillingCancel";
import CancelSubscription from "./pages/CancelSubscription";

export const PAGES = {
  CreateAssessment: CreateAssessment,
  AssessmentEditor: AssessmentEditor,
  CandidateSubmission: CandidateSubmission,
  SubmissionsDashboard: SubmissionsDashboard,
  CandidateAssessment: CandidateAssessment,
  CandidateSubmitted: CandidateSubmitted,
  Home: Home,
  Landing: Landing,
  GetStarted: GetStarted,
  Subscription: Subscription,
  BillingSuccess: BillingSuccess,
  BillingCancel: BillingCancel,
  CancelSubscription: CancelSubscription,
};

export const pagesConfig = {
  mainPage: "Landing",
  Pages: PAGES,
};
