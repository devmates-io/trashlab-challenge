import { Router } from "express";
import { notImplemented } from "../lib/problem.js";

// §6.5.3 — bills endpoints (CRUD + state transitions T1–T10).
export const billsRouter = Router();

billsRouter.get("/bills", (_req, _res, next) => {
  next(notImplemented("GET /bills is not implemented yet."));
});

billsRouter.post("/bills", (_req, _res, next) => {
  next(notImplemented("POST /bills is not implemented yet."));
});

billsRouter.get("/bills/:id", (_req, _res, next) => {
  next(notImplemented("GET /bills/:id is not implemented yet."));
});

billsRouter.patch("/bills/:id", (_req, _res, next) => {
  next(notImplemented("PATCH /bills/:id is not implemented yet."));
});

billsRouter.delete("/bills/:id", (_req, _res, next) => {
  next(notImplemented("DELETE /bills/:id is not implemented yet."));
});

billsRouter.post("/bills/:id/submit", (_req, _res, next) => {
  next(notImplemented("POST /bills/:id/submit is not implemented yet."));
});

billsRouter.post("/bills/:id/approve", (_req, _res, next) => {
  next(notImplemented("POST /bills/:id/approve is not implemented yet."));
});

billsRouter.post("/bills/:id/recall", (_req, _res, next) => {
  next(notImplemented("POST /bills/:id/recall is not implemented yet."));
});

billsRouter.post("/bills/:id/pay", (_req, _res, next) => {
  next(notImplemented("POST /bills/:id/pay is not implemented yet."));
});

billsRouter.post("/bills/:id/clone", (_req, _res, next) => {
  next(notImplemented("POST /bills/:id/clone is not implemented yet."));
});
