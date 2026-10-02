import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, ExternalLink, FolderOpen, LayoutGrid, List, Pencil, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Paged, ShareDTO } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { dateTime, formatBytes, relative } from '@/lib/format';
import { Badge, Button, Confirm, Empty, IconButton, Input, Modal, PageLoader, SectionTitle, Segmented, Select } from '@/components/ui';
import { FileThumb } from '@/components/FileThumb';
import { EditShareModal, ShareCard, shareName, SourceBadge, StatusBadge } from '@/components/ShareCard';

export default function AdminFiles() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Paged<ShareDTO> | null>(null);
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('ferry.adminView') as 'grid' | 'list') || 'grid');
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [selected, setSelected] = useState<ShareDTO | null>(null);
  const page = Number(params.get('page') || 1);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const load = useCallback(() => {
    const q = new URLSearchParams(params);
    if (!q.get('status')) q.set('status', 'active');
    api.get<Paged<ShareDTO>>(`/api/admin/shares?${q}`).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [params]);
  useEffect(load, [load]);
  useEffect(() => { const t = setTimeout(() => { if (search !== (params.get('search') ?? '')) set('search', search); }, 300); return () => clearTimeout(t); }, [search]); // eslint-disable-line

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <SectionTitle title="Fichiers" subtitle={data ? `${data.total} partage${data.total > 1 ? 's' : ''}` : undefined}
        action={
          <Segmented value={view} onChange={(v) => { setView(v); localStorage.setItem('ferry.adminView', v); }}
            options={[{ value: 'grid', label: <LayoutGrid className="size-4" /> }, { value: 'list', label: <List className="size-4" /> }]} />
        } />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, titre, utilisateur…" className="!pl-9" />
        </div>
        <Segmented value={params.get('status') || 'active'} onChange={(v) => set('status', v)}
          options={[{ value: 'active', label: 'Actifs' }, { value: 'expired', label: 'Expirés' }, { value: 'deleted', label: 'Supprimés' }, { value: 'all', label: 'Tous' }]} />
        <Select value={params.get('source') ?? ''} onChange={(e) => set('source', e.target.value)} className="!w-40">
          <option value="">Toutes sources</option><option value="web">Web</option><option value="sharex">ShareX</option><option value="request">Dépôts</option>
        </Select>
        <Select value={params.get('type') ?? ''} onChange={(e) => set('type', e.target.value)} className="!w-40">
          <option value="">Tous types</option><option value="image">Images</option><option value="video">Vidéos</option><option value="audio">Audio</option>
          <option value="document">PDF</option><option value="archive">Archives</option><option value="other">Autres</option>
        </Select>
        {params.get('owner') && <Button size="sm" variant="ink" onClick={() => set('owner', '')}>Utilisateur filtré ✕</Button>}
      </div>

      {!data ? <PageLoader /> : data.items.length === 0 ? (
        <Empty icon={<FolderOpen className="size-6" />} title="Aucun résultat">Modifiez les filtres pour élargir la recherche.</Empty>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {data.items.map((s) => {
            const f = s.files[0];
            const live = s.status === 'ready';
            return (
              <button key={s.id} onClick={() => setSelected(s)} className={clsx('group card overflow-hidden text-left transition hover:-translate-y-0.5', !live && 'opacity-60')}>
                <div className="relative aspect-square overflow-hidden border-b-2 border-line">
                  <FileThumb mime={f?.mime ?? ''} name={f?.name ?? ''} thumb={live && f?.hasThumb ? `${f.rawUrl}?thumb` : null} kind={s.kind === 'url' ? 'url' : undefined} className="size-full" />
                  {s.fileCount > 1 && <span className="absolute right-2 top-2 rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-extrabold text-bg">{s.fileCount}</span>}
                  <div className="absolute left-2 top-2 flex gap-1"><StatusBadge s={s} /><SourceBadge s={s} /></div>
                </div>
                <div className="p-3">
                  <div className="truncate text-sm font-bold">{shareName(s)}</div>
                  <div className="mt-0.5 flex justify-between text-xs text-ink-3"><span className="truncate">@{s.owner?.username}</span><span>{formatBytes(s.totalSize)}</span></div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3">{data.items.map((s) => <ShareCard key={s.id} share={s} onChanged={load} showOwner />)}</div>
      )}

      {data && pages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3">
          <IconButton label="Précédent" disabled={page <= 1} onClick={() => set('page', String(page - 1))}><ChevronLeft /></IconButton>
          <span className="text-sm font-bold">{page} / {pages}</span>
          <IconButton label="Suivant" disabled={page >= pages} onClick={() => set('page', String(page + 1))}><ChevronRight /></IconButton>
        </div>
      )}
      {selected && <ShareDetail share={selected} onClose={() => setSelected(null)} onChanged={() => { setSelected(null); load(); }} />}
    </>
  );
}

function ShareDetail({ share, onClose, onChanged }: { share: ShareDTO; onClose: () => void; onChanged: () => void }) {
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const live = share.status === 'ready';
  const first = share.files[0];
  async function remove() {
    try { await api.del(`/api/shares/${share.id}`); toast.success('Partage supprimé'); onChanged(); } catch (err) { toast.error(errorMessage(err)); }
  }
  const rows: [string, React.ReactNode][] = [
    ['Propriétaire', share.owner ? `${share.owner.displayName} (@${share.owner.username})` : '—'],
    ['Source', share.source === 'sharex' ? 'ShareX / API' : share.source === 'request' ? 'Demande de dépôt' : 'Interface web'],
    ...(share.uploader ? [['Déposé par', `${share.uploader.name || '—'}${share.uploader.email ? ` · ${share.uploader.email}` : ''}${share.uploader.ip ? ` · ${share.uploader.ip}` : ''}`] as [string, React.ReactNode]] : []),
    ['Visibilité', `${share.visibility === 'public' ? 'Public' : 'Privé'}${share.hasPassword ? ' · mot de passe' : ''}`],
    ['Créé', dateTime(share.createdAt)],
    ['Expiration', share.expiresAt ? `${dateTime(share.expiresAt)} (${relative(share.expiresAt)})` : 'Jamais'],
    ['Téléchargements', `${share.downloads}${share.maxDownloads ? ` / ${share.maxDownloads}` : ''}`],
    ['Lien', share.url ? <span className="font-mono text-xs break-all">{share.url}</span> : '—'],
  ];
  return (
    <Modal open onClose={onClose} title={shareName(share)} width="max-w-3xl"
      footer={<>
        {share.status !== 'deleted' && <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDel(true)}>Supprimer</Button>}
        <div className="flex-1" />
        {share.status !== 'deleted' && <Button icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>Modifier</Button>}
        {live && <Button variant="ink" icon={<ExternalLink className="size-4" />} onClick={() => window.open(share.url, '_blank')}>Ouvrir</Button>}
      </>}>
      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <div>
          <FileThumb mime={first?.mime ?? ''} name={first?.name ?? ''} thumb={live && first?.hasThumb ? `${first.rawUrl}?thumb` : null} kind={share.kind === 'url' ? 'url' : undefined} className="aspect-square w-full rounded-xl border-2 border-line" />
          <div className="mt-3 flex flex-wrap gap-1"><StatusBadge s={share} /><SourceBadge s={share} />{share.kind === 'url' && <Badge>URL</Badge>}</div>
        </div>
        <div>
          <dl className="divide-y-2 divide-line-soft text-sm">
            {rows.map(([k, v]) => <div key={k} className="flex gap-4 py-2"><dt className="w-36 shrink-0 font-bold text-ink-3">{k}</dt><dd className="min-w-0 flex-1">{v}</dd></div>)}
          </dl>
          {share.kind === 'url' && <p className="mt-3 break-all text-sm">→ {share.targetUrl}</p>}
          {share.files.length > 0 && (
            <ul className="mt-4 max-h-60 overflow-y-auto rounded-xl border-2 border-line-soft divide-y-2 divide-line-soft scroll-thin">
              {share.files.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-semibold">{f.name}</span>
                  <span className="text-xs text-ink-3">{f.mime}</span>
                  <span className="w-20 text-right text-xs">{formatBytes(f.size)}</span>
                  {live && <a href={`${f.rawUrl}?preview`} target="_blank" rel="noreferrer" className="text-ink-3 hover:text-ink"><ExternalLink className="size-4" /></a>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {edit && <EditShareModal share={share} onClose={() => setEdit(false)} onSaved={onChanged} />}
      <Confirm open={del} onClose={() => setDel(false)} onConfirm={remove} title="Supprimer ce partage ?">Les fichiers seront définitivement effacés.</Confirm>
    </Modal>
  );
}
