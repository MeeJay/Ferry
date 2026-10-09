import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Check, Clock, Download, FileQuestion, Hourglass, Inbox, KeyRound, Plus, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { FileDTO, ResolveResult, ShareDTO } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { BareLayout } from '@/components/Layout';
import { Button, buttonClasses, CopyLink, Field, Input, PageLoader, Progress, Textarea } from '@/components/ui';
import { FileThumb } from '@/components/FileThumb';
import { DropZone } from '@/components/DropZone';
import { TransferStats } from '@/components/TransferStats';
import { ChunkBar, ChunkLane, useChunkLane } from '@/components/ChunkLane';
import { absolute, formatBytes, relative } from '@/lib/format';
import { newId, uploadAll, type UploadItem } from '@/lib/upload';

export default function PublicPage() {
  const { pathname } = useLocation();
  const [res, setRes] = useState<ResolveResult | null>(null);
  const load = useCallback(() => {
    api.get<ResolveResult>(`/api/public/resolve?path=${encodeURIComponent(pathname)}`).then(setRes).catch(() => setRes({ kind: 'notfound' }));
  }, [pathname]);
  useEffect(() => { setRes(null); load(); }, [load]);

  if (!res) return <BareLayout><PageLoader /></BareLayout>;
  switch (res.kind) {
    case 'login': return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace />;
    case 'locked': return <BareLayout><PasswordGate path={pathname} title={res.title} onUnlocked={load} /></BareLayout>;
    case 'gone': return <BareLayout><Gone reason={res.reason} /></BareLayout>;
    case 'notfound': return <BareLayout><Message icon={<FileQuestion className="size-8" />} title="Lien introuvable">Ce lien n’existe pas ou a été supprimé.</Message></BareLayout>;
    case 'request': return <BareLayout><DropPage res={res} path={pathname} onUnlocked={load} /></BareLayout>;
    case 'share': return <BareLayout><ShareView share={res.share} owner={res.owner.displayName} fileSlug={res.fileSlug ?? null} /></BareLayout>;
  }
}

function Message({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <div className="mx-auto flex size-20 items-center justify-center rounded-lg bg-grad-soft text-accent">{icon}</div>
      <h1 className="mt-8 text-3xl font-bold">{title}</h1>
      <p className="mt-4 text-lg text-ink-2">{children}</p>
    </div>
  );
}

function Gone({ reason }: { reason: string }) {
  const text = {
    expired: 'Ce partage a expiré et ses fichiers ont été supprimés.',
    limit: 'Le nombre maximal de téléchargements a été atteint.',
    deleted: 'Ce partage a été supprimé par son propriétaire.',
    closed: 'Cette demande de dépôt est fermée.',
  }[reason] ?? 'Ce lien n’est plus disponible.';
  return <Message icon={<Hourglass className="size-8" />} title="Plus disponible">{text}</Message>;
}

function PasswordGate({ path, title, onUnlocked }: { path: string; title?: string | null; onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try { await api.post('/api/public/unlock', { path, password }); onUnlocked(); }
    catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }
  return (
    <form onSubmit={submit} className="mx-auto max-w-md py-12">
      <div className="flex size-16 items-center justify-center rounded-lg bg-grad text-white"><KeyRound className="size-8" /></div>
      <h1 className="mt-8 text-3xl font-bold">Protégé</h1>
      <p className="mt-3 text-lg text-ink-2">{title ? <>« {title} » est protégé par un mot de passe.</> : 'Ce lien est protégé par un mot de passe.'}</p>
      <div className="mt-8 flex gap-2">
        <Input autoFocus type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} placeholder="Mot de passe" className="!h-12" />
        <Button variant="accent" size="lg" loading={loading} icon={<ArrowRight className="size-5" />} />
      </div>
      {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}
    </form>
  );
}

// ── Share view ─────────────────────────────────────────────────────────────

