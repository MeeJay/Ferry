import { useState } from 'react';
import clsx from 'clsx';
import { Download, ExternalLink, Globe, Inbox, KeyRound, Lock, Pencil, Trash2, Terminal } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ShareDTO, Visibility } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { absolute, EXPIRY_PRESETS, formatBytes, relative, dateTime } from '@/lib/format';
import { Badge, Button, Confirm, copyText, Field, IconButton, Input, Modal, Segmented, Textarea, Toggle } from './ui';
import { FileThumb } from './FileThumb';

export function shareName(s: ShareDTO) {
  if (s.kind === 'url') return s.targetUrl ?? s.title ?? 'Lien';
  if (s.fileCount === 1 && s.files[0]) return s.files[0].name;
  return s.title || `${s.fileCount} fichiers`;
}

export function StatusBadge({ s }: { s: ShareDTO }) {
  if (s.status === 'deleted') return <Badge tone="danger">Supprimé</Badge>;
  if (s.status === 'expired') return <Badge tone="warn">Expiré</Badge>;
  return null;
}

export function SourceBadge({ s }: { s: ShareDTO }) {
  if (s.source === 'sharex') return <Badge><Terminal className="size-3" />ShareX</Badge>;
  if (s.source === 'request') return <Badge tone="accent"><Inbox className="size-3" />Dépôt</Badge>;
  return null;
}

export function ShareCard({ share, onChanged, showOwner }: { share: ShareDTO; onChanged: () => void; showOwner?: boolean }) {
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const live = share.status === 'ready';
  const first = share.files[0];
  const thumb = first?.hasThumb && live ? `${first.rawUrl}?thumb` : null;

  async function remove() {
    setDeleting(true);
    try {
      await api.del(`/api/shares/${share.id}`);
      toast.success('Partage supprimé');
      onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setDeleting(false); setDel(false); }
  }

  return (
    <div className={clsx('card flex items-stretch overflow-hidden transition hover:-translate-y-0.5', !live && 'opacity-70')}>
      <FileThumb mime={first?.mime ?? ''} name={first?.name ?? ''} thumb={thumb} kind={share.kind === 'url' ? 'url' : undefined}
        className="w-20 sm:w-28 shrink-0" />
      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[15px] font-semibold">{shareName(share)}</span>
              <StatusBadge s={share} /><SourceBadge s={share} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-3">
              {share.kind === 'files' && <span>{share.fileCount} fichier{share.fileCount > 1 ? 's' : ''} · {formatBytes(share.totalSize)}</span>}
              <span className="flex items-center gap-1">{share.visibility === 'public' ? <Globe className="size-3.5" /> : <Lock className="size-3.5" />}{share.visibility === 'public' ? 'Public' : 'Privé'}</span>
              {share.hasPassword && <span className="flex items-center gap-1"><KeyRound className="size-3.5" />Mot de passe</span>}
              <span className="flex items-center gap-1"><Download className="size-3.5" />{share.downloads}{share.maxDownloads ? ` / ${share.maxDownloads}` : ''}</span>
              <span title={dateTime(share.expiresAt)}>{share.expiresAt ? (live ? `expire ${relative(share.expiresAt)}` : `expiré ${relative(share.expiresAt)}`) : 'sans expiration'}</span>
              {showOwner && share.owner && <span className="font-semibold text-ink-2">@{share.owner.username}</span>}
              {share.uploader && <span className="font-semibold text-ink-2">de {share.uploader.name || share.uploader.email || 'anonyme'}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            {live && <IconButton label="Ouvrir" onClick={() => window.open(share.url, '_blank')}><ExternalLink className="size-4" /></IconButton>}
            {share.status !== 'deleted' && <IconButton label="Modifier" onClick={() => setEdit(true)}><Pencil className="size-4" /></IconButton>}
            {share.status !== 'deleted' && <IconButton label="Supprimer" className="hover:!text-danger" onClick={() => setDel(true)}><Trash2 className="size-4" /></IconButton>}
          </div>
        </div>
        {live && share.url && (
          <button onClick={() => copyText(absolute(share.url))} className="mt-3 max-w-full truncate rounded-md bg-surface-2 px-2.5 h-8 font-mono text-[12px] text-ink-2 hover:text-ink hover:bg-ink/10 transition" title="Copier le lien">
            {window.location.host}{share.url}
          </button>
        )}
      </div>
      {edit && <EditShareModal share={share} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); onChanged(); }} />}
      <Confirm open={del} onClose={() => setDel(false)} onConfirm={remove} loading={deleting} title="Supprimer ce partage ?">
        Les fichiers seront définitivement effacés et le lien cessera de fonctionner.
      </Confirm>
    </div>
  );
}

