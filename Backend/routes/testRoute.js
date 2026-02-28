import express from "express";

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({ ok: true, route: "test", ts: Date.now() });
});

export default router;
