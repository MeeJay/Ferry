import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Check, ChevronDown, Eye, EyeOff, Globe, KeyRound, Lock, Plus, RotateCcw, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { LinkOptions, ShareDTO, Visibility } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { Button, buttonClasses, CopyLink, Field, Input, Progress, Segmented, Textarea, Toggle } from '@/components/ui';
import { DropZone } from '@/components/DropZone';
import { FileThumb } from '@/components/FileThumb';
import { UserLinkEditor } from '@/components/LinkPolicy';
import { RecipientsInput } from '@/components/RecipientsInput';
import { absolute, EXPIRY_PRESETS, expiryLabel, formatBytes } from '@/lib/format';
import { newId, uploadAll, type UploadItem } from '@/lib/upload';

type Phase = 'pick' | 'configure' | 'uploading' | 'done';

export default function UploadPage() {
  const me = useApp((s) => s.me)!;
  const limits = me.limits;
  const [phase, setPhase] = useState<Phase>('pick');
  const [items, setItems] = useState<UploadItem[]>([]);
  const [result, setResult] = useState<ShareDTO | null>(null);

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [visibility, setVisibility] = useState<Visibility>(limits.defaultVisibility === 'public' && limits.allowPublic ? 'public' : 'private');
  const [expiry, setExpiry] = useState(limits.defaultExpiryHours);
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [maxDownloads, setMaxDownloads] = useState('');
  const [notify, setNotify] = useState(false);
  const [recipients, setRecipients] = useState<string[]>([]);
  const mailEnabled = useApp((s) => s.config?.mailEnabled);
  const [linkOverride, setLinkOverride] = useState<Partial<LinkOptions>>({});
  const [showLink, setShowLink] = useState(false);

  const total = items.reduce((s, i) => s + i.file.size, 0);
  const presets = useMemo(() => {
    const list = EXPIRY_PRESETS.filter((p) => (p.hours === 0 ? limits.allowNeverExpire : limits.maxExpiryHours === 0 || p.hours <= limits.maxExpiryHours));
    if (!list.some((p) => p.hours === limits.defaultExpiryHours)) list.push({ label: expiryLabel(limits.defaultExpiryHours), hours: limits.defaultExpiryHours });
    return list.sort((a, b) => (a.hours || 1e9) - (b.hours || 1e9));
  }, [limits]);

  const problems = useMemo(() => {
    const p: string[] = [];
    if (limits.maxFileSize && items.some((i) => i.file.size > limits.maxFileSize)) p.push(`Fichier trop gros (max ${formatBytes(limits.maxFileSize)})`);
    if (limits.maxShareSize && total > limits.maxShareSize) p.push(`Partage trop volumineux (max ${formatBytes(limits.maxShareSize)})`);
    if (limits.storageQuota && limits.storageUsed + total > limits.storageQuota) p.push('Quota de stockage insuffisant');
    return p;
  }, [items, total, limits]);

  const addFiles = useCallback((files: File[]) => {
    setItems((prev) => {
      const known = new Set(prev.map((i) => `${i.file.name}:${i.file.size}`));
      return [...prev, ...files.filter((f) => !known.has(`${f.name}:${f.size}`)).map((file) => ({ id: newId(), file, progress: 0, status: 'queued' as const }))];
    });
    setPhase((p) => (p === 'pick' || p === 'done' ? 'configure' : p));
  }, []);

  function reset() {
    setItems([]); setResult(null); setTitle(''); setMessage(''); setPassword(''); setUsePassword(false);
    setMaxDownloads(''); setNotify(false); setRecipients([]); setLinkOverride({}); setPhase('pick');
  }

  async function send() {
    setPhase('uploading');
    try {
      const share = await api.post<{ id: string; uploadToken: string; chunkSize: number }>('/api/shares', {
        title: title || null,
        message: message || null,
        visibility,
        expiryHours: expiry,
        password: usePassword && password ? password : null,
        maxDownloads: maxDownloads ? Number(maxDownloads) : null,
        notifyOnDownload: notify,
        linkOverride: Object.keys(linkOverride).length ? linkOverride : null,
        files: items.map((i) => ({ name: i.file.name, size: i.file.size })),
      });
      const update = (id: string, patch: Partial<UploadItem>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
      await uploadAll(items, share.uploadToken, share.chunkSize, update);
      const done = await api.post<ShareDTO>(`/api/shares/${share.id}/finalize`, { recipients });
      setResult(done);
      setPhase('done');
      useApp.getState().refreshMe();
    } catch (err) {
      toast.error(errorMessage(err), { duration: 6000 });
      setItems((prev) => prev.map((i) => ({ ...i, status: 'queued', progress: 0 })));
      setPhase('configure');
    }
  }

  const overall = items.length ? items.reduce((s, i) => s + (i.progress / 100) * i.file.size, 0) / Math.max(1, total) * 100 : 0;

  // ── Done ──
  if (phase === 'done' && result) {
    const url = absolute(result.url);
    return (
      <div className="mx-auto max-w-3xl animate-fade-up">
        <div className="flex size-14 items-center justify-center rounded-lg bg-success text-white"><Check className="size-9" strokeWidth={3} /></div>
        <h1 className="mt-6 text-3xl sm:text-4xl font-bold leading-[0.95]">C’est en ligne.</h1>
        <p className="mt-3 text-lg text-ink-2">
          {result.fileCount} fichier{result.fileCount > 1 ? 's' : ''} · {formatBytes(result.totalSize)} ·{' '}
          {result.visibility === 'public' ? 'public' : 'privé, réservé aux comptes'}
          {result.expiresAt ? ` · expire le ${new Date(result.expiresAt).toLocaleDateString('fr-FR')}` : ' · sans expiration'}
          {recipients.length > 0 && ` · envoyé par e-mail à ${recipients.length} destinataire${recipients.length > 1 ? 's' : ''}`}
        </p>
        <CopyLink url={url} size="lg" className="mt-8" />
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="accent" size="lg" icon={<Plus className="size-5" />} onClick={reset}>Nouveau partage</Button>
          <a href={result.url} target="_blank" rel="noreferrer" className={buttonClasses('outline', 'lg')}>Ouvrir la page</a>
          <Link to="/my" className={buttonClasses('ghost', 'lg')}>Mes partages</Link>
        </div>
      </div>
    );
  }

  // ── Pick ──
  if (phase === 'pick') {
    return (
      <div className="animate-fade-up">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <h1 className="text-3xl sm:text-5xl font-bold leading-[0.9]">Envoyer<span className="text-grad">.</span></h1>
          <div className="lg:hidden"><QuotaMeter used={limits.storageUsed} quota={limits.storageQuota} /></div>
        </div>
        <DropZone onFiles={addFiles} />
        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-ink-3">
          {limits.maxFileSize > 0 && <span>Jusqu’à <b className="text-ink">{formatBytes(limits.maxFileSize)}</b> par fichier</span>}
          <span>Expiration par défaut : <b className="text-ink">{expiryLabel(limits.defaultExpiryHours)}</b></span>
          <span>Privé par défaut : <b className="text-ink">réservé aux comptes</b></span>
        </div>
      </div>
    );
  }

  // ── Configure / uploading ──
  const busy = phase === 'uploading';
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px] animate-fade-up">
      <section>
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold leading-[0.95]">{busy ? 'Envoi en cours…' : `${items.length} fichier${items.length > 1 ? 's' : ''}`}</h1>
            <p className="mt-2 text-ink-2 font-semibold">{formatBytes(total)}</p>
          </div>
          {!busy && <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={reset}>Tout retirer</Button>}
        </div>

        {busy && <Progress value={overall} className="!h-3 mb-6" />}

        <ul className="card divide-y divide-line-soft overflow-hidden">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-4 px-4 py-3">
              <FileThumb mime={i.file.type} name={i.file.name} className="size-10 rounded-md shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{i.file.name}</div>
                <div className="flex items-center gap-3 text-xs text-ink-3">
                  <span>{formatBytes(i.file.size)}</span>
                  {i.status === 'error' && <span className="text-danger font-semibold">{i.error}</span>}
                  {limits.maxFileSize > 0 && i.file.size > limits.maxFileSize && <span className="text-danger font-semibold">Trop volumineux</span>}
                </div>
                {i.status === 'uploading' && <Progress value={i.progress} className="mt-2 !h-1.5" />}
              </div>
              {i.status === 'done' ? <Check className="size-5 text-success" strokeWidth={3} /> : !busy && (
                <button onClick={() => setItems(items.filter((x) => x.id !== i.id))} className="text-ink-3 hover:text-danger" aria-label="Retirer"><X className="size-5" /></button>
              )}
            </li>
          ))}
        </ul>

        {!busy && <DropZone onFiles={addFiles} compact className="mt-4"><div className="flex items-center justify-center gap-2 font-semibold text-ink-2"><Plus className="size-5" /> Ajouter des fichiers</div></DropZone>}
      </section>

      <aside className={clsx('space-y-6', busy && 'opacity-60 pointer-events-none')}>
        <div className="card p-5 space-y-5">
          <div>
            <div className="label mb-2">Visibilité</div>
            <div className="grid grid-cols-2 gap-2">
              <VisibilityCard active={visibility === 'private'} onClick={() => setVisibility('private')} icon={<Lock className="size-4" />} title="Privé" text="Comptes uniquement" />
              <VisibilityCard active={visibility === 'public'} disabled={!limits.allowPublic} onClick={() => setVisibility('public')} icon={<Globe className="size-4" />} title="Public" text={limits.allowPublic ? 'Toute personne avec le lien' : 'Désactivé'} />
            </div>
          </div>
          <div>
            <div className="label mb-2">Expiration</div>
            <Segmented size="sm" value={expiry} onChange={setExpiry} options={presets.map((p) => ({ value: p.hours, label: p.label }))} />
          </div>
          {items.length > 1 && (
            <Field label="Titre du partage"><Input placeholder="Ex. Photos du séminaire" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          )}
        </div>

        <div className="card p-5 space-y-4">
          <Toggle checked={usePassword} onChange={setUsePassword} label={<span className="flex items-center gap-2"><KeyRound className="size-4" />Mot de passe</span>} />
          {usePassword && (
            <div className="relative">
              <Input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe du lien" autoComplete="new-password" />
              <button className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" onClick={() => setShowPassword(!showPassword)} type="button">
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          )}
          <Field label="Limite de téléchargements" hint="Vide = illimité">
            <Input type="number" min={0} value={maxDownloads} onChange={(e) => setMaxDownloads(e.target.value)} placeholder="Illimité" />
          </Field>
          <Field label="Message"><Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Affiché sur la page de téléchargement" /></Field>
          {mailEnabled && (
            <Field label="Envoyer le lien par e-mail" hint="Entrée ou virgule pour ajouter une adresse">
              <RecipientsInput value={recipients} onChange={setRecipients} />
            </Field>
          )}
          <Toggle checked={notify} onChange={setNotify} label="M’avertir au premier téléchargement" description={me.email ? me.email : 'Aucune adresse mail sur votre compte'} disabled={!me.email} />
        </div>

        <div className="card overflow-hidden">
          <button onClick={() => setShowLink(!showLink)} className="flex w-full items-center justify-between px-5 h-11 font-semibold">
            Format du lien <ChevronDown className={clsx('size-5 transition', showLink && 'rotate-180')} />
          </button>
          {showLink && (
            <div className="px-5 pb-5">
              <UserLinkEditor source="web" compact policy={me.linkPolicies.web} value={linkOverride} onChange={setLinkOverride}
                identity={{ username: me.username, userCode: me.userCode, vanity: me.vanity }}
                publicMin={visibility === 'public' ? me.publicMinRandom : 0} />
            </div>
          )}
        </div>

        {problems.length > 0 && <div className="rounded-md bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">{problems.join(' · ')}</div>}
        <Button variant="accent" size="xl" className="w-full" disabled={!items.length || problems.length > 0} loading={busy}
          icon={<Send className="size-5" />} onClick={send}>
          {busy ? `${Math.round(overall)} %` : 'Envoyer'}
        </Button>
      </aside>
    </div>
  );
}

function VisibilityCard({ active, onClick, icon, title, text, disabled }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; text: string; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={clsx('rounded-md p-3 text-left transition disabled:opacity-40',
        active ? ' bg-grad text-white glow' : 'bg-surface-2 hover:bg-surface-3')}>
      <div className="flex items-center gap-2 font-bold">{icon}{title}</div>
      <div className={clsx('mt-1 text-xs', active ? 'text-white/75' : 'text-ink-3')}>{text}</div>
    </button>
  );
}

export function QuotaMeter({ used, quota }: { used: number; quota: number }) {
  if (!quota) return <div className="text-sm text-ink-3"><b className="text-ink">{formatBytes(used)}</b> utilisés</div>;
  const pct = (used / quota) * 100;
  return (
    <div className="w-56">
      <div className="mb-1.5 flex justify-between text-xs font-semibold"><span>{formatBytes(used)}</span><span className="text-ink-3">{formatBytes(quota)}</span></div>
      <Progress value={pct} />
    </div>
  );
}
