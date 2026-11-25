/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorBoundary } from './components/ErrorBoundary';
import { ConnectedErrorBoundary } from './components/ConnectedErrorBoundary';
import { ErrorNotificationCenter } from './components/ErrorNotificationCenter';
import { HanyTechStore } from './components/HanyTechStore';
import { ErrorProvider } from './errors/ErrorContext';

export default function App() {
  return (
    <ErrorBoundary level="app" name="HANY TECH Root">
      <ErrorProvider>
        <ConnectedErrorBoundary level="app" name="واجهة المتجر">
          <HanyTechStore />
        </ConnectedErrorBoundary>
        <ErrorNotificationCenter />
      </ErrorProvider>
    </ErrorBoundary>
  );
}
