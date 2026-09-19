import express from "express";
import { configureHostedApplication } from "./server/_core/hosted-app";

// Supported native Express entrypoint. It never probes or binds a TCP port.
const app = express();
configureHostedApplication(app);
export default app;
