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
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
              Please close and reopen the app.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
