import React, { useEffect, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';
import { api, householdAPI } from '../services/api';

interface LoginForm { email: string; password: string; }

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, setHouseholds, setCurrentHousehold } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>();

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

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    try {
      await login(data.email, data.password);
      const { data: hd } = await householdAPI.getAll();
      setHouseholds(hd.households);
      if (hd.households.length > 0) setCurrentHousehold(hd.households[0]);
      navigate('/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

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
          <h2 className="text-xl font-semibold mb-6 text-gray-900 dark:text-white">Anmelden</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">E-Mail</label>
              <input
                type="email"
                className="input"
                placeholder="deine@email.de"
                {...register('email', { required: 'E-Mail ist erforderlich' })}
              />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Passwort</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                {...register('password', { required: 'Passwort ist erforderlich' })}
              />
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
              {loading ? <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> : null}
              Anmelden
            </button>
          </form>
          <div className="my-4 flex items-center gap-3 text-gray-400 text-xs">
            <div className="h-px flex-1 bg-gray-200 dark:bg-slate-700" />
            <span>oder</span>
            <div className="h-px flex-1 bg-gray-200 dark:bg-slate-700" />
          </div>
          <button
            type="button"
            onClick={handleSsoLogin}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white py-2 font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5z" />
            </svg>
            Mit SSO anmelden
          </button>
          <div className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4 space-y-2">
            <p>
              Noch kein Konto?{' '}
              <Link to="/register" className="text-[var(--primary)] hover:underline font-medium">Registrieren</Link>
            </p>
            <p>
              <Link to="/forgot-password" className="text-[var(--primary)] hover:underline">Passwort vergessen?</Link>
            </p>
          </div>
        </div>
        <p className="text-center text-xs text-white/60 mt-4">
          <a href="https://byboernie.de" target="_blank" rel="noopener noreferrer" className="hover:text-white">byboernie.de</a>
        </p>
      </div>
    </div>
  );
}
