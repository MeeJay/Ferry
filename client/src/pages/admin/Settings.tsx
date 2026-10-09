import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Copy, ImagePlus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { LINK_SOURCES, MAIL_EVENTS, MAIL_THEMES, type LinkSource, type MailEventKey, type MailEventTemplate, type MailTemplateSettings, type MailTheme, type PublicConfig, type QuotaProfile, type RegistrationMode, type SettingsMap } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { applyAccent } from '@/lib/theme';
import { Button, copyText, Field, Input, PageLoader, SectionTitle, Segmented, Select, Textarea, Toggle } from '@/components/ui';
import { AdminLinkEditor, SOURCE_LABELS } from '@/components/LinkPolicy';

const TABS = [
  { id: 'branding', label: 'Apparence' },
  { id: 'links', label: 'Liens' },
  { id: 'limits', label: 'Limites' },
  { id: 'auth', label: 'Connexion & SSO' },
  { id: 'mail', label: 'E-mails' },
  { id: 'storage', label: 'Stockage' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function AdminSettings() {
  const { tab = 'branding' } = useParams<{ tab: TabId }>();
  const [all, setAll] = useState<SettingsMap | null>(null);
  useEffect(() => { api.get<SettingsMap>('/api/admin/settings').then(setAll); }, []);
  if (!all) return <PageLoader />;
  const update = <K extends keyof SettingsMap>(k: K, v: SettingsMap[K]) => setAll({ ...all, [k]: v });

  return (
    <>
      <SectionTitle title="Réglages" />
      <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
        <nav className="flex lg:flex-col gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <NavLink key={t.id} to={`/admin/settings/${t.id}`}
              className={clsx('rounded-md px-3.5 h-10 flex items-center text-sm font-semibold whitespace-nowrap', tab === t.id ? 'bg-grad text-white' : 'text-ink-2 hover:bg-ink/5 hover:text-ink')}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          {tab === 'branding' && <Branding value={all.branding} onSaved={(v) => update('branding', v)} />}
          {tab === 'links' && <Links value={all.links} onSaved={(v) => update('links', v)} />}
          {tab === 'limits' && <Limits value={all.limits} onSaved={(v) => update('limits', v)} />}
          {tab === 'auth' && <Auth value={all.auth} onSaved={(v) => update('auth', v)} />}
          {tab === 'mail' && <Mail value={all.mail} onSaved={(v) => update('mail', v)} />}
          {tab === 'storage' && <Storage value={all.storage} onSaved={(v) => update('storage', v)} />}
        </div>
      </div>
    </>
  );
}

/** Local draft + save button for one settings key. */
function useDraft<K extends keyof SettingsMap>(key: K, value: SettingsMap[K], onSaved: (v: SettingsMap[K]) => void) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  async function save() {
    setSaving(true);
    try {
      const saved = await api.put<SettingsMap[K]>(`/api/admin/settings/${key}`, draft);
      onSaved(saved);
      setDraft(saved);
      toast.success('Réglages enregistrés');
      if (key === 'branding' || key === 'auth') useApp.getState().setConfig(await api.get<PublicConfig>('/api/public/config'));
    } catch (err) { toast.error(errorMessage(err), { duration: 6000 }); } finally { setSaving(false); }
  }
  const footer = <><Button variant="ghost" disabled={!dirty} onClick={() => setDraft(value)}>Annuler</Button><Button variant="accent" loading={saving} disabled={!dirty} onClick={save}>Enregistrer</Button></>;
  return { draft, setDraft, footer };
}

function Panel({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="card mb-6">
      <div className="px-5 pt-5">
        <h2 className="text-lg font-bold">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      <div className="px-5 py-5">{children}</div>
      {footer && <div className="sticky bottom-0 flex justify-end gap-2 rounded-b-2xl bg-surface px-5 py-4">{footer}</div>}
    </section>
  );
}

// ── Branding ───────────────────────────────────────────────────────────────

function Branding({ value, onSaved }: { value: SettingsMap['branding']; onSaved: (v: SettingsMap['branding']) => void }) {
  const { draft, setDraft, footer } = useDraft('branding', value, onSaved);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft({ ...draft, [k]: v });
  useEffect(() => { applyAccent(draft.accent); return () => applyAccent(useApp.getState().config?.branding.accent ?? draft.accent); }, [draft.accent]);

  async function uploaded(next: SettingsMap['branding']) {
    onSaved(next);
    setDraft({ ...draft, logoLight: next.logoLight, logoDark: next.logoDark, favicon: next.favicon });
    useApp.getState().setConfig(await api.get<PublicConfig>('/api/public/config'));
  }

  return (
    <>
      <Panel title="Identité" description="Personnalisez la page d’accueil et les pages publiques aux couleurs de votre entreprise." footer={footer}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Nom de l’instance"><Input value={draft.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Accroche"><Input value={draft.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
          <Field label="Message d’accueil" className="sm:col-span-2" hint="Grand titre de la page de connexion."><Textarea rows={2} value={draft.welcome} onChange={(e) => set('welcome', e.target.value)} /></Field>
          <Field label="Couleur d’accent">
            <div className="flex gap-2">
              <input type="color" value={draft.accent} onChange={(e) => set('accent', e.target.value.toUpperCase())} className="h-9 w-14 cursor-pointer rounded-lg bg-surface p-1" />
              <Input value={draft.accent} onChange={(e) => set('accent', e.target.value)} className="font-mono" />
            </div>
          </Field>
          <Field label="Pied de page"><Input value={draft.footer} onChange={(e) => set('footer', e.target.value)} placeholder="© Mon entreprise" /></Field>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {['#2563EB', '#0EA5E9', '#7C5CFF', '#00B37E', '#FF5A1F', '#E11D48', '#F5C400'].map((c) => (
            <button key={c} onClick={() => set('accent', c)} className={clsx('size-7 rounded-md', draft.accent.toUpperCase() === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-accent scale-110' : '')} style={{ background: c }} aria-label={c} />
          ))}
        </div>
      </Panel>
      <Panel title="Logos" description="PNG, SVG, WebP ou JPEG, 2 Mo max. Le logo sombre est utilisé en thème sombre (sinon le clair).">
        <div className="grid gap-4 sm:grid-cols-3">
          <LogoSlot slot="logoLight" label="Logo — thème clair" url={value.logoLight} onDone={uploaded} bg="bg-[#F4F4F0]" />
          <LogoSlot slot="logoDark" label="Logo — thème sombre" url={value.logoDark} onDone={uploaded} bg="bg-[#0A0A0B]" />
          <LogoSlot slot="favicon" label="Favicon" url={value.favicon} onDone={uploaded} bg="bg-surface-2" />
        </div>
      </Panel>
    </>
  );
}

function LogoSlot({ slot, label, url, onDone, bg }: { slot: string; label: string; url: string | null; onDone: (v: SettingsMap['branding']) => void; bg: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    try { onDone(await api.post(`/api/admin/branding/${slot}`, fd)); toast.success('Image enregistrée'); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-semibold">{label}</div>
      <button onClick={() => input.current?.click()} disabled={busy}
        className={clsx('flex h-32 w-full items-center justify-center rounded-md border border-dashed border-line-soft p-4 hover:bg-surface-3 transition', bg)}>
        {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="size-7 text-ink-3" />}
      </button>
      {url && <button onClick={async () => onDone(await api.del(`/api/admin/branding/${slot}`))} className="mt-2 flex items-center gap-1 text-xs font-semibold text-ink-3 hover:text-danger"><Trash2 className="size-3.5" />Retirer</button>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
    </div>
  );
}

// ── Links ──────────────────────────────────────────────────────────────────

function Links({ value, onSaved }: { value: SettingsMap['links']; onSaved: (v: SettingsMap['links']) => void }) {
  const { draft, setDraft, footer } = useDraft('links', value, onSaved);
  const [source, setSource] = useState<LinkSource>('web');
  const [reserved, setReserved] = useState(draft.reserved.join(', '));
  return (
    <>
      <Panel title="Format des liens"
        description={<>Les liens prennent la forme <span className="kbd">{window.location.host}/préfixe/nom</span>. Chaque option a une valeur par défaut et un cadenas : verrouillée, ni les profils ni les utilisateurs ne peuvent la modifier.</>}
        footer={footer}>
        <div className="mb-5"><Segmented value={source} onChange={setSource} options={LINK_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s].title }))} /></div>
        <p className="mb-4 text-sm text-ink-3">{SOURCE_LABELS[source].hint}</p>
        <AdminLinkEditor key={source} source={source} layer={draft.sources[source]} onChange={(l) => setDraft({ ...draft, sources: { ...draft.sources, [source]: l } })} />
      </Panel>
      <Panel title="Sécurité des liens" footer={footer}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Aléatoire minimum des liens publics" hint="Un lien public reçoit au besoin un suffixe aléatoire pour atteindre ce nombre de caractères imprévisibles. 0 = désactivé.">
            <Input type="number" min={0} max={32} value={draft.publicMinRandom} onChange={(e) => setDraft({ ...draft, publicMinRandom: Number(e.target.value) })} />
          </Field>
          <Field label="Préfixes réservés" hint="Séparés par des virgules. Interdits comme identifiant ou alias (en plus des routes système).">
            <Textarea rows={2} value={reserved} onChange={(e) => { setReserved(e.target.value); setDraft({ ...draft, reserved: e.target.value.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean) }); }} className="font-mono text-xs" />
          </Field>
        </div>
      </Panel>
    </>
  );
}

// ── Limits ─────────────────────────────────────────────────────────────────

function NumberField({ label, value, onChange, unit, hint }: { label: string; value: number; onChange: (n: number) => void; unit: string; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <Input type="number" min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} className="!pr-14" />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-3">{unit}</span>
      </div>
    </Field>
  );
}

