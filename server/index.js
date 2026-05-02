import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import api from "./routes/api.js";
import authRoutes from "./routes/auth.js";
import internalRoutes from "./routes/internal.js";
import { authMiddleware } from "./auth.js";
import { activeDataSource } from "./dal/index.js";

const app = express();

app.use(cors());
app.use(cookieParser());
// 6 MB ceiling — slightly above the 5 MB per-doc cap so legitimate uploads
// fit, but still bounds runaway requests.
app.use(express.json({ limit: "6mb" }));

// Soft auth — populates req.user when a valid session cookie is present.
app.use(authMiddleware);

// /api/auth/* and /api/internal/* are the only route groups that bypass
// session auth — auth uses Google JWTs, internal uses a bearer token for the
// cron job. Everything else under /api is gated by per-route guards.
app.use("/api/auth", authRoutes);
app.use("/api/internal", internalRoutes);
app.use("/api", api);

app.use((err, _req, res, _next) => {
  const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error("[api] error:", err);
  res.status(status).json({ error: err.message ?? "internal_error" });
});

const port = Number(process.env.API_PORT ?? 5174);
app.listen(port, () => {
  console.log(
    `[api] listening on http://localhost:${port} (data source: ${activeDataSource})`
  );
});
