import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Download, KeyRound, Link2, Plus, Terminal, Trash2, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { LINK_SOURCES, type LinkSource, type Me, type UserLinkPrefs } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { dateTime, formatBytes, relative } from '@/lib/format';
import { Badge, Button, Confirm, CopyLink, Empty, Field, IconButton, Input, Modal, SectionTitle, Segmented, Select, Toggle } from '@/components/ui';
import { SOURCE_LABELS, UserLinkEditor } from '@/components/LinkPolicy';
import { ParallelPicker } from '@/components/ParallelPicker';

type Tab = 'profile' | 'links' | 'sharex' | 'security';

export default function SettingsPage() {
  const me = useApp((s) => s.me)!;
  const params = useParams<{ tab?: Tab }>();
  const navigate = useNavigate();
  const tab: Tab = params.tab && ['profile', 'links', 'sharex', 'security'].includes(params.tab) ? params.tab : 'profile';
  const setTab = (t: Tab) => navigate(t === 'profile' ? '/settings' : `/settings/${t}`);
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
              className={clsx('flex items-center gap-2.5 rounded-md px-3.5 h-9 text-sm font-semibold whitespace-nowrap transition', tab === t.id ? 'bg-grad text-white' : 'text-ink-2 hover:bg-ink/5 hover:text-ink')}>
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
      <div className="px-5 pt-5"><h2 className="text-lg font-bold">{title}</h2></div>
      <div className="px-5 py-5">{children}</div>
      {footer && <div className="flex justify-end gap-2 px-5 py-4">{footer}</div>}
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
          <div className="sm:col-span-2 rounded-md bg-surface-2 p-3"><ParallelPicker compact /></div>
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
  return <div><dt className="label">{label}</dt><dd className="mt-1 font-display text-base font-bold">{value}</dd></div>;
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

type Destination = 'all' | 'files' | 'images' | 'text' | 'shortener';
type NameFormat = '' | 'original' | 'random' | 'original_random' | 'words' | 'timestamp' | 'uuid';

interface GeneratorOptions {
  destination: Destination;
  nameFormat: NameFormat;
  quality: string;
  maxViews: string;
  expires: string;
  visibility: '' | 'public' | 'private';
  domain: string;
  direct: boolean;
  xshare: boolean;
  tokenName: string;
}

const DESTINATIONS: Record<Destination, { label: string; hint: string; sharex: string }> = {
  all: { label: 'Tout envoyer', hint: 'Images, texte et fichiers', sharex: 'ImageUploader, TextUploader, FileUploader' },
  files: { label: 'Fichiers', hint: 'Uploader de fichiers uniquement', sharex: 'FileUploader' },
  images: { label: 'Images', hint: 'Captures d’écran uniquement', sharex: 'ImageUploader' },
  text: { label: 'Texte', hint: 'Texte envoyé comme fichier .txt', sharex: 'TextUploader' },
  shortener: { label: 'Raccourcisseur d’URL', hint: 'Liens courts sur votre domaine', sharex: 'URLShortener' },
};

const NAME_FORMATS: { value: NameFormat; label: string }[] = [
  { value: '', label: 'Par défaut (format ShareX de mon profil)' },
  { value: 'random', label: 'Aléatoire' },
  { value: 'original', label: 'Nom d’origine' },
  { value: 'original_random', label: 'Nom d’origine + aléatoire' },
  { value: 'words', label: 'Mots aléatoires' },
  { value: 'timestamp', label: 'Horodatage' },
  { value: 'uuid', label: 'UUID' },
];

/** Builds a ShareX custom uploader (.sxcu); Xshare (Android) uses the legacy $json:…$ syntax. */
function buildConfig(token: string, o: GeneratorOptions): { name: string; json: string } {
  const host = window.location.host;
  const origin = window.location.origin;
  const brand = useApp.getState().config?.branding.name ?? 'Ferry';
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (o.nameFormat) headers['X-Ferry-Name-Format'] = o.nameFormat;
  if (o.quality) headers['X-Ferry-Image-Quality'] = o.quality;
  if (o.maxViews) headers['X-Ferry-Max-Views'] = o.maxViews;
  if (o.expires) headers['X-Ferry-Expires'] = o.expires;
  if (o.visibility) headers['X-Ferry-Visibility'] = o.visibility;
  if (o.domain) headers['X-Ferry-Domain'] = o.domain;
  const label = `${brand} (${o.domain || host})${o.destination === 'all' ? '' : ` — ${DESTINATIONS[o.destination].label}`}`;
  const base = { Version: '16.0.0', Name: label, DestinationType: DESTINATIONS[o.destination].sharex, RequestMethod: 'POST', Headers: headers, ErrorMessage: '{json:error}' };
  const cfg = o.destination === 'shortener'
    ? { ...base, RequestURL: `${origin}/api/sharex/shorten`, Body: 'JSON', Data: '{"url":"{input}"}', URL: '{json:url}', DeletionURL: '{json:deletion_url}' }
    : { ...base, RequestURL: `${origin}/api/sharex/upload`, Body: 'MultipartFormData', FileFormName: 'file', URL: o.direct ? '{json:raw_url}' : '{json:url}', ThumbnailURL: '{json:thumbnail_url}', DeletionURL: '{json:deletion_url}' };
  let json = JSON.stringify(cfg, null, 2);
  if (o.xshare) json = json.replace(/\{json:([^}]+)\}/g, '$$json:$1$$').replace(/\{input\}/g, '$$input$$');
  return { name: `${(o.domain || host).replace(/[:]/g, '-')}-${o.destination}${o.xshare ? '-xshare' : ''}.sxcu`, json };
}

