import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportErrorBoundaryError } from "../lib/errorBoundaryEvents";

type ErrorBoundaryVariant = "app" | "inline";

interface Props {
  children: ReactNode;
  variant?: ErrorBoundaryVariant;
  /** Used with variant="inline" for a11y. */
  title?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
    reportErrorBoundaryError(error, info.componentStack);
  }

  render() {
    const variant = this.props.variant ?? "app";
    if (this.state.hasError) {
      if (variant === "inline") {
        return (
          <div
            className="error-boundary-inline"
            role="alert"
            aria-live="polite"
            aria-label={this.props.title ?? "内容渲染错误"}
          >
            <p className="error-boundary-inline-title">{this.props.title ?? "内容渲染出错"}</p>
            <p className="error-boundary-inline-msg">{this.state.error?.message ?? "未知错误"}</p>
            <button
              type="button"
              className="ghost-button compact"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              重试
            </button>
          </div>
        );
      }
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            gap: "12px",
            padding: "40px",
            fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
            color: "#1d1d1f",
            background: "#f5f5f7",
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>应用发生了错误</h2>
          <p style={{ color: "#86868b", fontSize: "13px", margin: 0, textAlign: "center" }}>
            {this.state.error?.message ?? "未知错误"}
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              marginTop: "8px",
              padding: "8px 20px",
              border: "none",
              borderRadius: "8px",
              background: "#007AFF",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            重新加载
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
