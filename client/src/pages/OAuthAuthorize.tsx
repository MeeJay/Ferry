import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { CircleAlert, Check, Plug, ShieldCheck } from 'lucide-react';
import type { AiKeyScope, AiOAuthAuthorizeInfo } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { Button, PageLoader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { AccountShell, Notice } from './Register';

// /oauth/authorize — consent page of a Claude connector (server: services/oauth.ts).
// Claude sends the owner here from « Connect »; signed out → login, then back here.
// Approving lets that client act through the connector: its rights, the owner's limits.

const SCOPE_LABELS: Record<AiKeyScope, string> = {
  upload: 'Envoyer des fichiers et gérer ses envois (mot de passe, expiration, envoi par e-mail)',
  read: 'Lire vos partages et leurs liens',
  delete: 'Supprimer les partages envoyés par un agent (jamais les vôtres)',
};

export default function OAuthAuthorizePage() {
  const me = useApp((s) => s.me);
  const location = useLocation();
  const [info, setInfo] = useState<AiOAuthAuthorizeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const params = useMemo(() => Object.fromEntries(new URLSearchParams(location.search)), [location.search]);

  useEffect(() => {
    if (!me) return;
    api.get<AiOAuthAuthorizeInfo>(`/api/oauth/authorize${location.search}`).then(setInfo).catch((err) => setError(errorMessage(err)));
  }, [me, location.search]);

  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;

  async function decide(approve: boolean) {
    setBusy(approve ? 'approve' : 'deny');
    try {
      const { redirectUrl } = await api.post<{ redirectUrl: string }>('/api/oauth/authorize', { ...params, approve });
      window.location.assign(redirectUrl);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <AccountShell>
      {error ? (
        <Notice icon={<CircleAlert />} title="Autorisation impossible">{error}</Notice>
      ) : !info ? <PageLoader /> : (
        <div className="spotlight space-y-6 rounded-lg p-8">
          <div className="text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-grad text-white"><Plug className="size-6" /></div>
            <h1 className="mt-5 text-xl font-bold">Connecter une application</h1>
            <p className="mt-2 text-sm text-ink-2">
              <span className="font-semibold text-ink">{info.redirectHost}</span> demande à utiliser le connecteur « {info.connector.name} ».
            </p>
          </div>
          <div>
            <div className="label mb-2">Il pourra</div>
            <ul className="space-y-1.5">
              {info.connector.scopes.map((s) => (
                <li key={s} className="flex items-start gap-2 text-sm text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-accent" />{SCOPE_LABELS[s]}</li>
              ))}
            </ul>
          </div>
          <p className="flex items-start gap-2 rounded-md bg-surface-2 p-3 text-xs text-ink-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>
              Il agit en votre nom ({me.displayName || me.username}), dans vos limites, et n’ouvre rien d’autre que l’envoi et la lecture de partages.
              {info.connector.expiresAt ? ` Le connecteur expire le ${dateTime(info.connector.expiresAt)}.` : ''} Révocable à tout moment dans Paramètres → Agents IA.
            </span>
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" loading={busy === 'deny'} disabled={busy !== null} onClick={() => void decide(false)}>Refuser</Button>
            <Button variant="accent" loading={busy === 'approve'} disabled={busy !== null} onClick={() => void decide(true)}>Autoriser</Button>
          </div>
        </div>
      )}
    </AccountShell>
  );
}