function Preview({ file }: { file: FileDTO }) {
  const src = `${file.rawUrl}?preview`;
  const [text, setText] = useState<string | null>(null);
  const isText = (file.mime.startsWith('text/') || /json|xml|javascript|yaml|x-sh/.test(file.mime) || /\.(md|log|csv|ini|conf|ts|py|sql|ps1)$/i.test(file.name)) && file.size < 512 * 1024;
  useEffect(() => {
    if (!isText) return;
    fetch(src).then((r) => r.text()).then((t) => setText(t.slice(0, 200_000))).catch(() => setText(null));
  }, [src, isText]);

  if (/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(file.mime)) {
    return <div className="flex min-h-[240px] items-center justify-center bg-[repeating-conic-gradient(rgb(var(--surface-2))_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]"><img src={src} alt={file.name} className="max-h-[70vh] w-auto object-contain" /></div>;
  }
  if (/^video\//.test(file.mime)) return <video src={src} controls className="max-h-[70vh] w-full bg-black" />;
  if (/^audio\//.test(file.mime)) return <div className="p-8"><audio src={src} controls className="w-full" /></div>;
  if (file.mime === 'application/pdf') return <iframe src={src} title={file.name} className="h-[75vh] w-full bg-white" />;
  if (isText && text !== null) return <pre className="max-h-[70vh] overflow-auto p-5 font-mono text-[13px] leading-relaxed scroll-thin whitespace-pre-wrap break-words">{text}</pre>;
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <FileThumb mime={file.mime} name={file.name} className="size-32 rounded-lg" />
      <p className="mt-4 text-ink-3">Pas d’aperçu pour ce type de fichier.</p>
    </div>
  );
}

function ShareView({ share, owner, fileSlug }: { share: ShareDTO; owner: string; fileSlug: string | null }) {
  const single = share.files.length === 1;
  const current = fileSlug ? share.files.find((f) => f.slug === fileSlug) : single ? share.files[0] : null;
  const pageUrl = absolute(current ? current.url : share.url);

  const meta = (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-3">
      <span>Partagé par <b className="text-ink">{owner}</b></span>
      <span>{share.files.length} fichier{share.files.length > 1 ? 's' : ''} · {formatBytes(share.totalSize)}</span>
      {share.expiresAt && <span className="flex items-center gap-1"><Clock className="size-3.5" />expire {relative(share.expiresAt)}</span>}
      {share.maxDownloads && <span>{Math.max(0, share.maxDownloads - share.downloads)} téléchargement(s) restant(s)</span>}
    </div>
  );

  if (current) {
    return (
      <div className="animate-fade-up">
        {!single && <Link to={share.url} className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-ink-2 hover:text-ink"><ArrowLeft className="size-4" />{share.title || 'Tous les fichiers'}</Link>}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <h1 className="break-words text-2xl sm:text-3xl font-bold leading-[0.95]">{current.name}</h1>
            <div className="mt-3">{meta}</div>
          </div>
          <a href={`${current.rawUrl}?dl`} className={buttonClasses('accent', 'xl')}><Download className="size-5" />Télécharger <span className="opacity-70 font-semibold">{formatBytes(current.size)}</span></a>
        </div>
        {share.message && <ShareMessage text={share.message} />}
        <div className="mt-8 card overflow-hidden"><Preview file={current} /></div>
        <CopyLink url={pageUrl} className="mt-6" />
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="break-words text-2xl sm:text-4xl font-bold leading-[0.92]">{share.title || `${share.files.length} fichiers`}</h1>
          <div className="mt-3">{meta}</div>
        </div>
        <a href={`/raw${share.url}?dl`} className={buttonClasses('accent', 'xl')}><Download className="size-5" />Tout télécharger <span className="opacity-70 font-semibold">.zip</span></a>
      </div>
      {share.message && <ShareMessage text={share.message} />}
      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {share.files.map((f) => (
          <div key={f.id} className="group card overflow-hidden flex flex-col">
            <Link to={f.url} className="block aspect-[4/3] overflow-hidden">
              <FileThumb mime={f.mime} name={f.name} thumb={f.hasThumb ? `${f.rawUrl}?thumb` : null} className="size-full transition group-hover:scale-[1.03]" />
            </Link>
            <div className="flex items-center gap-2 p-3">
              <Link to={f.url} className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{f.name}</div>
                <div className="text-xs text-ink-3">{formatBytes(f.size)}</div>
              </Link>
              <a href={`${f.rawUrl}?dl`} className="flex size-9 shrink-0 items-center justify-center rounded-md bg-grad text-white hover:brightness-110" aria-label={`Télécharger ${f.name}`}><Download className="size-4" /></a>
            </div>
          </div>
        ))}
      </div>
      <CopyLink url={pageUrl} className="mt-8" />
    </div>
  );
}

function ShareMessage({ text }: { text: string }) {
  return <div className="mt-6 max-w-3xl rounded-md border-l-[6px] border-accent bg-surface px-5 py-4 text-sm whitespace-pre-wrap">{text}</div>;
}

// ── Reverse share: drop page ───────────────────────────────────────────────

function DropPage({ res, path, onUnlocked }: { res: Extract<ResolveResult, { kind: 'request' }>; path: string; onUnlocked: () => void }) {
  const r = res.request;
  const [items, setItems] = useState<UploadItem[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<'pick' | 'uploading' | 'done'>('pick');
  const [parallel, setParallel] = useState(4);
  const total = items.reduce((s, i) => s + i.file.size, 0);
  const overall = total ? items.reduce((s, i) => s + (i.progress / 100) * i.file.size, 0) / total * 100 : 0;
  const tooMany = !!r.maxFiles && items.length > r.maxFiles;
  const tooBig = !!r.maxSizeMb && total > r.maxSizeMb * 1024 * 1024;

  const add = useCallback((files: File[]) => {
    setItems((prev) => [...prev, ...files.map((file) => ({ id: newId(), file, progress: 0, status: 'queued' as const }))]);
  }, []);

  if (!res.unlocked) return <PasswordGate path={path} title={r.title} onUnlocked={onUnlocked} />;

  async function send() {
    setPhase('uploading');
    try {
      const s = await api.post<{ id: string; uploadToken: string; chunkSize: number; parallel: number }>(`/api/public/requests/${r.id}/session`, {
        name: name || null, email: email || '', message: message || null, files: items.length,
      });
      setParallel(s.parallel || 4);
      useChunkLane.getState().clear();
      await uploadAll(items, s.uploadToken, { parallel: s.parallel || 4 }, (id, patch) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i))), useChunkLane.getState().push);
      await api.post(`/api/public/requests/${r.id}/session/${s.id}/complete`, { token: s.uploadToken });
      setPhase('done');
    } catch (err) {
      toast.error(errorMessage(err), { duration: 6000 });
      setItems((prev) => prev.map((i) => ({ ...i, status: 'queued', progress: 0 })));
      setPhase('pick');
    }
  }

  if (phase === 'done') {
    return (
      <div className="mx-auto max-w-xl py-12 text-center animate-fade-up">
        <div className="mx-auto flex size-20 items-center justify-center rounded-lg bg-success text-white"><Check className="size-10" strokeWidth={3} /></div>
        <h1 className="mt-8 text-3xl sm:text-4xl font-bold leading-[0.95]">Bien reçu, merci !</h1>
        <p className="mt-4 text-lg text-ink-2">{items.length} fichier{items.length > 1 ? 's' : ''} transmis à <b className="text-ink">{res.owner.displayName}</b>.</p>
        <Button size="lg" className="mt-8" icon={<Plus className="size-5" />} onClick={() => { setItems([]); setPhase('pick'); }}>Envoyer d’autres fichiers</Button>
      </div>
    );
  }

  const busy = phase === 'uploading';
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_400px] animate-fade-up">
      <section>
        <div className="mb-3 flex items-center gap-2 label"><Inbox className="size-4" />Demande de {res.owner.displayName}</div>
        <h1 className="text-3xl sm:text-4xl font-bold leading-[0.92]">{r.title}</h1>
        {r.message && <ShareMessage text={r.message} />}
        <div className="mt-8">
          {items.length === 0 ? <DropZone onFiles={add} /> : (
            <>
              <ul className="card divide-y divide-line-soft overflow-hidden">
                {items.map((i) => (
                  <li key={i.id} className="flex items-center gap-4 px-4 py-3">
                    <FileThumb mime={i.file.type} name={i.file.name} className="size-10 rounded-md shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{i.file.name}</div>
                      <div className="text-xs text-ink-3">{formatBytes(i.file.size)}{i.error && <span className="ml-2 text-danger">{i.error}</span>}</div>
                      {i.status === 'uploading' && <ChunkBar item={i} />}
                    </div>
                    {i.status === 'done' ? <Check className="size-5 text-success" /> : !busy && (
                      <button onClick={() => setItems(items.filter((x) => x.id !== i.id))} className="text-ink-3 hover:text-danger" aria-label="Retirer"><X className="size-5" /></button>
                    )}
                  </li>
                ))}
              </ul>
              {!busy && <DropZone onFiles={add} compact className="mt-4"><div className="flex items-center justify-center gap-2 font-semibold text-ink-2"><Plus className="size-5" />Ajouter des fichiers</div></DropZone>}
            </>
          )}
        </div>
      </section>
      <aside className={clsx('space-y-4 lg:pt-16', busy && 'opacity-60 pointer-events-none')}>
        <div className="card p-5 space-y-4">
          <Field label="Votre nom"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
          <Field label="Votre e-mail" hint="Optionnel"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
          <Field label="Message"><Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        </div>
        <div className="text-sm text-ink-3 space-y-1">
          {r.maxFiles && <div className={clsx(tooMany && 'text-danger font-semibold')}>{items.length} / {r.maxFiles} fichier(s) maximum</div>}
          {r.maxSizeMb && <div className={clsx(tooBig && 'text-danger font-semibold')}>{formatBytes(total)} / {formatBytes(r.maxSizeMb * 1024 * 1024)} maximum</div>}
          {r.expiresAt && <div>Lien valable jusqu’au {new Date(r.expiresAt).toLocaleDateString('fr-FR')}</div>}
        </div>
        {busy && <div><ChunkLane parallel={parallel} /><Progress value={overall} className="!h-3" /><TransferStats items={items} active={busy} /></div>}
        <Button variant="accent" size="xl" className="w-full" icon={<Send className="size-5" />} loading={busy}
          disabled={!items.length || tooMany || tooBig} onClick={send}>
          {busy ? `${Math.round(overall)} %` : 'Envoyer'}
        </Button>
      </aside>
    </div>
  );
}
