import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AuditEntry, Paged } from '@ferry/shared';
import { api } from '@/api/client';
import { dateTime } from '@/lib/format';
import { IconButton, PageLoader, SectionTitle, Select } from '@/components/ui';

const LABELS: Record<string, string> = {
  'auth.login': 'Connexion',
  'auth.login_failed': 'Échec de connexion',
  'share.created': 'Partage créé',
  'share.updated': 'Partage modifié',
  'share.deleted': 'Partage supprimé',
  'request.created': 'Demande créée',
  'request.deleted': 'Demande supprimée',
  'request.upload': 'Dépôt reçu',
  'user.created': 'Utilisateur créé',
  'user.updated': 'Utilisateur modifié',
  'user.deleted': 'Utilisateur supprimé',
  'user.password_changed': 'Mot de passe changé',
  'token.created': 'Jeton créé',
  'token.revoked': 'Jeton révoqué',
  'settings.updated': 'Réglages modifiés',
  'branding.updated': 'Logo modifié',
  'profile.created': 'Profil créé',
  'profile.updated': 'Profil modifié',
  'profile.deleted': 'Profil supprimé',
};

export default function AdminAudit() {
  const [data, setData] = useState<Paged<AuditEntry> | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  useEffect(() => {
    const q = new URLSearchParams({ page: String(page) });
    if (action) q.set('action', action);
    api.get<Paged<AuditEntry>>(`/api/admin/audit?${q}`).then(setData);
  }, [page, action]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <SectionTitle title="Journal" action={
        <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="!w-52">
          <option value="">Tous les événements</option><option value="auth">Connexions</option><option value="share">Partages</option>
          <option value="request">Demandes</option><option value="user">Utilisateurs</option><option value="settings">Réglages</option><option value="token">Jetons</option>
        </Select>
      } />
      {!data ? <PageLoader /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className=" text-left">{['Date', 'Événement', 'Utilisateur', 'Cible', 'IP', 'Détails'].map((h) => <th key={h} className="label px-4 py-3 !text-[10px]">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line-soft">
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2.5 whitespace-nowrap text-ink-3">{dateTime(e.createdAt)}</td>
                  <td className={`px-4 py-2.5 font-semibold whitespace-nowrap ${e.action.endsWith('failed') ? 'text-danger' : ''}`}>{LABELS[e.action] ?? e.action}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{e.user ? `@${e.user.username}` : '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs max-w-[180px] truncate" title={e.target ?? ''}>{e.target ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-3">{e.ip ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-ink-3 max-w-[260px] truncate" title={JSON.stringify(e.meta)}>{Object.keys(e.meta).length ? JSON.stringify(e.meta) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <IconButton label="Précédent" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /></IconButton>
          <span className="text-sm font-semibold">{page} / {pages}</span>
          <IconButton label="Suivant" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight /></IconButton>
        </div>
      )}
    </>
  );
}
