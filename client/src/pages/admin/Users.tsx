import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AdminUser, QuotaProfile } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { formatBytes, relative } from '@/lib/format';
import { Badge, Button, Confirm, Field, IconButton, Input, Modal, PageLoader, SectionTitle, Select, Segmented, Toggle } from '@/components/ui';

export default function AdminUsers() {
  const me = useApp((s) => s.me)!;
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [profiles, setProfiles] = useState<QuotaProfile[]>([]);
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const [del, setDel] = useState<AdminUser | null>(null);
  const load = useCallback(() => {
    api.get<AdminUser[]>('/api/admin/users').then(setUsers);
    api.get<QuotaProfile[]>('/api/admin/profiles').then(setProfiles);
  }, []);
  useEffect(load, [load]);

  async function remove() {
    try { await api.del(`/api/admin/users/${del!.id}`); toast.success('Utilisateur supprimé'); setDel(null); load(); }
    catch (err) { toast.error(errorMessage(err)); }
  }

  if (!users) return <PageLoader />;
  const profileName = (id: string | null) => (id ? profiles.find((p) => p.id === id)?.name : profiles.find((p) => p.isDefault)?.name) ?? 'Global';

  return (
    <>
      <SectionTitle title="Utilisateurs" subtitle="Les comptes Microsoft sont créés automatiquement à la première connexion."
        action={<Button variant="accent" size="lg" icon={<UserPlus className="size-5" />} onClick={() => setEditing('new')}>Compte local</Button>} />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className=" text-left">
              {['Utilisateur', 'Rôle', 'Profil', 'Stockage', 'Partages', 'Dernière connexion', ''].map((h) => <th key={h} className="label px-4 py-3 !text-[10px]">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {users.map((u) => (
              <tr key={u.id} className={u.disabled ? 'opacity-50' : ''}>
                <td className="px-4 py-3">
                  <div className="font-semibold">{u.displayName}</div>
                  <div className="flex items-center gap-2 text-xs text-ink-3"><span className="font-mono">@{u.username}</span>{u.authProvider === 'oidc' && <Badge className="!h-5">Entra ID</Badge>}{u.disabled && <Badge tone="danger" className="!h-5">Désactivé</Badge>}</div>
                </td>
                <td className="px-4 py-3">{u.role === 'admin' ? <Badge tone="ink">Admin</Badge> : <span className="text-ink-2">Utilisateur</span>}</td>
                <td className="px-4 py-3 text-ink-2">{profileName(u.quotaProfileId)}</td>
                <td className="px-4 py-3 font-semibold">{formatBytes(u.storageUsed)}</td>
                <td className="px-4 py-3"><Link to={`/admin/files?owner=${u.id}`} className="font-semibold underline decoration-accent decoration-2 underline-offset-4">{u.shareCount}</Link></td>
                <td className="px-4 py-3 text-ink-3">{u.lastLoginAt ? relative(u.lastLoginAt) : '—'}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <IconButton label="Modifier" onClick={() => setEditing(u)}><Pencil className="size-4" /></IconButton>
                  {u.id !== me.id && <IconButton label="Supprimer" className="hover:!text-danger" onClick={() => setDel(u)}><Trash2 className="size-4" /></IconButton>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserModal user={editing === 'new' ? null : editing} profiles={profiles} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={remove} title={`Supprimer @${del?.username} ?`}>
        Tous ses partages et fichiers ({formatBytes(del?.storageUsed ?? 0)}) seront supprimés définitivement.
      </Confirm>
    </>
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
