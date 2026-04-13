import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initializeClientMonitoring } from "@/lib/observability/clientMonitoring";
import { registerServiceWorker } from "@/lib/pwa/registerServiceWorker";

initializeClientMonitoring();
registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);
