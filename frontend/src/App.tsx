/**
 * App root.
 * Wraps the entire application in AuthProvider so that every route
 * (including the router itself) has access to auth state via useAuth().
 */

import { AuthProvider } from './context/AuthContext';
import { AppRouter } from './router/AppRouter';

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
