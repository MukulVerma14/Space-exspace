/**
 * App root.
 * Wraps the entire application in AuthProvider so that every route
 * (including the router itself) has access to auth state via useAuth().
 * Includes PwaUpdateBanner to show a visible prompt when a new service worker waits.
 */

import { AuthProvider } from './context/AuthContext';
import { AppRouter } from './router/AppRouter';
import { PwaUpdateBanner } from './components/PwaUpdateBanner';

export default function App() {
  return (
    <AuthProvider>
      <PwaUpdateBanner />
      <AppRouter />
    </AuthProvider>
  );
}