export function EditShareModal({ share, onClose, onSaved }: { share: ShareDTO; onClose: () => void; onSaved: () => void }) {
  const me = useApp((s) => s.me)!;
  const [title, setTitle] = useState(share.title ?? '');
  const [message, setMessage] = useState(share.message ?? '');
  const [visibility, setVisibility] = useState<Visibility>(share.visibility);
  const [extend, setExtend] = useState<number | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [removePassword, setRemovePassword] = useState(false);
  const [maxDownloads, setMaxDownloads] = useState(share.maxDownloads ? String(share.maxDownloads) : '');
  const [notify, setNotify] = useState(!!share.notifyOnDownload);
  const [saving, setSaving] = useState(false);
  const presets = EXPIRY_PRESETS.filter((p) => (p.hours === 0 ? me.limits.allowNeverExpire : !me.limits.maxExpiryHours || p.hours <= me.limits.maxExpiryHours));

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/api/shares/${share.id}`, {
        title, message, maxDownloads: maxDownloads ? Number(maxDownloads) : null, notifyOnDownload: notify,
        ...(share.source !== 'request' ? { visibility } : {}),
        ...(extend !== null ? { expiryHours: extend } : {}),
        ...(removePassword ? { password: null } : password ? { password } : {}),
      });
      toast.success('Partage mis à jour');
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title="Modifier le partage"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="accent" loading={saving} onClick={save}>Enregistrer</Button></>}>
      <div className="space-y-5">
        <Field label="Titre"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        {share.source !== 'request' && (
          <Field label="Visibilité">
            <Segmented value={visibility} onChange={setVisibility} options={[
              { value: 'private', label: 'Privé' },
              ...(me.limits.allowPublic || share.visibility === 'public' ? [{ value: 'public' as const, label: 'Public' }] : []),
            ]} />
          </Field>
        )}
        {share.status === 'ready' && (
          <Field label="Nouvelle expiration (à partir de maintenant)" hint={`Actuellement : ${share.expiresAt ? dateTime(share.expiresAt) : 'jamais'}`}>
            <Segmented size="sm" value={extend ?? -1} onChange={(v) => setExtend(v === -1 ? null : v)}
              options={[{ value: -1, label: 'Inchangée' }, ...presets.map((p) => ({ value: p.hours, label: p.label }))]} />
          </Field>
        )}
        <Field label="Mot de passe" hint={share.hasPassword ? 'Un mot de passe est défini.' : 'Aucun mot de passe.'}>
          <div className="flex gap-2">
            <Input type="password" placeholder={share.hasPassword ? 'Nouveau mot de passe' : 'Définir un mot de passe'} value={password ?? ''} disabled={removePassword}
              onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            {share.hasPassword && <Button variant={removePassword ? 'ink' : 'outline'} onClick={() => setRemovePassword(!removePassword)}>Retirer</Button>}
          </div>
        </Field>
        <Field label="Limite de téléchargements" hint="Vide = illimité"><Input type="number" min={0} value={maxDownloads} onChange={(e) => setMaxDownloads(e.target.value)} /></Field>
        <Field label="Message"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <Toggle checked={notify} onChange={setNotify} label="M’avertir au premier téléchargement" />
      </div>
    </Modal>
  );
}
