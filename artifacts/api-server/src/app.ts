import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./lib/logger";

export async function createApp(): Promise<Express> {
  const app: Express = express();
  const appDir = path.dirname(fileURLToPath(import.meta.url));
  const webDistDir = path.resolve(appDir, "../../nurse-scheduler/dist/public");
  const hasWebBuild = existsSync(path.join(webDistDir, "index.html"));

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
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const routerModule = process.env.DATABASE_URL
    ? await import("./routes")
    : await import("./demo/routes");

  app.use("/api", routerModule.default);

  if (hasWebBuild) {
    app.use(express.static(webDistDir));

    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(path.join(webDistDir, "index.html"));
    });
  }

  return app;
}
