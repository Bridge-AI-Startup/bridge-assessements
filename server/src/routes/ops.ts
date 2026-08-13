import express from "express";

import { getWorkload } from "../controllers/ops.js";
import { requireOpsAdmin } from "../middleware/requireOpsAdmin.js";
import { verifyAuthToken } from "../validators/auth.js";

const router = express.Router();

router.get("/workload", [verifyAuthToken, requireOpsAdmin], getWorkload);

export default router;
