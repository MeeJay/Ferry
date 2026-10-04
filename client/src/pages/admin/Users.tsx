import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Mail, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AdminUser, InviteDTO, QuotaProfile } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { formatBytes, relative } from '@/lib/format';
import { Badge, Button, Confirm, CopyLink, Empty, Field, IconButton, Input, Modal, PageLoader, SectionTitle, Select, Segmented, Textarea, Toggle } from '@/components/ui';

type View = 'all' | 'pending' | 'invites';

export default function AdminUsers() {
  const me = useApp((s) => s.me)!;
  const [params, setParams] = useSearchParams();
  const view: View = params.get('filter') === 'pending' ? 'pending' : params.get('filter') === 'invites' ? 'invites' : 'all';
  const setView = (v: View) => setParams(v === 'all' ? {} : { filter: v }, { replace: true });
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [profiles, setProfiles] = useState<QuotaProfile[]>([]);
  const [invites, setInvites] = useState<InviteDTO[]>([]);
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const [inviting, setInviting] = useState(false);
  const [del, setDel] = useState<AdminUser | null>(null);
  const load = useCallback(() => {
    api.get<AdminUser[]>('/api/admin/users').then(setUsers);
    api.get<QuotaProfile[]>('/api/admin/profiles').then(setProfiles);
    api.get<InviteDTO[]>('/api/admin/invites').then(setInvites).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function remove() {
    try { await api.del(`/api/admin/users/${del!.id}`); toast.success('Utilisateur supprimé'); setDel(null); load(); }
    catch (err) { toast.error(errorMessage(err)); }
  }
  async function act(path: string, ok: string) {
    try { await api.post(path); toast.success(ok); load(); } catch (err) { toast.error(errorMessage(err)); }
  }

  if (!users) return <PageLoader />;
  const profileName = (id: string | null) => (id ? profiles.find((p) => p.id === id)?.name : profiles.find((p) => p.isDefault)?.name) ?? 'Global';
  const pending = users.filter((u) => u.pendingApproval || !u.emailVerified);
  const openInvites = invites.filter((i) => !i.usedAt && new Date(i.expiresAt) > new Date());
  const shown = view === 'pending' ? pending : users;

  return (
    <>
      <SectionTitle title="Utilisateurs" subtitle="Les comptes Microsoft sont créés automatiquement à la première connexion."
        action={
          <div className="flex gap-2">
            <Button icon={<Mail className="size-4" />} onClick={() => setInviting(true)}>Inviter</Button>
            <Button variant="accent" icon={<UserPlus className="size-4" />} onClick={() => setEditing('new')}>Compte local</Button>
          </div>
        } />
      <div className="mb-5">
        <Segmented value={view} onChange={setView} options={[
          { value: 'all', label: `Tous (${users.length})` },
          { value: 'pending', label: `En attente (${pending.length})` },
          { value: 'invites', label: `Invitations (${openInvites.length})` },
        ]} />
      </div>

      {view === 'invites' ? (
        <InvitesTable invites={invites} profileName={profileName} onChanged={load} onNew={() => setInviting(true)} />
      ) : shown.length === 0 ? (
        <Empty icon={<Check className="size-6" />} title="Aucun compte en attente">Les inscriptions à valider apparaîtront ici.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                {['Utilisateur', 'Rôle', 'Profil', 'Stockage', 'Partages', 'Dernière connexion', ''].map((h) => <th key={h} className="label px-4 py-3 !text-[10px]">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {shown.map((u) => (
                <tr key={u.id} className={u.disabled ? 'opacity-50' : ''}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{u.displayName}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                      <span className="font-mono">@{u.username}</span>
                      {u.authProvider === 'oidc' && <Badge>Entra ID</Badge>}
                      {u.disabled && <Badge tone="danger">Désactivé</Badge>}
                      {!u.emailVerified && <Badge tone="warn">E-mail non confirmé</Badge>}
                      {u.pendingApproval && <Badge tone="accent">À valider</Badge>}
                    </div>
                    {(u.pendingApproval || !u.emailVerified) && u.email && <div className="mt-0.5 text-xs text-ink-3">{u.email}</div>}
                  </td>
                  <td className="px-4 py-3">{u.role === 'admin' ? <Badge tone="ink">Admin</Badge> : <span className="text-ink-2">Utilisateur</span>}</td>
                  <td className="px-4 py-3 text-ink-2">{profileName(u.quotaProfileId)}</td>
                  <td className="px-4 py-3 font-semibold">{formatBytes(u.storageUsed)}</td>
                  <td className="px-4 py-3"><Link to={`/admin/files?owner=${u.id}`} className="font-semibold underline decoration-accent decoration-2 underline-offset-4">{u.shareCount}</Link></td>
                  <td className="px-4 py-3 text-ink-3">{u.lastLoginAt ? relative(u.lastLoginAt) : '—'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {u.pendingApproval && <Button size="sm" variant="accent" icon={<Check className="size-3.5" />} onClick={() => act(`/api/admin/users/${u.id}/approve`, 'Compte validé')}>Valider</Button>}
                    {!u.emailVerified && <Button size="sm" variant="ghost" onClick={() => act(`/api/admin/users/${u.id}/verify-email`, 'Adresse marquée comme confirmée')}>Confirmer l’e-mail</Button>}
                    <IconButton label="Modifier" onClick={() => setEditing(u)}><Pencil className="size-4" /></IconButton>
                    {u.id !== me.id && <IconButton label={u.pendingApproval ? 'Refuser' : 'Supprimer'} className="hover:!text-danger" onClick={() => setDel(u)}>{u.pendingApproval ? <X className="size-4" /> : <Trash2 className="size-4" />}</IconButton>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <UserModal user={editing === 'new' ? null : editing} profiles={profiles} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {inviting && <InviteModal profiles={profiles} onClose={() => setInviting(false)} onCreated={() => { load(); setView('invites'); }} />}
      <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={remove} title={del?.pendingApproval ? `Refuser @${del?.username} ?` : `Supprimer @${del?.username} ?`} confirmLabel={del?.pendingApproval ? 'Refuser' : 'Supprimer'}>
        {del?.pendingApproval ? 'Le compte en attente sera supprimé.' : <>Tous ses partages et fichiers ({formatBytes(del?.storageUsed ?? 0)}) seront supprimés définitivement.</>}
      </Confirm>
    </>
  );
}

function InvitesTable({ invites, profileName, onChanged, onNew }: { invites: InviteDTO[]; profileName: (id: string | null) => string; onChanged: () => void; onNew: () => void }) {
  if (!invites.length) {
    return <Empty icon={<Mail className="size-6" />} title="Aucune invitation" action={<Button variant="accent" onClick={onNew}>Inviter quelqu’un</Button>}>Un lien de création de compte préconfiguré (rôle, profil), utilisable même quand les inscriptions sont fermées.</Empty>;
  }
  const state = (i: InviteDTO) => (i.usedAt ? 'used' : new Date(i.expiresAt) <= new Date() ? 'expired' : 'open');
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left">{['Destinataire', 'Rôle', 'Profil', 'État', 'Expiration', ''].map((h) => <th key={h} className="label px-4 py-3 !text-[10px]">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line-soft">
          {invites.map((i) => {
            const s = state(i);
            return (
              <tr key={i.id} className={s === 'open' ? '' : 'opacity-60'}>
                <td className="px-4 py-3"><div className="font-semibold">{i.displayName || i.email || 'Lien ouvert'}</div>{i.displayName && i.email && <div className="text-xs text-ink-3">{i.email}</div>}{i.note && <div className="text-xs italic text-ink-3">{i.note}</div>}</td>
                <td className="px-4 py-3">{i.role === 'admin' ? <Badge tone="ink">Admin</Badge> : <span className="text-ink-2">Utilisateur</span>}</td>
                <td className="px-4 py-3 text-ink-2">{profileName(i.profileId)}</td>
                <td className="px-4 py-3">{s === 'used' ? <Badge tone="success">Utilisée</Badge> : s === 'expired' ? <Badge tone="warn">Expirée</Badge> : <Badge tone="accent">En attente</Badge>}</td>
                <td className="px-4 py-3 text-ink-3">{s === 'used' && i.usedAt ? `utilisée ${relative(i.usedAt)}` : relative(i.expiresAt)}</td>
                <td className="px-4 py-3 text-right">
                  {s !== 'used' && <IconButton label="Révoquer" className="hover:!text-danger" onClick={async () => { await api.del(`/api/admin/invites/${i.id}`); toast.success('Invitation révoquée'); onChanged(); }}><Trash2 className="size-4" /></IconButton>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InviteModal({ profiles, onClose, onCreated }: { profiles: QuotaProfile[]; onClose: () => void; onCreated: () => void }) {
  const mailEnabled = useApp((s) => s.config?.mailEnabled);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [profileId, setProfileId] = useState('');
  const [expiry, setExpiry] = useState(168);
  const [note, setNote] = useState('');
  const [send, setSend] = useState(!!mailEnabled);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const def = profiles.find((p) => p.isDefault);

  async function create() {
    setBusy(true);
    try {
      const r = await api.post<InviteDTO & { link: string }>('/api/admin/invites', {
        email: email || null, displayName: displayName || null, role, profileId: profileId || null, note: note || null,
        expiryHours: expiry, send: send && !!email,
      });
      setLink(r.link);
      onCreated();
      if (send && email) toast.success('Invitation envoyée');
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }

  if (link) {
    return (
      <Modal open onClose={onClose} title="Invitation créée" footer={<Button variant="accent" onClick={onClose}>Terminé</Button>}>
        <div className="space-y-4">
          <p className="text-sm text-ink-2">Ce lien n’est affiché qu’une fois. Il est utilisable une seule fois, jusqu’à son expiration.</p>
          <CopyLink url={link} />
        </div>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title="Inviter quelqu’un" width="max-w-xl"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="accent" loading={busy} disabled={send && !email} icon={<Mail className="size-4" />} onClick={create}>{send && email ? 'Envoyer l’invitation' : 'Créer le lien'}</Button></>}>
      <div className="space-y-5">
        <p className="text-sm text-ink-2">La personne choisit son identifiant et son mot de passe ; le rôle et le profil sont appliqués automatiquement. Fonctionne même si les inscriptions sont fermées.</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="E-mail" hint="Optionnel : si renseigné, seule cette adresse peut utiliser le lien."><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@exemple.fr" /></Field>
          <Field label="Nom" hint="Prérempli à l’inscription"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
          <Field label="Rôle"><Segmented value={role} onChange={setRole} options={[{ value: 'user', label: 'Utilisateur' }, { value: 'admin', label: 'Admin' }]} /></Field>
          <Field label="Profil">
            <Select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">{def ? `Par défaut (${def.name})` : 'Réglages globaux'}</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Validité">
          <Segmented size="sm" value={expiry} onChange={setExpiry} options={[{ value: 24, label: '1 jour' }, { value: 168, label: '7 jours' }, { value: 720, label: '30 jours' }, { value: 2160, label: '90 jours' }]} />
        </Field>
        <Field label="Message" hint="Affiché dans l’e-mail d’invitation"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {mailEnabled ? <Toggle checked={send} onChange={setSend} label="Envoyer l’invitation par e-mail" description={email ? `À ${email}` : 'Renseignez une adresse e-mail'} />
          : <p className="text-xs text-ink-3">Aucun envoi d’e-mail configuré : copiez le lien et transmettez-le vous-même.</p>}
      </div>
    </Modal>
  );
}

function UserModal({ user, profiles, onClose, onSaved }: { user: AdminUser | null; profiles: QuotaProfile[]; onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState(user?.username ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>(user?.role ?? 'user');
  const [profile, setProfile] = useState(user?.quotaProfileId ?? '');
  const [disabled, setDisabled] = useState(user?.disabled ?? false);
  const [saving, setSaving] = useState(false);
  const local = !user || user.authProvider === 'local';

  async function save() {
    setSaving(true);
    const body = { username, displayName, email: email || null, role, quotaProfileId: profile || null, disabled, ...(password ? { password } : {}) };
    try {
      if (user) await api.patch(`/api/admin/users/${user.id}`, body);
      else await api.post('/api/admin/users', body);
      toast.success(user ? 'Utilisateur mis à jour' : 'Compte créé');
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={user ? user.displayName : 'Nouveau compte local'}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="accent" loading={saving} disabled={!username || !displayName || (!user && password.length < 8)} icon={user ? undefined : <Plus className="size-4" />} onClick={save}>{user ? 'Enregistrer' : 'Créer'}</Button></>}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Identifiant" hint="Sert aussi de préfixe de lien."><Input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} className="font-mono" /></Field>
        <Field label="Nom affiché"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
        <Field label="E-mail" className="sm:col-span-2"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!local} /></Field>
        {local && <Field label={user ? 'Nouveau mot de passe' : 'Mot de passe'} hint={user ? 'Laisser vide pour ne pas changer' : '8 caractères minimum'} className="sm:col-span-2"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>}
        <Field label="Rôle"><Segmented value={role} onChange={setRole} options={[{ value: 'user', label: 'Utilisateur' }, { value: 'admin', label: 'Admin' }]} /></Field>
        <Field label="Profil de quotas" hint={user?.authProvider === 'oidc' ? 'Peut être réécrit par le mapping des groupes Entra.' : undefined}>
          <Select value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="">{profiles.find((p) => p.isDefault) ? `Par défaut (${profiles.find((p) => p.isDefault)!.name})` : 'Réglages globaux'}</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        {user && <div className="sm:col-span-2"><Toggle checked={disabled} onChange={setDisabled} label="Compte désactivé" description="Bloque la connexion et l’API. Les liens existants restent actifs." /></div>}
      </div>
    </Modal>
  );
}
