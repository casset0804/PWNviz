import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// i18next must be initialised before the first component renders, otherwise the
// very first paint would briefly fall back to untranslated keys. zh-CN is the
// default; the saved choice in localStorage wins.
import "./i18n";
import { App } from "./app/App";
import { useDebugStore } from "./stores/debugStore";
import "./index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root not found");
}

// Development/E2E hook: the UI performance harness drives the *real* store (and
// therefore the real backend/GDB); production builds never expose it.
if (import.meta.env.DEV) {
  window.__PWNVIZ_STORE__ = useDebugStore;
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
