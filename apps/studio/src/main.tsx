import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "reactflow/dist/style.css";
import "./index.css";
import App from "./App.js";

document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
