import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    api.get('/config').then(r => setOidcEnabled(!!r.data.oidcEnabled)).catch(() => {});
  }, []);

  // SSO error from backend redirect (?sso_error=...)
  useEffect(() => {
    const ssoError = searchParams.get('sso_error');
    if (ssoError) {
      toast.error(ssoError);
      window.history.replaceState(null, '', '/login');
    }
  }, [searchParams]);

  // SSO success: Backend redirected with #token=<jwt>
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const token = hash.get('token');
    if (!token) return;
    localStorage.setItem('auth_token', token);
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    window.history.replaceState(null, '', '/login');
    useAuthStore.getState().loadStoredAuth().then(() => navigate('/'));
  }, [navigate]);

  const handleSsoLogin = () => {
    const apiBase = (api.defaults.baseURL || '/api').replace(/\/$/, '');
    window.location.href = `${apiBase}/auth/oidc/login`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-400 to-purple-600 dark:from-blue-900 dark:to-slate-900 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">💰</div>
          <h1 className="text-3xl font-bold text-white">Haushaltsbuch</h1>
          <p className="text-white/80 mt-2">Deine Finanzen im Blick</p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white text-center">Anmelden</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">
            Anmeldung erfolgt zentral über Authentik.
          </p>
          <button
            type="button"
            onClick={handleSsoLogin}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5z" />
            </svg>
            Mit Authentik anmelden
          </button>
          {!oidcEnabled && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-3 text-center">
              Hinweis: SSO ist serverseitig nicht konfiguriert (OIDC_*-Env fehlt).
            </p>
          )}
        </div>
        <p className="text-center text-xs text-white/60 mt-4">
          <a href="https://byboernie.de" target="_blank" rel="noopener noreferrer" className="hover:text-white">byboernie.de</a>
        </p>
      </div>
    </div>
  );
}
