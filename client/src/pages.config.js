import CreateAssessment from "./pages/CreateAssessment";
import AssessmentEditor from "./pages/AssessmentEditor";
import CandidateSubmission from "./pages/CandidateSubmission";
import SubmissionsDashboard from "./pages/SubmissionsDashboard";
import CandidateAssessment from "./pages/CandidateAssessment";
import CandidateSubmitted from "./pages/CandidateSubmitted";
import Home from "./pages/Home";
import AppIndex from "./pages/AppIndex";
import Login from "./pages/Login";
import GetStarted from "./pages/GetStarted";
import Subscription from "./pages/Subscription";
import BillingSuccess from "./pages/BillingSuccess";
import BillingCancel from "./pages/BillingCancel";
import CancelSubscription from "./pages/CancelSubscription";
import ProctoringTest from "./pages/ProctoringTest";
import ProctoringStorageTest from "./pages/ProctoringStorageTest";
import DemoReplay from "./pages/DemoReplay";
import TranscriptPlayground from "./pages/TranscriptPlayground";
import HackathonDashboard from "./pages/HackathonDashboard";

export const PAGES = {
  CreateAssessment: CreateAssessment,
  AssessmentEditor: AssessmentEditor,
  CandidateSubmission: CandidateSubmission,
  SubmissionsDashboard: SubmissionsDashboard,
  CandidateAssessment: CandidateAssessment,
  CandidateSubmitted: CandidateSubmitted,
  Home: Home,
  AppIndex: AppIndex,
  Login: Login,
  GetStarted: GetStarted,
  Subscription: Subscription,
  BillingSuccess: BillingSuccess,
  BillingCancel: BillingCancel,
  CancelSubscription: CancelSubscription,
  ProctoringTest: ProctoringTest,
  ProctoringStorageTest: ProctoringStorageTest,
  DemoReplay: DemoReplay,
  TranscriptPlayground: TranscriptPlayground,
  HackathonDashboard: HackathonDashboard,
};

export const pagesConfig = {
  mainPage: "AppIndex",
  Pages: PAGES,
};
