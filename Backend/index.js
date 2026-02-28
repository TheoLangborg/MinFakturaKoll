import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import scanRoute from "./routes/scanRoute.js";
import testRoute from "./routes/testRoute.js";
import historyRoute from "./routes/historyRoute.js";
import marketRoute from "./routes/marketRoute.js";
import accountRoute from "./routes/accountRoute.js";

dotenv.config();

const app = express();
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const port = Number(process.env.PORT || 3001);

app.use(
  cors({
    origin: frontendOrigin,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json({ limit: "35mb" }));

app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use("/api", scanRoute);
app.use("/api/history", historyRoute);
app.use("/api/market", marketRoute);
app.use("/api/account", accountRoute);
app.use("/api/test", testRoute);

app.listen(port, () => {
  console.log(`MinKostnadskoll backend startad: http://localhost:${port}`);
});
