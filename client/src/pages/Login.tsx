import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { Me } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { Brand, ThemeSwitch } from '@/components/Layout';
import { Button, buttonClasses, Field, Input } from '@/components/ui';

const ERRORS: Record<string, string> = {
  sso_disabled: 'La connexion Microsoft n’est pas configurée.',
  sso_denied: 'Connexion Microsoft annulée ou refusée.',
  sso_state: 'Session de connexion expirée, réessayez.',
  sso_token: 'Microsoft a refusé la connexion (configuration de l’application ?).',
  sso_forbidden: 'Votre compte n’appartient à aucun groupe autorisé.',
  sso_no_account: 'Aucun compte Ferry n’est associé à cet utilisateur.',
  account_disabled: 'Ce compte est désactivé.',
};

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="size-5" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#F25022" /><rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" /><rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export default function LoginPage() {
  const { config, me, setMe } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next') || '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(ERRORS[params.get('error') ?? ''] ?? '');
  const [loading, setLoading] = useState(false);

  if (me) return <Navigate to={next} replace />;
  if (!config) return null;
  const { branding, oidc, localLogin } = config;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      setMe(await api.post<Me>('/api/auth/login', { username, password }));
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <section className="relative flex flex-col justify-between bg-accent text-accent-ink p-8 sm:p-12 lg:p-16 overflow-hidden">
        <div className="relative z-10 flex items-center justify-between">
          <div className="rounded-2xl bg-surface px-4 py-3 text-ink"><Brand /></div>
        </div>
        <div className="relative z-10 py-16 lg:py-0">
          <p className="label !text-accent-ink/70">{branding.tagline}</p>
          <h1 className="mt-4 text-5xl sm:text-6xl xl:text-7xl font-extrabold leading-[0.92]">{branding.welcome}</h1>
        </div>
        <div className="relative z-10 text-sm font-semibold opacity-70">{branding.footer}</div>
        <div aria-hidden className="pointer-events-none absolute -right-24 -bottom-24 size-[28rem] rounded-full border-[40px] border-accent-ink/10" />
        <div aria-hidden className="pointer-events-none absolute right-24 top-24 size-40 rounded-[30%] bg-accent-ink/10 rotate-12" />
      </section>

      {/* Sign-in panel */}
      <section className="flex flex-col p-8 sm:p-12 lg:p-16">
        <div className="flex justify-end"><ThemeSwitch /></div>
        <div className="my-auto w-full max-w-sm mx-auto py-12 animate-fade-up">
          <h2 className="text-4xl font-extrabold">Connexion</h2>
          <p className="mt-2 text-ink-2">Accédez à votre espace de partage.</p>

          {error && <div className="mt-6 rounded-xl border-2 border-danger bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">{error}</div>}

          <div className="mt-8 space-y-5">
            {oidc.enabled && (
              <a href={`/auth/oidc/login?next=${encodeURIComponent(next)}`} className={buttonClasses('ink', 'lg', 'w-full')}>
                <MicrosoftLogo />{oidc.buttonLabel}
              </a>
            )}
            {oidc.enabled && localLogin && (
              <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-ink-3">
                <span className="h-0.5 flex-1 bg-line-soft" />ou<span className="h-0.5 flex-1 bg-line-soft" />
              </div>
            )}
            {localLogin && (
              <form onSubmit={submit} className="space-y-4">
                <Field label="Identifiant"><Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
                <Field label="Mot de passe"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
                <Button variant={oidc.enabled ? 'outline' : 'accent'} size="lg" className="w-full" loading={loading} icon={<ArrowRight className="size-4" />}>Se connecter</Button>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
