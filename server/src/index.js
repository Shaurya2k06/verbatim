// Serves the API in app.js. Secrets come from the environment: the repository's git-ignored .env in development, the host's
// environment variables in production. Run: pnpm --filter @verbatim/server dev
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
const { handle } = await import("./app.js");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
const origins = (process.env.CLIENT_ORIGIN ?? "http://localhost:5173,http://localhost:4173").split(",").map((s) => s.trim());
// Entries may use * for one label, e.g. https://verbatim-*.vercel.app for preview deployments.
const allowed = origins.map((o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[a-z0-9-]+")}$`));
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowed.some((r) => r.test(origin))) }));
app.use(express.json({ limit: "256kb" }));

app.all("/api/*path", async (req, res) => {
  const out = await handle({ method: req.method, path: req.path.replace(/^\/api\/?/, ""), body: req.body, env: process.env, ip: req.ip ?? "unknown" });
  res.set("cache-control", "no-store").status(out.status).json(out.body);
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`verbatim server on :${port}, allowing ${origins.join(", ")}`));
