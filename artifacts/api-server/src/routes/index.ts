import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import adminRouter from "./admin";
import stateRouter from "./state";
import filesRouter from "./files";
import { requireSameOrigin } from "../lib/auth";

const router: IRouter = Router();

router.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    requireSameOrigin(req, res, next);
    return;
  }
  next();
});
router.use(healthRouter);
router.use(authRouter);
router.use(adminRouter);
router.use(stateRouter);
router.use(filesRouter);

export default router;
