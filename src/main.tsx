import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {TonConnectUIProvider} from '@tonconnect/ui-react';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

const manifestUrl = `${window.location.origin}/api/tonconnect-manifest.json`;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <TonConnectUIProvider manifestUrl={manifestUrl} restoreConnection>
        <App />
      </TonConnectUIProvider>
    </ErrorBoundary>
  </StrictMode>,
);
