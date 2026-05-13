export interface ErrorBoundaryReport {
  message: string;
  componentStack: string;
}

const ERROR_BOUNDARY_REPORT_EVENT = "illama:error-boundary-report";
const MAX_COMPONENT_STACK_LINES = 8;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "未知错误";
}

function normalizeComponentStack(componentStack: string | null | undefined): string {
  return (componentStack ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPONENT_STACK_LINES)
    .join("\n");
}

export function createErrorBoundaryReport(
  error: unknown,
  componentStack: string | null | undefined,
): ErrorBoundaryReport {
  return {
    message: getErrorMessage(error),
    componentStack: normalizeComponentStack(componentStack),
  };
}

export function reportErrorBoundaryError(
  error: unknown,
  componentStack: string | null | undefined,
) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ErrorBoundaryReport>(ERROR_BOUNDARY_REPORT_EVENT, {
      detail: createErrorBoundaryReport(error, componentStack),
    }),
  );
}

export function subscribeToErrorBoundaryReports(
  listener: (report: ErrorBoundaryReport) => void,
) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleReport = (event: Event) => {
    const detail = (event as CustomEvent<ErrorBoundaryReport>).detail;
    if (!detail || typeof detail.message !== "string") {
      return;
    }
    listener({
      message: detail.message,
      componentStack: typeof detail.componentStack === "string" ? detail.componentStack : "",
    });
  };

  window.addEventListener(ERROR_BOUNDARY_REPORT_EVENT, handleReport);
  return () => window.removeEventListener(ERROR_BOUNDARY_REPORT_EVENT, handleReport);
}

export function formatErrorBoundaryLog(report: ErrorBoundaryReport): string {
  if (!report.componentStack) {
    return `界面渲染错误：${report.message}`;
  }
  return `界面渲染错误：${report.message}\n组件栈：${report.componentStack}`;
}
