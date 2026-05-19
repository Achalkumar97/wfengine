import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary to catch React render errors and prevent blank screen crashes.
 * Wraps the entire app to provide fallback UI instead of silent failures.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    // In production, you might want to send this to an error tracking service
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#0c0c10] text-zinc-300">
          <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 px-6 py-4">
            <h1 className="text-lg font-semibold text-rose-300">Something went wrong</h1>
            <p className="mt-2 text-sm text-zinc-400">
              The application encountered an unexpected error. Please refresh the page.
            </p>
            {this.state.error && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
                  Error details
                </summary>
                <pre className="mt-2 overflow-auto rounded bg-black/30 p-2 text-[11px] text-rose-200">
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