function Limits({ value, onSaved }: { value: SettingsMap['limits']; onSaved: (v: SettingsMap['limits']) => void }) {
  const { draft, setDraft, footer } = useDraft('limits', value, onSaved);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft({ ...draft, [k]: v });
  return (
    <>
      <Panel title="Taille et quotas" description="Valeurs globales ; les profils peuvent les surcharger. 0 = illimité." footer={footer}>
        <div className="grid gap-5 sm:grid-cols-3">
          <NumberField label="Taille max / fichier" unit="Mo" value={draft.maxFileSizeMb} onChange={(v) => set('maxFileSizeMb', v)} />
          <NumberField label="Taille max / partage" unit="Mo" value={draft.maxShareSizeMb} onChange={(v) => set('maxShareSizeMb', v)} />
          <NumberField label="Quota par utilisateur" unit="Mo" value={draft.storageQuotaMb} onChange={(v) => set('storageQuotaMb', v)} />
          <NumberField label="Fragments en parallèle (défaut)" unit="×" value={draft.uploadParallel}
            onChange={(v) => set('uploadParallel', Math.min(draft.uploadParallelMax, Math.max(1, v)))}
            hint="Valeur des utilisateurs qui ne l’ont pas réglée, et des dépôts anonymes." />
          <NumberField label="Fragments en parallèle (max)" unit="×" value={draft.uploadParallelMax}
            onChange={(v) => { const max = Math.min(32, Math.max(1, v)); setDraft({ ...draft, uploadParallelMax: max, uploadParallel: Math.min(draft.uploadParallel, max) }); }}
            hint="Plafond que chacun peut choisir (1 à 32), appliqué aussi par le serveur." />
        </div>
      </Panel>
      <Panel title="Durée de vie" footer={footer}>
        <div className="grid gap-5 sm:grid-cols-3">
          <NumberField label="Expiration par défaut" unit="h" value={draft.defaultExpiryHours} onChange={(v) => set('defaultExpiryHours', v)} hint="168 h = 7 jours" />
          <NumberField label="Expiration maximale" unit="h" value={draft.maxExpiryHours} onChange={(v) => set('maxExpiryHours', v)} hint="0 = pas de plafond" />
          <NumberField label="Durée max des demandes" unit="h" value={draft.requestMaxExpiryHours} onChange={(v) => set('requestMaxExpiryHours', v)} />
        </div>
        <div className="mt-5"><Toggle checked={draft.allowNeverExpire} onChange={(v) => set('allowNeverExpire', v)} label="Autoriser les partages sans expiration" /></div>
      </Panel>
      <Panel title="Visibilité" footer={footer}>
        <div className="space-y-5">
          <Toggle checked={draft.allowPublic} onChange={(v) => set('allowPublic', v)} label="Autoriser les liens publics" description="Sinon, tous les partages exigent un compte pour être ouverts." />
          <Field label="Visibilité par défaut"><Segmented value={draft.defaultVisibility} onChange={(v) => set('defaultVisibility', v)} options={[{ value: 'private', label: 'Privé' }, { value: 'public', label: 'Public' }]} /></Field>
        </div>
      </Panel>
      <Panel title="ShareX" description="Valeurs par défaut des envois ShareX. Le générateur de configuration permet à chacun d’ajuster dans ces limites." footer={footer}>
        <div className="mb-5"><Toggle checked={draft.sharexEnabled} onChange={(v) => set('sharexEnabled', v)} label="ShareX activé par défaut" description="Peut être activé ou désactivé par profil (Admin → Profils)." /></div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Visibilité des captures"><Segmented value={draft.sharexVisibility} onChange={(v) => set('sharexVisibility', v)} options={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Privé' }]} /></Field>
          <NumberField label="Expiration des captures" unit="h" value={draft.sharexExpiryHours} onChange={(v) => set('sharexExpiryHours', v)} hint="0 = jamais (si autorisé), sinon le plafond s’applique" />
          <Field label="Domaines alternatifs" hint="Un par ligne, ex. i.exemple.fr. Ils doivent pointer vers cette instance ; chacun peut les choisir dans sa config ShareX." className="sm:col-span-2">
            <Textarea rows={2} value={draft.sharexDomains.join('\n')} onChange={(e) => set('sharexDomains', e.target.value.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean))} className="font-mono text-xs" />
          </Field>
        </div>
      </Panel>
    </>
  );
}