function download(name: string, content: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function GeneratorModal({ me, onClose, onCreated }: { me: Me; onClose: () => void; onCreated: () => void }) {
  const today = new Date().toLocaleDateString('fr-FR');
  const [o, setO] = useState<GeneratorOptions>({
    destination: 'all', nameFormat: '', quality: '', maxViews: '', expires: '', visibility: '', domain: '', direct: false, xshare: false,
    tokenName: `ShareX — ${today}`,
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof GeneratorOptions>(k: K, v: GeneratorOptions[K]) => setO({ ...o, [k]: v });
  const nameLocked = me.linkPolicies.sharex.locked.nameMode;
  const isUpload = o.destination !== 'shortener';
  const l = me.limits;
  const expiryOptions = [
    { v: '', label: 'Par défaut' }, { v: '1', label: '1 heure' }, { v: '24', label: '1 jour' }, { v: '168', label: '7 jours' },
    { v: '720', label: '30 jours' }, ...(l.allowNeverExpire ? [{ v: '0', label: 'Jamais' }] : []),
  ].filter((e) => !e.v || e.v === '0' || !l.maxExpiryHours || Number(e.v) <= l.maxExpiryHours);

  async function generate() {
    setBusy(true);
    try {
      const t = await api.post<Token>('/api/me/tokens', { name: o.tokenName || 'ShareX' });
      const { name, json } = buildConfig(t.token!, o);
      download(name, json);
      toast.success('Configuration téléchargée');
      onCreated();
      onClose();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }

  const Desc = ({ children }: { children: React.ReactNode }) => <p className="mb-1.5 text-xs text-ink-3">{children}</p>;
  return (
    <Modal open onClose={onClose} title="Générer une config ShareX" width="max-w-xl"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="accent" loading={busy} icon={<Download className="size-4" />} onClick={generate}>Télécharger</Button></>}>
      <div className="space-y-5">
        <Field label="Type de destination">
          <Desc>Ce que ShareX enverra avec cette configuration.</Desc>
          <Select value={o.destination} onChange={(e) => set('destination', e.target.value as Destination)}>
            {(Object.keys(DESTINATIONS) as Destination[]).map((d) => <option key={d} value={d}>{DESTINATIONS[d].label} — {DESTINATIONS[d].hint}</option>)}
          </Select>
        </Field>
        <Field label="Format du nom" locked={nameLocked}>
          <Desc>Nom utilisé dans le lien ({`${window.location.host}/préfixe/nom`}).{nameLocked && ' Imposé par l’administrateur.'}</Desc>
          <Select value={o.nameFormat} disabled={nameLocked} onChange={(e) => set('nameFormat', e.target.value as NameFormat)}>
            {NAME_FORMATS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
          </Select>
        </Field>
        {isUpload && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Compression">
              <Desc>Qualité 1–100 pour les images JPEG, WebP et PNG. Vide = aucune.</Desc>
              <div className="relative"><Input type="number" min={1} max={100} value={o.quality} onChange={(e) => set('quality', e.target.value)} placeholder="—" className="!pr-8" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">%</span></div>
            </Field>
            <Field label="Vues max">
              <Desc>Le fichier disparaît après ce nombre de téléchargements. Vide = illimité.</Desc>
              <Input type="number" min={1} value={o.maxViews} onChange={(e) => set('maxViews', e.target.value)} placeholder="Illimité" />
            </Field>
          </div>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Expiration">
            <Desc>Bornée par vos limites.</Desc>
            <Select value={o.expires} onChange={(e) => set('expires', e.target.value)}>{expiryOptions.map((e) => <option key={e.v} value={e.v}>{e.label}</option>)}</Select>
          </Field>
          <Field label="Visibilité">
            <Desc>Privé = lien réservé aux comptes.</Desc>
            <Select value={o.visibility} onChange={(e) => set('visibility', e.target.value as GeneratorOptions['visibility'])}>
              <option value="">Par défaut</option>
              {l.allowPublic && <option value="public">Public</option>}
              <option value="private">Privé</option>
            </Select>
          </Field>
        </div>
        <Field label="Domaine">
          <Desc>Domaine utilisé dans les liens renvoyés à ShareX.</Desc>
          <Select value={o.domain} onChange={(e) => set('domain', e.target.value)} disabled={!l.sharexDomains.length}>
            <option value="">Domaine par défaut ({window.location.host})</option>
            {l.sharexDomains.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Field>
        <div>
          <div className="label mb-3">Autres options</div>
          <div className="space-y-4">
            {isUpload && <Toggle checked={o.direct} onChange={(v) => set('direct', v)} label="Copier le lien direct du fichier" description="Sinon ShareX copie le lien vers la page d’aperçu (avec vignette dans Teams, Slack, Discord)." />}
            <Toggle checked={o.xshare} onChange={(v) => set('xshare', v)} label="Compatibilité Xshare" description="Pour l’application Xshare sur Android. La config générée ne fonctionnera pas avec ShareX." />
          </div>
        </div>
        <Field label="Nom du jeton" hint="Un nouveau jeton API est créé et intégré à la configuration. Il est révocable dans la liste ci-dessous.">
          <Input value={o.tokenName} onChange={(e) => set('tokenName', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function ShareXTab({ me }: { me: Me }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [generator, setGenerator] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('Script');
  const [fresh, setFresh] = useState<Token | null>(null);
  const [revoke, setRevoke] = useState<Token | null>(null);
  const load = () => { api.get<Token[]>('/api/me/tokens').then(setTokens).catch(() => {}); };
  useEffect(load, []);

  if (!me.limits.sharexEnabled) {
    return (
      <Empty icon={<Terminal className="size-6" />} title="ShareX n’est pas activé">
        L’envoi via ShareX et l’API n’est pas ouvert pour votre profil. Contactez votre administrateur.
      </Empty>
    );
  }

  async function create() {
    try {
      const t = await api.post<Token>('/api/me/tokens', { name });
      setFresh(t); setCreating(false); load();
    } catch (err) { toast.error(errorMessage(err)); }
  }

  return (
    <div className="space-y-6">
      <Panel title="ShareX">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-lg text-sm text-ink-2">
            Générez une configuration <span className="kbd">.sxcu</span> : double-cliquez dessus et ShareX l’importe. Compatible avec Xshare sur Android.
          </p>
          <Button variant="accent" icon={<Download className="size-4" />} onClick={() => setGenerator(true)}>Générer une config</Button>
        </div>
      </Panel>
      <Panel title="Jetons API" footer={<Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Jeton manuel</Button>}>
        {tokens.length === 0 ? <Empty icon={<KeyRound className="size-6" />} title="Aucun jeton">Chaque configuration générée crée son propre jeton, révocable à tout moment.</Empty> : (
          <ul className="divide-y divide-line-soft">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-4 py-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-surface-2"><KeyRound className="size-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="text-xs text-ink-3"><span className="font-mono">{t.hint}</span> · créé le {dateTime(t.createdAt)} · {t.lastUsedAt ? `utilisé ${relative(t.lastUsedAt)}` : 'jamais utilisé'}</div>
                </div>
                <IconButton label="Révoquer" className="hover:!text-danger" onClick={() => setRevoke(t)}><Trash2 className="size-4" /></IconButton>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="API">
        <p className="mb-3 text-sm text-ink-2">Compatible curl, Flameshot ou tout script. Les en-têtes <span className="kbd">X-Ferry-*</span> du générateur sont aussi acceptés.</p>
        <pre className="overflow-x-auto rounded-md bg-surface-2 p-4 font-mono text-[12px] text-ink scroll-thin">{`curl -H "Authorization: Bearer <jeton>" \\
     -H "X-Ferry-Expires: 24" \\
     -F "file=@capture.png" \\
     ${window.location.origin}/api/sharex/upload`}</pre>
      </Panel>

      {generator && <GeneratorModal me={me} onClose={() => setGenerator(false)} onCreated={load} />}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nouveau jeton"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Annuler</Button><Button variant="accent" disabled={!name.trim()} onClick={create}>Créer</Button></>}>
        <Field label="Nom" hint="Ex. le nom du script ou du poste"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </Modal>
      <Modal open={!!fresh} onClose={() => setFresh(null)} title="Jeton créé">
        {fresh?.token && (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">Ce jeton ne sera plus affiché : copiez-le maintenant.</p>
            <CopyLink url={fresh.token} />
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
