import { Router } from "express";
import { notImplemented } from "../lib/problem.js";

// §6.5.3 — GET /dashboard.
export const dashboardRouter = Router();

dashboardRouter.get("/dashboard", (_req, _res, next) => {
  next(notImplemented("GET /dashboard is not implemented yet."));
});
