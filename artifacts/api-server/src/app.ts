import express, { type Express } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.set("trust proxy", process.env.TRUST_PROXY === "false" ? false : 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const staticDirectory = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : "";
if (staticDirectory && existsSync(path.join(staticDirectory, "index.html"))) {
  app.use(express.static(staticDirectory, { index: false, maxAge: "1h" }));
  app.get("/{*splat}", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(staticDirectory, "index.html"));
  });
}

export default app;
