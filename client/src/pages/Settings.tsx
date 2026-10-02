import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Download, KeyRound, Link2, Plus, Terminal, Trash2, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { LINK_SOURCES, type LinkSource, type Me, type UserLinkPrefs } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { dateTime, formatBytes, relative } from '@/lib/format';
import { Badge, Button, Confirm, CopyLink, Empty, Field, IconButton, Input, Modal, SectionTitle, Segmented, Toggle, copyText } from '@/components/ui';
import { SOURCE_LABELS, UserLinkEditor } from '@/components/LinkPolicy';

type Tab = 'profile' | 'links' | 'sharex' | 'security';

export default function SettingsPage() {
  const me = useApp((s) => s.me)!;
  const [tab, setTab] = useState<Tab>('profile');
  const tabs: { id: Tab; label: string; icon: typeof User }[] = [
    { id: 'profile', label: 'Profil', icon: User },
    { id: 'links', label: 'Format des liens', icon: Link2 },
    { id: 'sharex', label: 'ShareX & API', icon: Terminal },
    ...(me.authProvider === 'local' ? [{ id: 'security' as Tab, label: 'Mot de passe', icon: KeyRound }] : []),
  ];
  return (
    <>
      <SectionTitle title="Paramètres" />
      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <nav className="flex lg:flex-col gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={clsx('flex items-center gap-2.5 rounded-xl px-3.5 h-11 text-sm font-bold whitespace-nowrap transition', tab === t.id ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-ink/5 hover:text-ink')}>
              <t.icon className="size-4" />{t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {tab === 'profile' && <ProfileTab me={me} />}
          {tab === 'links' && <LinksTab me={me} />}
          {tab === 'sharex' && <ShareXTab me={me} />}
          {tab === 'security' && <PasswordTab />}
        </div>
      </div>
    </>
  );
}

function Panel({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="card">
      <div className="px-6 pt-5"><h2 className="text-2xl font-extrabold">{title}</h2></div>
      <div className="px-6 py-5">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t-2 border-line-soft px-6 py-4">{footer}</div>}
    </section>
  );
}

function ProfileTab({ me }: { me: Me }) {
  const setMe = useApp((s) => s.setMe);
  const [displayName, setDisplayName] = useState(me.displayName);
  const [vanity, setVanity] = useState(me.vanity ?? '');
  const [saving, setSaving] = useState(false);
  const vanityAllowed = LINK_SOURCES.some((s) => me.linkPolicies[s].options.prefixMode === 'vanity' || !me.linkPolicies[s].locked.prefixMode);
  const l = me.limits;

  async function save() {
    setSaving(true);
    try {
      setMe(await api.patch<Me>('/api/me', { displayName, ...(vanityAllowed ? { vanity: vanity || null } : {}) }));
      toast.success('Profil enregistré');
    } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <Panel title="Profil" footer={<Button variant="accent" loading={saving} onClick={save}>Enregistrer</Button>}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Nom affiché"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
          <Field label="Identifiant" hint={me.authProvider === 'oidc' ? 'Compte Microsoft Entra ID' : 'Modifiable par un administrateur'}><Input value={me.username} disabled /></Field>
          <Field label="Code personnel" hint="Utilisé quand le préfixe est « Code perso »."><Input value={me.userCode} disabled className="font-mono" /></Field>
          <Field label="Alias" hint={vanityAllowed ? 'Préfixe personnalisé de vos liens (ex. compta).' : 'Désactivé par l’administrateur.'}>
            <Input value={vanity} disabled={!vanityAllowed} onChange={(e) => setVanity(e.target.value.toLowerCase())} placeholder="—" className="font-mono" />
          </Field>
          <Field label="E-mail"><Input value={me.email ?? ''} disabled /></Field>
        </div>
      </Panel>
      <Panel title="Vos limites">
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-5">
          <Stat label="Stockage" value={`${formatBytes(l.storageUsed)}${l.storageQuota ? ` / ${formatBytes(l.storageQuota)}` : ''}`} />
          <Stat label="Par fichier" value={l.maxFileSize ? formatBytes(l.maxFileSize) : 'Illimité'} />
          <Stat label="Par partage" value={l.maxShareSize ? formatBytes(l.maxShareSize) : 'Illimité'} />
          <Stat label="Expiration par défaut" value={l.defaultExpiryHours ? `${l.defaultExpiryHours / 24 >= 1 ? `${Math.round(l.defaultExpiryHours / 24)} j` : `${l.defaultExpiryHours} h`}` : 'Jamais'} />
          <Stat label="Expiration max" value={l.maxExpiryHours ? `${Math.round(l.maxExpiryHours / 24)} j` : 'Aucune'} />
          <Stat label="Liens publics" value={l.allowPublic ? 'Autorisés' : 'Interdits'} />
        </dl>
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><dt className="label">{label}</dt><dd className="mt-1 font-display text-xl font-extrabold">{value}</dd></div>;
}

function LinksTab({ me }: { me: Me }) {
  const setMe = useApp((s) => s.setMe);
  const [source, setSource] = useState<LinkSource>('web');
  const [prefs, setPrefs] = useState<UserLinkPrefs>(me.linkPrefs ?? {});
  const [saving, setSaving] = useState(false);

  // Policies in `me` already include saved prefs; edit against the admin/profile base.
  async function save() {
    setSaving(true);
    try {
      setMe(await api.put<Me>('/api/me/link-prefs', prefs));
      toast.success('Préférences enregistrées');
    } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(false); }
  }

  return (
    <Panel title="Format des liens"
      footer={<><Button variant="ghost" onClick={() => setPrefs({ ...prefs, [source]: {} })}>Réinitialiser</Button><Button variant="accent" loading={saving} onClick={save}>Enregistrer</Button></>}>
      <p className="mb-5 text-sm text-ink-2">Choisissez comment sont construits vos liens. Les options marquées <Badge className="!h-5">Imposé</Badge> sont fixées par l’administrateur. Les liens déjà créés ne changent pas.</p>
      <div className="mb-5"><Segmented value={source} onChange={setSource} options={LINK_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s].title }))} /></div>
      <UserLinkEditor key={source} source={source} policy={me.linkPolicies[source]} value={prefs[source] ?? {}}
        onChange={(v) => setPrefs({ ...prefs, [source]: v })}
        identity={{ username: me.username, userCode: me.userCode, vanity: me.vanity }} />
    </Panel>
  );
}

