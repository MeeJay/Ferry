import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Clock, Mail, MailCheck, ShieldCheck, UserPlus } from 'lucide-react';
import type { InvitePreview, RegisterResult } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { Brand, ThemeSwitch } from '@/components/Layout';
import { Button, Field, Input, PageLoader } from '@/components/ui';

/** Shared chrome for the account pages (register, e-mail verification). */
export function AccountShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col p-6 sm:p-10">
      <div className="flex items-center justify-between"><Link to="/login"><Brand /></Link><ThemeSwitch /></div>
      <div className="mx-auto my-auto w-full max-w-md py-12 animate-fade-up">{children}</div>
    </div>
  );
}

export function Notice({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="spotlight rounded-lg p-8 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-grad text-white [&>svg]:size-6">{icon}</div>
      <h1 className="mt-5 text-xl font-bold">{title}</h1>
      <div className="mt-2 text-sm text-ink-2">{children}</div>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export default function RegisterPage() {
  const { config, me, setMe } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const inviteToken = params.get('invite');
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [loadingInvite, setLoadingInvite] = useState(!!inviteToken);
  const [form, setForm] = useState({ username: '', displayName: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RegisterResult['status'] | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!inviteToken) return;
    api.get<InvitePreview>(`/api/auth/invite/${encodeURIComponent(inviteToken)}`)
      .then((p) => { setInvite(p); setForm((f) => ({ ...f, email: p.email ?? f.email, displayName: p.displayName ?? f.displayName })); })
      .catch((err) => setInviteError(errorMessage(err)))
      .finally(() => setLoadingInvite(false));
  }, [inviteToken]);

  if (me) return <Navigate to="/" replace />;
  if (!config) return null;
  if (loadingInvite) return <AccountShell><PageLoader /></AccountShell>;

  const reg = config.registration;
  if (inviteToken && inviteError) {
    return <AccountShell><Notice icon={<Clock />} title="Invitation indisponible" action={<Link to="/login" className="text-sm font-semibold text-accent">Retour à la connexion</Link>}>{inviteError}</Notice></AccountShell>;
  }
  if (!inviteToken && !reg.enabled) {
    return <AccountShell><Notice icon={<ShieldCheck />} title="Inscriptions fermées" action={<Link to="/login" className="text-sm font-semibold text-accent">Retour à la connexion</Link>}>Les comptes sont créés par un administrateur. Demandez-lui une invitation.</Notice></AccountShell>;
  }
  if (result === 'verify_email') {
    return <AccountShell><Notice icon={<Mail />} title="Vérifiez votre boîte mail">Un lien de confirmation a été envoyé à <b className="text-ink">{form.email}</b>. Il est valable 48 heures.{reg.requiresApproval && ' Un administrateur validera ensuite votre compte.'}</Notice></AccountShell>;
  }
  if (result === 'pending_approval') {
    return <AccountShell><Notice icon={<Clock />} title="Compte en attente de validation" action={<Link to="/login" className="text-sm font-semibold text-accent">Retour à la connexion</Link>}>Un administrateur doit valider votre compte. Vous recevrez un e-mail dès qu’il sera activé.</Notice></AccountShell>;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) return setError('Les mots de passe ne correspondent pas');
    setBusy(true);
    setError('');
    try {
      const r = await api.post<RegisterResult>('/api/auth/register', {
        username: form.username, displayName: form.displayName, email: form.email, password: form.password,
        ...(inviteToken ? { invite: inviteToken } : {}),
      });
      if (r.status === 'active') { setMe(r.me); navigate('/', { replace: true }); } else setResult(r.status);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  const domains = !invite && reg.allowedDomains.length ? reg.allowedDomains.map((d) => `@${d}`).join(', ') : null;
  return (
    <AccountShell>
      <div className="spotlight rounded-lg p-8 sm:p-10">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-grad text-white"><UserPlus className="size-5" /></span>
          <div>
            <h1 className="text-xl font-bold">Créer un compte</h1>
            <p className="text-sm text-ink-2">{config.branding.name}</p>
          </div>
        </div>
        {invite && (
          <div className="mt-6 rounded-md bg-grad-soft px-4 py-3 text-sm">
            <b>{invite.invitedBy ?? 'Un administrateur'}</b> vous invite{invite.profileName ? <> — profil <b>{invite.profileName}</b></> : null}.
            <div className="text-xs text-ink-3">Invitation valable jusqu’au {new Date(invite.expiresAt).toLocaleDateString('fr-FR')}.</div>
          </div>
        )}
        {error && <div className="mt-5 rounded-md bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">{error}</div>}
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom affiché"><Input autoFocus autoComplete="name" value={form.displayName} onChange={(e) => set('displayName', e.target.value)} required /></Field>
            <Field label="Identifiant" hint="Sert aussi dans vos liens."><Input autoComplete="username" value={form.username} onChange={(e) => set('username', e.target.value.toLowerCase().replace(/\s/g, ''))} className="font-mono" required /></Field>
          </div>
          <Field label="Adresse e-mail" hint={domains ? `Réservé aux adresses ${domains}` : invite?.email ? 'Fixée par l’invitation' : undefined}>
            <Input type="email" autoComplete="email" value={form.email} disabled={!!invite?.email} onChange={(e) => set('email', e.target.value)} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mot de passe" hint="8 caractères minimum"><Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} required /></Field>
            <Field label="Confirmation"><Input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} required /></Field>
          </div>
          {!invite && (reg.requiresEmail || reg.requiresApproval) && (
            <p className="flex items-start gap-2 text-xs text-ink-3">
              <MailCheck className="mt-px size-3.5 shrink-0" />
              {reg.requiresEmail && reg.requiresApproval ? 'Vous confirmerez votre adresse, puis un administrateur validera le compte.'
                : reg.requiresEmail ? 'Vous recevrez un lien pour confirmer votre adresse.' : 'Un administrateur validera votre compte avant la première connexion.'}
            </p>
          )}
          <Button variant="accent" size="lg" className="w-full" loading={busy} disabled={form.password.length < 8} icon={<ArrowRight className="size-4" />}>Créer mon compte</Button>
        </form>
        <p className="mt-6 text-center text-sm text-ink-3">Déjà un compte ? <Link to="/login" className="font-semibold text-accent">Se connecter</Link></p>
      </div>
    </AccountShell>
  );
}
