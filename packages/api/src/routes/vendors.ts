import { Router } from "express";
import { notImplemented } from "../lib/problem.js";

// §6.5.3 — vendors endpoints.
export const vendorsRouter = Router();

vendorsRouter.get("/vendors", (_req, _res, next) => {
  next(notImplemented("GET /vendors is not implemented yet."));
});

vendorsRouter.post("/vendors", (_req, _res, next) => {
  next(notImplemented("POST /vendors is not implemented yet."));
});

vendorsRouter.get("/vendors/:id", (_req, _res, next) => {
  next(notImplemented("GET /vendors/:id is not implemented yet."));
});

vendorsRouter.patch("/vendors/:id", (_req, _res, next) => {
  next(notImplemented("PATCH /vendors/:id is not implemented yet."));
});

vendorsRouter.delete("/vendors/:id", (_req, _res, next) => {
  next(notImplemented("DELETE /vendors/:id is not implemented yet."));
});