interface Token { id: string; name: string; hint: string; createdAt: string; lastUsedAt: string | null; token?: string }

function sxcu(token: string, kind: 'uploader' | 'shortener', direct: boolean) {
  const origin = window.location.origin;
  const name = `${useApp.getState().config?.branding.name ?? 'Ferry'} (${window.location.host})`;
  const base = { Version: '16.0.0', Name: kind === 'shortener' ? `${name} — liens` : name, RequestMethod: 'POST', Headers: { Authorization: `Bearer ${token}` }, ErrorMessage: '{json:error}' };
  const cfg = kind === 'uploader'
    ? { ...base, DestinationType: 'ImageUploader, TextUploader, FileUploader', RequestURL: `${origin}/api/sharex/upload`, Body: 'MultipartFormData', FileFormName: 'file', URL: direct ? '{json:raw_url}' : '{json:url}', ThumbnailURL: '{json:thumbnail_url}', DeletionURL: '{json:deletion_url}' }
    : { ...base, DestinationType: 'URLShortener', RequestURL: `${origin}/api/sharex/shorten`, Body: 'JSON', Data: '{"url":"{input}"}', URL: '{json:url}', DeletionURL: '{json:deletion_url}' };
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${window.location.host}${kind === 'shortener' ? '-links' : ''}.sxcu`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ShareXTab({ me }: { me: Me }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('ShareX');
  const [fresh, setFresh] = useState<Token | null>(null);
  const [direct, setDirect] = useState(false);
  const [revoke, setRevoke] = useState<Token | null>(null);
  const load = () => { api.get<Token[]>('/api/me/tokens').then(setTokens).catch(() => {}); };
  useEffect(load, []);

  async function create() {
    try {
      const t = await api.post<Token>('/api/me/tokens', { name });
      setFresh(t); setCreating(false); load();
    } catch (err) { toast.error(errorMessage(err)); }
  }

  const sx = me.linkPolicies.sharex.options;
  return (
    <div className="space-y-6">
      <Panel title="ShareX" footer={<Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Nouveau jeton</Button>}>
        <p className="text-sm text-ink-2">
          Créez un jeton puis téléchargez la configuration <span className="kbd">.sxcu</span> : double-cliquez dessus et ShareX l’importe directement.
          Les captures utilisent le format de lien « ShareX » (actuellement : préfixe <b>{sx.prefixMode}</b>, nom <b>{sx.nameMode}</b>).
        </p>
        <div className="mt-5">
          {tokens.length === 0 ? <Empty icon={<KeyRound className="size-6" />} title="Aucun jeton">Un jeton par appareil, révocable à tout moment.</Empty> : (
            <ul className="divide-y-2 divide-line-soft">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-4 py-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-surface-2"><KeyRound className="size-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{t.name}</div>
                    <div className="text-xs text-ink-3"><span className="font-mono">{t.hint}</span> · créé le {dateTime(t.createdAt)} · {t.lastUsedAt ? `utilisé ${relative(t.lastUsedAt)}` : 'jamais utilisé'}</div>
                  </div>
                  <IconButton label="Révoquer" className="hover:!text-danger" onClick={() => setRevoke(t)}><Trash2 className="size-4" /></IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
      <Panel title="API">
        <p className="mb-3 text-sm text-ink-2">Compatible curl, Flameshot ou tout script :</p>
        <pre className="overflow-x-auto rounded-xl bg-ink p-4 font-mono text-[12px] text-bg scroll-thin">{`curl -H "Authorization: Bearer <jeton>" \\
     -F "file=@capture.png" \\
     ${window.location.origin}/api/sharex/upload`}</pre>
      </Panel>

      <Modal open={creating} onClose={() => setCreating(false)} title="Nouveau jeton"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Annuler</Button><Button variant="accent" disabled={!name.trim()} onClick={create}>Créer</Button></>}>
        <Field label="Nom" hint="Ex. le nom du PC"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </Modal>

      <Modal open={!!fresh} onClose={() => setFresh(null)} title="Jeton créé" width="max-w-xl">
        {fresh?.token && (
          <div className="space-y-5">
            <p className="text-sm text-ink-2">Ce jeton ne sera plus affiché. Téléchargez la configuration maintenant ou copiez-le.</p>
            <CopyLink url={fresh.token} />
            <Toggle checked={direct} onChange={setDirect} label="Copier le lien direct du fichier" description="Sinon, ShareX copie le lien vers la page d’aperçu." />
            <div className="flex flex-wrap gap-2">
              <Button variant="accent" icon={<Download className="size-4" />} onClick={() => sxcu(fresh.token!, 'uploader', direct)}>Uploader (.sxcu)</Button>
              <Button icon={<Download className="size-4" />} onClick={() => sxcu(fresh.token!, 'shortener', direct)}>Raccourcisseur (.sxcu)</Button>
              <Button variant="ghost" onClick={() => copyText(fresh.token!, 'Jeton copié')}>Copier le jeton</Button>
            </div>
          </div>
        )}
      </Modal>
      <Confirm open={!!revoke} onClose={() => setRevoke(null)} title="Révoquer ce jeton ?" confirmLabel="Révoquer"
        onConfirm={async () => { await api.del(`/api/me/tokens/${revoke!.id}`); setRevoke(null); load(); toast.success('Jeton révoqué'); }}>
        Les outils qui l’utilisent ne pourront plus envoyer de fichiers.
      </Confirm>
    </div>
  );
}

function PasswordTab() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (next !== confirm) return toast.error('Les mots de passe ne correspondent pas');
    setSaving(true);
    try {
      await api.put('/api/me/password', { current, next });
      toast.success('Mot de passe modifié');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(false); }
  }
  return (
    <Panel title="Mot de passe" footer={<Button variant="accent" loading={saving} disabled={!current || next.length < 8} onClick={save}>Modifier</Button>}>
      <div className="grid gap-5 max-w-md">
        <Field label="Mot de passe actuel"><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="Nouveau mot de passe" hint="8 caractères minimum"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirmation"><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
      </div>
    </Panel>
  );
}
