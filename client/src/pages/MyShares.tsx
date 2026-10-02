import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FolderOpen, Plus, Search } from 'lucide-react';
import type { ShareDTO } from '@ferry/shared';
import { api } from '@/api/client';
import { buttonClasses, Empty, Input, PageLoader, SectionTitle, Segmented } from '@/components/ui';
import { ShareCard, shareName } from '@/components/ShareCard';

type Tab = 'active' | 'expired' | 'all';
type Source = '' | 'web' | 'sharex' | 'request';

export default function MySharesPage() {
  const [tab, setTab] = useState<Tab>('active');
  const [params] = useSearchParams();
  const [source, setSource] = useState<Source>((params.get('source') as Source) || '');
  const [shares, setShares] = useState<ShareDTO[] | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams({ status: tab });
    if (source) params.set('source', source);
    api.get<ShareDTO[]>(`/api/shares?${params}`).then(setShares).catch(() => setShares([]));
  }, [tab, source]);
  useEffect(() => { setShares(null); load(); }, [load]);

  const filtered = useMemo(() => {
    if (!shares || !q.trim()) return shares;
    const needle = q.toLowerCase();
    return shares.filter((s) => shareName(s).toLowerCase().includes(needle) || s.slug.toLowerCase().includes(needle) || s.files.some((f) => f.name.toLowerCase().includes(needle)));
  }, [shares, q]);

  return (
    <>
      <SectionTitle title="Mes partages" subtitle="Tout ce que vous avez envoyé ou reçu."
        action={<Link to="/" className={buttonClasses('accent', 'lg')}><Plus className="size-5" />Nouveau</Link>} />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'active', label: 'Actifs' }, { value: 'expired', label: 'Expirés' }, { value: 'all', label: 'Tous' }]} />
        <Segmented value={source} onChange={setSource} options={[{ value: '', label: 'Toutes sources' }, { value: 'web', label: 'Web' }, { value: 'sharex', label: 'ShareX' }, { value: 'request', label: 'Reçus' }]} />
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher" className="!pl-9" />
        </div>
      </div>
      {!filtered ? <PageLoader /> : filtered.length === 0 ? (
        <Empty icon={<FolderOpen className="size-6" />} title="Rien ici pour l’instant"
          action={<Link to="/" className={buttonClasses('accent')}>Envoyer des fichiers</Link>}>
          Vos partages apparaîtront ici.
        </Empty>
      ) : (
        <div className="grid gap-3">
          {filtered.map((s) => <ShareCard key={s.id} share={s} onChanged={load} />)}
        </div>
      )}
    </>
  );
}
