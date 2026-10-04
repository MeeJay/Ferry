import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Copy, FileText, Image as ImageIcon, Lock } from 'lucide-react';
import type { Me } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { Brand, ThemeSwitch } from '@/components/Layout';
import clsx from 'clsx';
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
    <div className="relative min-h-screen overflow-hidden lg:grid lg:grid-cols-[1.15fr_1fr]">
      {/* Showcase */}
      <section className="relative hidden flex-col p-12 lg:flex xl:p-16">
        <Brand />
        <div className="relative z-10 mt-[12vh] max-w-xl">
          <p className="label !text-accent">{branding.tagline}</p>
          <h1 className="mt-5 text-4xl font-bold leading-[0.95] xl:text-5xl">
            <span className="text-grad">{branding.welcome}</span>
          </h1>
        </div>
        <Showcase />
        <div className="relative z-10 mt-auto text-sm font-semibold text-ink-3">{branding.footer}</div>
      </section>

      {/* Sign-in */}
      <section className="relative flex min-h-screen flex-col p-5 sm:p-10 lg:p-12">
        <div className="flex items-center justify-between lg:justify-end">
          <span className="lg:hidden"><Brand /></span>
          <ThemeSwitch />
        </div>
        <div className="my-auto w-full max-w-md mx-auto py-12 animate-fade-up">
          <div className="lg:hidden mb-10">
            <p className="label !text-accent">{branding.tagline}</p>
            <h1 className="mt-3 text-2xl font-bold leading-[0.95]"><span className="text-grad">{branding.welcome}</span></h1>
          </div>
          <div className="spotlight rounded-lg p-8 sm:p-10">
            <h2 className="text-xl font-bold">Connexion</h2>
            <p className="mt-2 text-ink-2">Accédez à votre espace de partage.</p>

            {error && <div className="mt-6 rounded-md bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">{error}</div>}

            <div className="mt-8 space-y-5">
              {oidc.enabled && (
                <a href={`/auth/oidc/login?next=${encodeURIComponent(next)}`} className={buttonClasses(localLogin ? 'ink' : 'accent', 'lg', 'w-full')}>
                  <MicrosoftLogo />{oidc.buttonLabel}
                </a>
              )}
              {oidc.enabled && localLogin && (
                <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-widest text-ink-3">
                  <span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" />
                </div>
              )}
              {localLogin && (
                <form onSubmit={submit} className="space-y-4">
                  <Field label="Identifiant"><Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
                  <Field label="Mot de passe"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
                  <Button variant="accent" size="lg" className="w-full" loading={loading} icon={<ArrowRight className="size-4" />}>Se connecter</Button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Decorative isometric stack of product cards — purely visual. */
function Showcase() {
  return (
    <div aria-hidden className="pointer-events-none relative my-6 h-[360px] select-none">
      <div className="absolute inset-0 [perspective:1600px]">
        <div className="absolute left-[8%] top-0 w-[620px] [transform:rotateX(52deg)_rotateZ(-32deg)] [transform-style:preserve-3d]">
          {/* Upload in progress */}
          <div className="card absolute left-6 top-6 w-[300px] p-5 [transform:translateZ(60px)]">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-md bg-grad text-white glow"><ImageIcon className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">Photos séminaire.zip</div>
                <div className="text-xs text-ink-3">1,4 Go · 72 %</div>
              </div>
            </div>
            <div className="mt-4 h-2 rounded-full bg-surface-2"><div className="h-full w-[72%] rounded-full bg-grad glow" /></div>
          </div>
          {/* Shared link */}
          <div className="card absolute left-[330px] top-0 w-[280px] p-5 [transform:translateZ(20px)]">
            <div className="label">Lien prêt</div>
            <div className="mt-3 flex items-center gap-2 rounded-md bg-surface-2 px-3 h-10 font-mono text-xs">
              <span className="text-accent">mlefevre</span>/rapport-q3-x7k2.pdf
              <Copy className="ml-auto size-3.5 text-ink-3" />
            </div>
            <div className="mt-3 flex gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2 h-6 text-[11px] font-bold uppercase tracking-wider text-success"><Check className="size-3" />Copié</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 h-6 text-[11px] font-bold uppercase tracking-wider text-ink-2"><Lock className="size-3" />Privé</span>
            </div>
          </div>
          {/* Ring */}
          <div className="card absolute left-[40px] top-[170px] flex w-[230px] items-center gap-4 p-5 [transform:translateZ(0px)]">
            <svg viewBox="0 0 36 36" className="size-20 -rotate-90">
              <defs><linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="rgb(var(--accent))" /><stop offset="1" stopColor="rgb(var(--accent-2))" /></linearGradient></defs>
              <circle cx="18" cy="18" r="14" fill="none" stroke="rgb(var(--surface-2))" strokeWidth="5" />
              <circle cx="18" cy="18" r="14" fill="none" stroke="url(#ring)" strokeWidth="5" strokeLinecap="round" strokeDasharray="62 88" />
            </svg>
            <div><div className="font-display text-lg font-bold">12</div><div className="text-xs text-ink-3">fichiers reçus</div></div>
          </div>
          {/* Bars */}
          <div className="card absolute left-[300px] top-[150px] w-[300px] p-5 [transform:translateZ(40px)]">
            <div className="flex items-end gap-1.5 h-24">
              {[30, 52, 38, 70, 46, 84, 60, 96, 72, 58].map((h, i) => (
                <div key={i} className={clsx('flex-1 rounded-t-md', i % 3 === 2 ? 'bg-grad-warm' : 'bg-grad')} style={{ height: `${h}%`, opacity: 0.55 + i * 0.045 }} />
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-ink-3"><FileText className="size-3.5" />Envois · 10 jours</div>
          </div>
        </div>
      </div>
    </div>
  );
}
