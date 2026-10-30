import { Component, ErrorInfo, ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  declare props: Readonly<Props>;
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled UI error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-[100dvh] bg-black text-white flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 text-center space-y-3">
            <h2 className="text-lg font-black">Something went wrong</h2>
            <p className="text-sm leading-relaxed text-zinc-400">
              The screen hit an unexpected error. You can try reloading the app to recover.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 min-h-11 w-full rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