// ── Auth ───────────────────────────────────────────────────────────────────

function Auth({ value, onSaved }: { value: SettingsMap['auth']; onSaved: (v: SettingsMap['auth']) => void }) {
  const { draft, setDraft, footer } = useDraft('auth', value, onSaved);
  const o = draft.oidc;
  const setO = <K extends keyof typeof o>(k: K, v: (typeof o)[K]) => setDraft({ ...draft, oidc: { ...o, [k]: v } });
  const redirect = `${window.location.origin}/auth/oidc/callback`;
  const list = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  return (
    <>
      <Panel title="Microsoft Entra ID" footer={footer}
        description="Enregistrez une application dans Entra ID (Inscriptions d’applications), type Web, avec l’URI de redirection ci-dessous et un secret client. Pour le mapping des groupes, ajoutez la revendication « groups » (ID de sécurité) dans « Configuration du jeton ».">
        <div className="space-y-5">
          <Toggle checked={o.enabled} onChange={(v) => setO('enabled', v)} label="Activer la connexion Microsoft" />
          <Field label="URI de redirection à déclarer">
            <div className="flex gap-2"><Input readOnly value={redirect} className="font-mono text-xs" /><Button icon={<Copy className="size-4" />} onClick={() => copyText(redirect, 'URI copiée')} /></div>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="ID de l’annuaire (tenant)"><Input value={o.tenantId} onChange={(e) => setO('tenantId', e.target.value.trim())} className="font-mono text-xs" /></Field>
            <Field label="ID d’application (client)"><Input value={o.clientId} onChange={(e) => setO('clientId', e.target.value.trim())} className="font-mono text-xs" /></Field>
            <Field label="Secret client"><Input type="password" value={o.clientSecret} onChange={(e) => setO('clientSecret', e.target.value)} autoComplete="off" /></Field>
            <Field label="Libellé du bouton"><Input value={o.buttonLabel} onChange={(e) => setO('buttonLabel', e.target.value)} /></Field>
          </div>
          <Toggle checked={o.autoCreate} onChange={(v) => setO('autoCreate', v)} label="Créer les comptes à la première connexion" />
          <Field label="Profil des nouveaux comptes SSO" hint="Attribué à la création quand aucun groupe Entra ne correspond à un profil (Admin → Profils).">
            <ProfileSelect value={o.defaultProfileId} onChange={(v) => setO('defaultProfileId', v)} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Groupes administrateurs" hint="Object ID, un par ligne. Vide = rôles gérés dans Ferry.">
              <Textarea value={o.adminGroups.join('\n')} onChange={(e) => setO('adminGroups', list(e.target.value))} className="font-mono text-xs" />
            </Field>
            <Field label="Groupes autorisés" hint="Vide = tout le tenant peut se connecter.">
              <Textarea value={o.allowedGroups.join('\n')} onChange={(e) => setO('allowedGroups', list(e.target.value))} className="font-mono text-xs" />
            </Field>
          </div>
        </div>
      </Panel>
      <Panel title="Comptes locaux" footer={footer}>
        <Toggle checked={draft.localLogin} onChange={(v) => setDraft({ ...draft, localLogin: v })} label="Autoriser la connexion par identifiant / mot de passe"
          description="Désactivez-la une fois le SSO opérationnel. Vérifiez d’abord qu’un administrateur peut se connecter via Microsoft." />
      </Panel>
      <Registration value={draft.registration} localLogin={draft.localLogin} onChange={(r) => setDraft({ ...draft, registration: r })} footer={footer} />
    </>
  );
}

function ProfileSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [profiles, setProfiles] = useState<QuotaProfile[]>([]);
  useEffect(() => { api.get<QuotaProfile[]>('/api/admin/profiles').then(setProfiles).catch(() => {}); }, []);
  const def = profiles.find((p) => p.isDefault);
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{def ? `Profil par défaut (${def.name})` : 'Réglages globaux'}</option>
      {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </Select>
  );
}

const REG_MODES: { value: RegistrationMode; label: string; hint: string }[] = [
  { value: 'disabled', label: 'Désactivée', hint: 'Seuls les administrateurs créent des comptes (directement ou par invitation).' },
  { value: 'open', label: 'Ouverte', hint: 'Le compte est actif immédiatement.' },
  { value: 'email', label: 'Validation par e-mail', hint: 'Un lien de confirmation est envoyé à l’adresse saisie.' },
  { value: 'approval', label: 'Validation par un administrateur', hint: 'Les administrateurs sont prévenus et valident chaque compte.' },
  { value: 'email_approval', label: 'E-mail puis administrateur', hint: 'Adresse confirmée, puis validation par un administrateur.' },
];

function Registration({ value, localLogin, onChange, footer }: {
  value: SettingsMap['auth']['registration']; localLogin: boolean; onChange: (v: SettingsMap['auth']['registration']) => void; footer: ReactNode;
}) {
  const mailEnabled = useApp((s) => s.config?.mailEnabled);
  const needsMail = value.mode !== 'disabled' && value.mode !== 'open';
  const [domains, setDomains] = useState(value.allowedDomains.join(', '));
  return (
    <Panel title="Inscription" footer={footer}
      description="Lien « Créer un compte » sur la page de connexion. Les invitations envoyées depuis Admin → Utilisateurs fonctionnent même quand l’inscription est désactivée.">
      <div className="space-y-5">
        <div className="grid gap-2">
          {REG_MODES.map((m) => (
            <button key={m.value} type="button" onClick={() => onChange({ ...value, mode: m.value })}
              className={clsx('flex items-start gap-3 rounded-md p-3 text-left transition', value.mode === m.value ? 'bg-grad-soft ring-1 ring-accent/50' : 'bg-surface-2 hover:bg-surface-3')}>
              <span className={clsx('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full', value.mode === m.value ? 'bg-grad' : 'bg-surface-3')}>
                {value.mode === m.value && <span className="size-1.5 rounded-full bg-white" />}
              </span>
              <span><span className="block text-[13px] font-semibold">{m.label}</span><span className="block text-xs text-ink-3">{m.hint}</span></span>
            </button>
          ))}
        </div>
        {value.mode !== 'disabled' && !localLogin && <p className="rounded-md bg-warn/15 px-3 py-2 text-xs font-semibold">La connexion locale est désactivée : l’inscription ne sera pas proposée.</p>}
        {needsMail && !mailEnabled && <p className="rounded-md bg-warn/15 px-3 py-2 text-xs font-semibold">Aucun envoi d’e-mail n’est configuré (Réglages → E-mails) : les messages de validation ne partiront pas.</p>}
        {value.mode !== 'disabled' && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Domaines autorisés" hint="Séparés par des virgules, ex. agitel.fr. Vide = toute adresse.">
              <Input value={domains} placeholder="exemple.fr"
                onChange={(e) => { setDomains(e.target.value); onChange({ ...value, allowedDomains: e.target.value.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean) }); }} />
            </Field>
            <Field label="Profil des comptes inscrits" hint="Les invitations ont leur propre profil.">
              <ProfileSelect value={value.defaultProfileId} onChange={(v) => onChange({ ...value, defaultProfileId: v })} />
            </Field>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ── Mail ───────────────────────────────────────────────────────────────────

function Mail({ value, onSaved }: { value: SettingsMap['mail']; onSaved: (v: SettingsMap['mail']) => void }) {
  const { draft, setDraft, footer } = useDraft('mail', value, onSaved);
  const s = draft.smtp;
  const g = draft.graph;
  return (
    <>
      <Panel title="Envoi d’e-mails" description="Liens de partage et de dépôt envoyés par e-mail, notifications de dépôt et de téléchargement." footer={footer}>
        <div className="space-y-5">
          <Field label="Méthode">
            <Segmented value={draft.provider} onChange={(v) => setDraft({ ...draft, provider: v })}
              options={[{ value: 'none', label: 'Désactivé' }, { value: 'smtp', label: 'SMTP' }, { value: 'graph', label: 'Microsoft Graph' }]} />
          </Field>
          {draft.provider !== 'none' && <Field label="Expéditeur" hint={draft.provider === 'smtp' ? 'Ex. Ferry <ferry@exemple.fr>' : 'Utilisé si la boîte d’envoi ci-dessous est vide'}><Input value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></Field>}
          {draft.provider === 'smtp' && (
            <div className="grid gap-5 sm:grid-cols-[1fr_120px]">
              <Field label="Serveur"><Input value={s.host} onChange={(e) => setDraft({ ...draft, smtp: { ...s, host: e.target.value } })} /></Field>
              <Field label="Port"><Input type="number" value={s.port} onChange={(e) => setDraft({ ...draft, smtp: { ...s, port: Number(e.target.value) } })} /></Field>
              <Field label="Utilisateur"><Input value={s.user} onChange={(e) => setDraft({ ...draft, smtp: { ...s, user: e.target.value } })} autoComplete="off" /></Field>
              <Field label="Mot de passe"><Input type="password" value={s.pass} onChange={(e) => setDraft({ ...draft, smtp: { ...s, pass: e.target.value } })} autoComplete="off" /></Field>
              <div className="sm:col-span-2"><Toggle checked={s.secure} onChange={(v) => setDraft({ ...draft, smtp: { ...s, secure: v } })} label="TLS implicite (port 465)" description="Désactivé : STARTTLS si le serveur le propose (port 587)." /></div>
            </div>
          )}
          {draft.provider === 'graph' && (
            <>
              <p className="text-sm text-ink-3">Application Entra ID avec la permission d’application <span className="kbd">Mail.Send</span> (consentement administrateur). Elle peut être la même que pour le SSO.</p>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="ID du tenant"><Input value={g.tenantId} onChange={(e) => setDraft({ ...draft, graph: { ...g, tenantId: e.target.value.trim() } })} className="font-mono text-xs" /></Field>
                <Field label="ID d’application"><Input value={g.clientId} onChange={(e) => setDraft({ ...draft, graph: { ...g, clientId: e.target.value.trim() } })} className="font-mono text-xs" /></Field>
                <Field label="Secret client"><Input type="password" value={g.clientSecret} onChange={(e) => setDraft({ ...draft, graph: { ...g, clientSecret: e.target.value } })} autoComplete="off" /></Field>
                <Field label="Boîte d’envoi" hint="UPN ou adresse de la boîte qui envoie"><Input value={g.sender} onChange={(e) => setDraft({ ...draft, graph: { ...g, sender: e.target.value.trim() } })} /></Field>
              </div>
            </>
          )}
          {draft.provider !== 'none' && <MailTest mail={draft} event="share_invite" title="Tester l’envoi" />}
        </div>
      </Panel>
      <MailTemplatesEditor value={draft.templates} onChange={(t) => setDraft({ ...draft, templates: t })} footer={footer} mail={draft} />
    </>
  );
}

const THEME_INFO: Record<MailTheme, { label: string; hint: string; swatch: string }> = {
  signal: { label: 'Signal', hint: 'Sombre, bandeau dégradé', swatch: 'linear-gradient(135deg,#0b101f 0 45%,#2563eb 45% 75%,#0ea5e9 75%)' },
  minimal: { label: 'Minimal', hint: 'Clair et épuré', swatch: 'linear-gradient(135deg,#f4f3f8 0 55%,#ffffff 55%)' },
  corporate: { label: 'Corporate', hint: 'Logo, bandeau d’accent', swatch: 'linear-gradient(180deg,#2563eb 0 14%,#ffffff 14% 60%,#eef0f4 60%)' },
  sunset: { label: 'Sunset', hint: 'Dégradé chaud', swatch: 'linear-gradient(135deg,#fb923c,#f43f5e 60%,#ffffff 60%)' },
};

const EVENT_INFO: Record<MailEventKey, { label: string; hint: string }> = {
  share_invite: { label: 'Partage envoyé', hint: 'Envoyé aux destinataires saisis lors d’un partage' },
  request_invite: { label: 'Demande de dépôt', hint: 'Envoyé aux personnes invitées à déposer des fichiers' },
  request_received: { label: 'Dépôt reçu', hint: 'Notifie le demandeur quand des fichiers arrivent' },
  share_downloaded: { label: 'Premier téléchargement', hint: 'Notifie l’auteur d’un partage (si l’option est cochée)' },
  account_invite: { label: 'Invitation', hint: 'Lien de création de compte envoyé par un administrateur' },
  account_verify: { label: 'Vérification', hint: 'Confirmation de l’adresse e-mail à l’inscription' },
  account_pending: { label: 'Compte à valider', hint: 'Envoyé aux administrateurs quand une inscription attend leur validation' },
  account_approved: { label: 'Compte validé', hint: 'Prévient l’utilisateur que son compte est activé' },
};

interface MailMeta { variables: Record<MailEventKey, string[]>; defaults: MailTemplateSettings }

/** Sends one sample e-mail with the form values as typed (saved or not). */
function MailTest({ mail, event, title }: { mail: SettingsMap['mail']; event: MailEventKey; title: string }) {
  const me = useApp((s) => s.me)!;
  const [to, setTo] = useState(me.email ?? '');
  const [testing, setTesting] = useState(false);
  async function test() {
    setTesting(true);
    try { await api.post('/api/admin/settings/mail/test', { to, event, settings: mail }); toast.success(`E-mail envoyé à ${to}`); }
    catch (err) { toast.error(errorMessage(err), { duration: 10000 }); } finally { setTesting(false); }
  }
  return (
    <div className="rounded-md bg-surface-2 p-3">
      <div className="mb-2 text-[13px] font-semibold">{title} <span className="font-normal text-ink-3">(valeurs saisies, même non enregistrées)</span></div>
      <div className="flex gap-2">
        <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="destinataire@exemple.fr" />
        <Button variant="accent" loading={testing} disabled={!to} onClick={test}>Envoyer</Button>
      </div>
    </div>
  );
}

function MailTemplatesEditor({ value, onChange, footer, mail }: {
  value: MailTemplateSettings; onChange: (t: MailTemplateSettings) => void; footer: ReactNode; mail: SettingsMap['mail'];
}) {
  const [event, setEvent] = useState<MailEventKey>('share_invite');
  const [meta, setMeta] = useState<MailMeta | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const tpl = value.events[event];
  const setTpl = (patch: Partial<MailEventTemplate>) => onChange({ ...value, events: { ...value.events, [event]: { ...tpl, ...patch } } });

  useEffect(() => { api.get<MailMeta>('/api/admin/mail/meta').then(setMeta); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      api.post<{ subject: string; html: string }>('/api/admin/mail/preview', { event, templates: value }).then(setPreview).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [event, value]);

  function insertVar(v: string) {
    const el = bodyRef.current;
    const token = `{{${v}}}`;
    if (!el) return setTpl({ body: tpl.body + token });
    const { selectionStart: a, selectionEnd: b } = el;
    setTpl({ body: tpl.body.slice(0, a) + token + tpl.body.slice(b) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); });
  }


  return (
    <Panel title="Modèles d’e-mails" description="Choisissez un thème et adaptez les textes. HTML compatible Outlook, Gmail et mobile, avec une version texte." footer={footer}>
      <div className="space-y-6">
        <div>
          <div className="label mb-2">Thème</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MAIL_THEMES.map((t) => (
              <button key={t} type="button" onClick={() => onChange({ ...value, theme: t })}
                className={clsx('rounded-md p-2 text-left transition', value.theme === t ? 'bg-grad-soft ring-2 ring-accent' : 'bg-surface-2 hover:bg-surface-3')}>
                <div className="h-14 rounded" style={{ background: THEME_INFO[t].swatch }} />
                <div className="mt-2 text-[13px] font-semibold">{THEME_INFO[t].label}</div>
                <div className="text-[11px] text-ink-3">{THEME_INFO[t].hint}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Toggle checked={value.showLogo} onChange={(v) => onChange({ ...value, showLogo: v })} label="Afficher le logo" description="Logo PNG/JPEG de l’apparence (les SVG ne s’affichent pas dans la plupart des messageries)." />
          <Field label="Pied de page"><Input value={value.footer} onChange={(e) => onChange({ ...value, footer: e.target.value })} placeholder="Ex. Service informatique — 01 23 45 67 89" /></Field>
        </div>

        <div>
          <div className="label mb-2">E-mail</div>
          <Segmented value={event} onChange={setEvent} options={MAIL_EVENTS.map((e) => ({ value: e, label: EVENT_INFO[e].label }))} />
          <p className="mt-2 text-xs text-ink-3">{EVENT_INFO[event].hint}</p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
          <div className="space-y-4">
            <Field label="Objet"><Input value={tpl.subject} onChange={(e) => setTpl({ subject: e.target.value })} /></Field>
            <Field label="Titre"><Input value={tpl.heading} onChange={(e) => setTpl({ heading: e.target.value })} /></Field>
            <Field label="Texte" hint="Une ligne dont toutes les variables sont vides est masquée. {{message}} s’affiche en citation.">
              <Textarea ref={bodyRef} rows={5} value={tpl.body} onChange={(e) => setTpl({ body: e.target.value })} className="font-mono text-xs" />
            </Field>
            {meta && (
              <div className="flex flex-wrap gap-1.5">
                {meta.variables[event].map((v) => (
                  <button key={v} type="button" onClick={() => insertVar(v)} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2 hover:bg-surface-3 hover:text-ink">{`{{${v}}}`}</button>
                ))}
              </div>
            )}
            <Field label="Bouton"><Input value={tpl.button} onChange={(e) => setTpl({ button: e.target.value })} /></Field>
            {meta && <Button size="sm" variant="ghost" onClick={() => setTpl(meta.defaults.events[event])}>Rétablir le texte par défaut</Button>}
            {mail.provider !== 'none' && <MailTest mail={{ ...mail, templates: value }} event={event} title="Envoyer cet e-mail en test" />}
          </div>
          <div>
            <div className="mb-2 flex h-9 items-center gap-2 rounded-md bg-surface-2 px-3 text-[13px]">
              <span className="shrink-0 text-ink-3">Objet :</span><span className="min-w-0 truncate font-semibold">{preview?.subject ?? '…'}</span>
            </div>
            <iframe title="Aperçu de l’e-mail" sandbox="" srcDoc={preview?.html ?? ''} className="h-[560px] w-full rounded-md bg-white" />
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ── Storage ────────────────────────────────────────────────────────────────

function Storage({ value, onSaved }: { value: SettingsMap['storage']; onSaved: (v: SettingsMap['storage']) => void }) {
  const { draft, setDraft, footer } = useDraft('storage', value, onSaved);
  const s = draft.s3;
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setDraft({ ...draft, s3: { ...s, [k]: v } });
  return (
    <Panel title="Stockage des fichiers" footer={footer}
      description="S’applique aux nouveaux envois. Les fichiers existants restent lisibles là où ils ont été écrits. Les miniatures restent sur le volume local.">
      <div className="space-y-5">
        <Segmented value={draft.driver} onChange={(v) => setDraft({ ...draft, driver: v })} options={[{ value: 'local', label: 'Volume local' }, { value: 's3', label: 'S3 compatible' }]} />
        {draft.driver === 'local' ? (
          <p className="text-sm text-ink-2">Les fichiers sont écrits dans <span className="kbd">/data/files</span> du conteneur serveur : montez-y un volume persistant.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Endpoint" hint="Vide pour AWS. Ex. https://minio.exemple.fr" className="sm:col-span-2"><Input value={s.endpoint} onChange={(e) => set('endpoint', e.target.value.trim())} /></Field>
            <Field label="Bucket"><Input value={s.bucket} onChange={(e) => set('bucket', e.target.value.trim())} /></Field>
            <Field label="Région"><Input value={s.region} onChange={(e) => set('region', e.target.value.trim())} /></Field>
            <Field label="Access key"><Input value={s.accessKeyId} onChange={(e) => set('accessKeyId', e.target.value.trim())} autoComplete="off" /></Field>
            <Field label="Secret key"><Input type="password" value={s.secretAccessKey} onChange={(e) => set('secretAccessKey', e.target.value)} autoComplete="off" /></Field>
            <Field label="Préfixe des objets" hint="Optionnel, ex. ferry/"><Input value={s.prefix} onChange={(e) => set('prefix', e.target.value.trim())} /></Field>
            <Field label="Adressage">
              <Select value={s.forcePathStyle ? 'path' : 'vhost'} onChange={(e) => set('forcePathStyle', e.target.value === 'path')}>
                <option value="path">Path-style (MinIO, Garage…)</option><option value="vhost">Virtual-hosted (AWS)</option>
              </Select>
            </Field>
          </div>
        )}
        {draft.driver === 's3' && <p className="text-xs text-ink-3">La connexion au bucket est vérifiée à l’enregistrement.</p>}
      </div>
    </Panel>
  );
}
