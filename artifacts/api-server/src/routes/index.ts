import { Router, type IRouter } from "express";
import healthRouter from "./health";
import wardsRouter from "./wards";
import nursesRouter from "./nurses";
import rulesRouter from "./rules";
import staffingRouter from "./staffing";
import schedulesRouter from "./schedules";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/dashboard", dashboardRouter);
router.use("/wards", wardsRouter);
router.use("/wards/:wardId/nurses", nursesRouter);
router.use("/wards/:wardId", rulesRouter);
router.use("/wards/:wardId/staffing", staffingRouter);
router.use("/wards/:wardId/schedules", schedulesRouter);

export default router;
