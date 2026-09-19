import express from "express";
import { configureHostedApplication } from "./dist/hosted.js";

// Supported native Express entrypoint. It never probes or binds a TCP port.
const app = express();
configureHostedApplication(app);
export default app;
