import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { bootstrapApplication } from "./acceptance/bootstrap";
import { NativeAcceptanceView } from "./acceptance/NativeAcceptanceView";
import { NormalAppAcceptance } from "./acceptance/NormalAppAcceptance";
import {
  finishNativeAcceptance,
  isTauriRuntime,
  nativeAcceptanceConfig,
} from "./api/tauri";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

function renderNormalApplication() {
  root.render(<React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>);
}

void bootstrapApplication({
  appVersion: __APP_VERSION__,
  isTauriRuntime,
  loadAcceptanceConfig: nativeAcceptanceConfig,
  finishAcceptance: finishNativeAcceptance,
  renderNormalApplication,
  renderAcceptance: (config) => {
    if (config.surface === "normal-app") {
      root.render(
        <ErrorBoundary>
          <App />
          <NormalAppAcceptance config={config} />
        </ErrorBoundary>,
      );
      return;
    }
    root.render(
      <ErrorBoundary>
        <NativeAcceptanceView config={config} />
      </ErrorBoundary>,
    );
  },
  renderDiagnostic: (message) => {
    root.render(<main role="alert">Native acceptance bootstrap failed: {message}</main>);
  },
});
