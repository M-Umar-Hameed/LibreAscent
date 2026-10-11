import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Overlay } from "./Overlay";
import "./styles.css";

// A render error used to unmount the whole tree and leave a blank window.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: String(error) };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="shell">
          <section className="panel">
            <h2>Something went wrong</h2>
            <p className="warning">{this.state.error}</p>
            <p className="path">Protection keeps running in the background service.</p>
            <button onClick={() => window.location.reload()}>Reload</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

const root = createRoot(document.getElementById("root")!);

if (window.location.hash === "#overlay") {
  root.render(
    <React.StrictMode>
      <Overlay />
    </React.StrictMode>,
  );
} else {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
