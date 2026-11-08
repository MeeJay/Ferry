import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Bot, Check, Copy, Download, KeyRound, Link2, Plus, Terminal, Trash2, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { AI_KEY_SCOPES, LINK_SOURCES, type AiKeyDTO, type AiKeyScope, type LinkSource, type Me, type UserLinkPrefs } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { displayHandle } from '@/lib/handle';
import { useApp } from '@/store/app';
import { dateTime, formatBytes, relative } from '@/lib/format';
import { Badge, Button, Confirm, CopyLink, copyText, Empty, Field, IconButton, Input, Modal, SectionTitle, Segmented, Select, Toggle } from '@/components/ui';
import { SOURCE_LABELS, UserLinkEditor } from '@/components/LinkPolicy';
import { ParallelPicker } from '@/components/ParallelPicker';

type Tab = 'profile' | 'links' | 'sharex' | 'ai' | 'security';

export default function SettingsPage() {
  const me = useApp((s) => s.me)!;
  const params = useParams<{ tab?: Tab }>();
  const navigate = useNavigate();
  const tab: Tab = params.tab && ['profile', 'links', 'sharex', 'ai', 'security'].includes(params.tab) ? params.tab : 'profile';
  const setTab = (t: Tab) => navigate(t === 'profile' ? '/settings' : `/settings/${t}`);
  const tabs: { id: Tab; label: string; icon: typeof User }[] = [
    { id: 'profile', label: 'Profil', icon: User },
    { id: 'links', label: 'Format des liens', icon: Link2 },
    { id: 'sharex', label: 'ShareX & API', icon: Terminal },
    { id: 'ai', label: 'Agents IA', icon: Bot },
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
          {tab === 'ai' && <AiKeysTab me={me} />}
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
          <Field label="Nom affiché" hint={me.authProvider === 'obligate' ? 'Géré par Obligate' : undefined}><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={me.authProvider === 'obligate'} /></Field>
          <Field label="Identifiant" hint={me.authProvider === 'oidc' ? 'Compte Microsoft Entra ID' : me.authProvider === 'obligate' ? 'Compte Obligate (SSO)' : 'Modifiable par un administrateur'}><Input value={displayHandle(me.username)} disabled /></Field>
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

// ── AI agents (MCP) ────────────────────────────────────────────────────────

const SCOPE_INFO: Record<AiKeyScope, { label: string; hint: string }> = {
  upload: { label: 'Envoyer des fichiers', hint: 'Crée des partages et renvoie leurs liens (page + téléchargement direct).' },
  read: { label: 'Lire mes partages', hint: 'Liste vos partages et leurs liens, quelle que soit leur origine.' },
  delete: { label: 'Supprimer ses envois', hint: 'Supprime uniquement les partages envoyés par un agent, jamais les vôtres.' },
};

const KEY_EXPIRY = [
  { value: 7, label: '7 jours' }, { value: 30, label: '30 jours' }, { value: 90, label: '90 jours' },
  { value: 365, label: '1 an' }, { value: 0, label: 'Jamais' },
];

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (done) { const t = setTimeout(() => setDone(false), 1500); return () => clearTimeout(t); } }, [done]);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="label">{label}</span>
        <button type="button" onClick={() => { copyText(code, 'Copié'); setDone(true); }}
          className="flex items-center gap-1.5 text-xs font-semibold text-ink-3 hover:text-ink">
          {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{done ? 'Copié' : 'Copier'}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre rounded-md bg-surface-2 p-4 font-mono text-[12px] text-ink scroll-thin">{code}</pre>
    </div>
  );
}

