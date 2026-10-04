import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Inbox, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { LinkOptions, RequestDTO } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { absolute, dateTime, relative } from '@/lib/format';
import { Badge, Button, Confirm, CopyLink, Empty, Field, IconButton, Input, Modal, PageLoader, SectionTitle, Segmented, Textarea, Toggle } from '@/components/ui';
import { UserLinkEditor } from '@/components/LinkPolicy';
import { RecipientsInput } from '@/components/RecipientsInput';

const DURATIONS = [
  { label: '1 jour', hours: 24 }, { label: '7 jours', hours: 168 }, { label: '30 jours', hours: 720 }, { label: 'Jamais', hours: 0 },
];

export default function RequestsPage() {
  const [items, setItems] = useState<RequestDTO[] | null>(null);
  const [editing, setEditing] = useState<RequestDTO | 'new' | null>(null);
  const load = useCallback(() => { api.get<RequestDTO[]>('/api/requests').then(setItems).catch(() => setItems([])); }, []);
  useEffect(load, [load]);

  return (
    <>
      <SectionTitle title="Demandes de dépôt"
        subtitle="Envoyez un lien, votre interlocuteur dépose ses fichiers sans compte : ils arrivent directement dans votre espace."
        action={<Button variant="accent" size="lg" icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>Nouvelle demande</Button>} />
      {!items ? <PageLoader /> : items.length === 0 ? (
        <Empty icon={<Inbox className="size-6" />} title="Aucune demande"
          action={<Button variant="accent" onClick={() => setEditing('new')}>Créer une demande</Button>}>
          Idéal pour récupérer des documents d’un client, d’un fournisseur ou d’un candidat.
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((r) => <RequestCard key={r.id} r={r} onEdit={() => setEditing(r)} onChanged={load} />)}
        </div>
      )}
      {editing && <RequestModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function RequestCard({ r, onEdit, onChanged }: { r: RequestDTO; onEdit: () => void; onChanged: () => void }) {
  const [del, setDel] = useState(false);
  const expired = !!r.expiresAt && new Date(r.expiresAt) < new Date();
  const open = r.active && !expired;

  async function toggle(active: boolean) {
    try { await api.patch(`/api/requests/${r.id}`, { active }); onChanged(); } catch (err) { toast.error(errorMessage(err)); }
  }
  async function remove() {
    try { await api.del(`/api/requests/${r.id}`); toast.success('Demande supprimée'); onChanged(); } catch (err) { toast.error(errorMessage(err)); }
  }

  return (
    <div className={clsx('card p-5 flex flex-col', !open && 'opacity-75')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-bold">{r.title}</h3>
            {expired ? <Badge tone="warn">Expirée</Badge> : !r.active ? <Badge>Fermée</Badge> : <Badge tone="success">Ouverte</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 text-[13px] text-ink-3">
            <span><b className="text-ink">{r.uploadsCount}</b> dépôt{r.uploadsCount > 1 ? 's' : ''}</span>
            <span title={dateTime(r.expiresAt)}>{r.expiresAt ? (expired ? `expirée ${relative(r.expiresAt)}` : `expire ${relative(r.expiresAt)}`) : 'sans expiration'}</span>
            {r.hasPassword && <span className="flex items-center gap-1"><KeyRound className="size-3.5" />protégée</span>}
          </div>
        </div>
        <Toggle checked={r.active} onChange={toggle} />
      </div>
      <CopyLink url={absolute(r.url)} className="mt-4" />
      <div className="mt-3 flex items-center justify-between">
        <Link to="/my?source=request" className="text-sm font-semibold text-ink-2 hover:text-ink underline decoration-accent decoration-2 underline-offset-4">Voir les fichiers reçus</Link>
        <div className="flex">
          <IconButton label="Modifier" onClick={onEdit}><Pencil className="size-4" /></IconButton>
          <IconButton label="Supprimer" className="hover:!text-danger" onClick={() => setDel(true)}><Trash2 className="size-4" /></IconButton>
        </div>
      </div>
      <Confirm open={del} onClose={() => setDel(false)} onConfirm={remove} title="Supprimer cette demande ?">
        Le lien de dépôt cessera de fonctionner. Les fichiers déjà reçus restent dans vos partages.
      </Confirm>
    </div>
  );
}

function RequestModal({ initial, onClose, onSaved }: { initial: RequestDTO | null; onClose: () => void; onSaved: () => void }) {
  const me = useApp((s) => s.me)!;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [message, setMessage] = useState(initial?.message ?? '');
  const [duration, setDuration] = useState<number | null>(initial ? null : 168);
  const [password, setPassword] = useState('');
  const [maxFiles, setMaxFiles] = useState(initial?.maxFiles ? String(initial.maxFiles) : '');
  const [maxSizeMb, setMaxSizeMb] = useState(initial?.maxSizeMb ? String(initial.maxSizeMb) : '');
  const [recipients, setRecipients] = useState<string[]>([]);
  const mailEnabled = useApp((s) => s.config?.mailEnabled);
  const [linkOverride, setLinkOverride] = useState<Partial<LinkOptions>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const body = {
      title, message: message || null,
      maxFiles: maxFiles ? Number(maxFiles) : null,
      maxSizeMb: maxSizeMb ? Number(maxSizeMb) : null,
      ...(duration !== null ? { expiryHours: duration } : {}),
      ...(password ? { password } : {}),
    };
    try {
      if (initial) await api.patch(`/api/requests/${initial.id}`, body);
      else await api.post('/api/requests', { ...body, recipients, linkOverride: Object.keys(linkOverride).length ? linkOverride : null });
      toast.success(initial ? 'Demande mise à jour' : 'Demande créée');
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={initial ? 'Modifier la demande' : 'Nouvelle demande'} width="max-w-xl"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="accent" loading={saving} disabled={!title.trim()} onClick={save}>{initial ? 'Enregistrer' : 'Créer le lien'}</Button></>}>
      <div className="space-y-5">
        <Field label="Titre" hint="Visible par la personne qui dépose."><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Pièces justificatives dossier 2026" /></Field>
        <Field label="Message"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Instructions pour l’expéditeur" /></Field>
        <Field label={initial ? 'Prolonger / modifier l’expiration' : 'Lien valable'}>
          <Segmented size="sm" value={duration ?? -1} onChange={(v) => setDuration(v === -1 ? null : v)}
            options={[...(initial ? [{ value: -1, label: 'Inchangée' }] : []), ...DURATIONS.map((d) => ({ value: d.hours, label: d.label }))]} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Fichiers max" hint="Vide = illimité"><Input type="number" min={0} value={maxFiles} onChange={(e) => setMaxFiles(e.target.value)} /></Field>
          <Field label="Taille max par dépôt (Mo)" hint="Vide = selon votre quota"><Input type="number" min={0} value={maxSizeMb} onChange={(e) => setMaxSizeMb(e.target.value)} /></Field>
        </div>
        {!initial && mailEnabled && (
          <Field label="Inviter par e-mail" hint="Le lien de dépôt leur est envoyé dès la création.">
            <RecipientsInput value={recipients} onChange={setRecipients} />
          </Field>
        )}
        <Field label="Mot de passe" hint={initial?.hasPassword ? 'Laisser vide pour conserver l’actuel.' : 'Optionnel.'}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        {!initial && (
          <div>
            <div className="label mb-2">Format du lien</div>
            <UserLinkEditor source="request" compact policy={me.linkPolicies.request} value={linkOverride} onChange={setLinkOverride}
              identity={{ username: me.username, userCode: me.userCode, vanity: me.vanity }} />
          </div>
        )}
      </div>
    </Modal>
  );
}