function mcpSnippets(key: string) {
  const url = `${window.location.origin}/mcp`;
  return {
    claude: `claude mcp add --transport http --scope user ferry ${url} --header "Authorization: Bearer ${key}"`,
    json: JSON.stringify({ mcpServers: { ferry: { type: 'http', url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
  };
}

function AiKeysTab({ me }: { me: Me }) {
  const [keys, setKeys] = useState<AiKeyDTO[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<AiKeyDTO | null>(null);
  const [revoke, setRevoke] = useState<AiKeyDTO | null>(null);
  const load = () => { api.get<AiKeyDTO[]>('/api/me/ai-keys').then(setKeys).catch(() => setKeys([])); };
  useEffect(load, []);

  if (!me.limits.aiKeysEnabled) {
    return (
      <Empty icon={<Bot className="size-6" />} title="Agents IA désactivés">
        L’administrateur n’a pas ouvert les clés d’accès pour agents IA sur cette instance.
      </Empty>
    );
  }
  const endpoint = `${window.location.origin}/mcp`;
  const expired = (k: AiKeyDTO) => !!k.expiresAt && new Date(k.expiresAt).getTime() <= Date.now();

  return (
    <div className="space-y-6">
      <Panel title="Agents IA (MCP)">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-xl text-sm text-ink-2">
            Donnez une clé à un agent IA (Claude Code, Claude Desktop…) : il pourra envoyer des fichiers, même très lourds, et récupérer leurs liens,
            par exemple pour les télécharger ensuite avec <span className="kbd">curl</span> sur d’autres machines. Les fichiers ne transitent pas par l’IA :
            l’agent les envoie lui-même. La clé agit en votre nom, dans vos limites, et n’ouvre rien d’autre.
          </p>
          <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Nouvelle clé</Button>
        </div>
      </Panel>
      <Panel title="Clés d’accès">
        {keys && keys.length === 0 ? <Empty icon={<KeyRound className="size-6" />} title="Aucune clé">Créez une clé par agent ou par poste : chacune est révocable à tout moment.</Empty> : (
          <ul className="divide-y divide-line-soft">
            {(keys ?? []).map((k) => (
              <li key={k.id} className="flex items-center gap-4 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2"><Bot className="size-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                    {k.name}
                    {k.scopes.map((s) => <Badge key={s} className="!h-5">{SCOPE_INFO[s].label}</Badge>)}
                    {expired(k) && <Badge tone="warn" className="!h-5">Expirée</Badge>}
                  </div>
                  <div className="text-xs text-ink-3">
                    <span className="font-mono">{k.hint}</span> · créée le {dateTime(k.createdAt)} · {k.expiresAt ? `${expired(k) ? 'expirée' : 'expire'} ${relative(k.expiresAt)}` : 'sans expiration'}
                    {' · '}{k.lastUsedAt ? `utilisée ${relative(k.lastUsedAt)}${k.lastIp ? ` depuis ${k.lastIp}` : ''}` : 'jamais utilisée'}
                  </div>
                </div>
                <IconButton label="Révoquer" className="hover:!text-danger" onClick={() => setRevoke(k)}><Trash2 className="size-4" /></IconButton>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Connexion">
        <div className="space-y-4 text-sm text-ink-2">
          <p>Serveur MCP (HTTP) de cette instance, authentifié par la clé dans l’en-tête <span className="kbd">Authorization: Bearer</span> :</p>
          <CopyLink url={endpoint} />
          <p>La commande complète, clé incluse, est affichée à la création. Ensuite, demandez simplement à l’agent : « envoie ce fichier sur Ferry et donne-moi le lien direct ».</p>
        </div>
      </Panel>

      {creating && <NewAiKeyModal onClose={() => setCreating(false)} onCreated={(k) => { setCreating(false); setFresh(k); load(); }} />}
      <Modal open={!!fresh} onClose={() => setFresh(null)} title="Clé créée" width="max-w-2xl"
        footer={<Button variant="accent" onClick={() => setFresh(null)}>Terminé</Button>}>
        {fresh?.key && (
          <div className="space-y-5">
            <p className="text-sm text-ink-2">Elle ne sera plus affichée : copiez-la maintenant, ou directement la commande qui la contient.</p>
            <CopyLink url={fresh.key} />
            <CodeBlock label="Claude Code" code={mcpSnippets(fresh.key).claude} />
            <CodeBlock label="Autres clients MCP (JSON)" code={mcpSnippets(fresh.key).json} />
          </div>
        )}
      </Modal>
      <Confirm open={!!revoke} onClose={() => setRevoke(null)} title="Révoquer cette clé ?" confirmLabel="Révoquer"
        onConfirm={async () => { await api.del(`/api/me/ai-keys/${revoke!.id}`); setRevoke(null); load(); toast.success('Clé révoquée'); }}>
        L’agent qui l’utilise ne pourra plus rien envoyer. Les partages déjà créés restent en place.
      </Confirm>
    </div>
  );
}

function NewAiKeyModal({ onClose, onCreated }: { onClose: () => void; onCreated: (k: AiKeyDTO) => void }) {
  const [name, setName] = useState(`Claude — ${new Date().toLocaleDateString('fr-FR')}`);
  const [scopes, setScopes] = useState<AiKeyScope[]>(['upload', 'read']);
  const [expiresDays, setExpiresDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const toggle = (s: AiKeyScope, on: boolean) => setScopes(on ? [...scopes, s] : scopes.filter((x) => x !== s));

  async function create() {
    setBusy(true);
    try {
      onCreated(await api.post<AiKeyDTO>('/api/me/ai-keys', { name, scopes, expiresDays }));
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Nouvelle clé d’accès IA"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="accent" loading={busy} disabled={!name.trim() || !scopes.length} onClick={create}>Créer la clé</Button></>}>
      <div className="space-y-5">
        <Field label="Nom" hint="Ex. l’agent ou le poste qui l’utilise."><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <div>
          <div className="label mb-3">Droits</div>
          <div className="space-y-4">
            {AI_KEY_SCOPES.map((s) => <Toggle key={s} checked={scopes.includes(s)} onChange={(v) => toggle(s, v)} label={SCOPE_INFO[s].label} description={SCOPE_INFO[s].hint} />)}
          </div>
        </div>
        <Field label="Expiration">
          <Select value={expiresDays} onChange={(e) => setExpiresDays(Number(e.target.value))}>
            {KEY_EXPIRY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
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
