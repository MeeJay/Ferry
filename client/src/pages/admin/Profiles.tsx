import { useCallback, useEffect, useState } from 'react';
import { Layers, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { PolicyLayer, QuotaProfile } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { Badge, Button, Confirm, Empty, Field, IconButton, Input, Modal, PageLoader, SectionTitle, Segmented, Textarea, Toggle } from '@/components/ui';
import { AdminLinkEditor } from '@/components/LinkPolicy';

export default function AdminProfiles() {
  const [items, setItems] = useState<QuotaProfile[] | null>(null);
  const [editing, setEditing] = useState<QuotaProfile | 'new' | null>(null);
  const [del, setDel] = useState<QuotaProfile | null>(null);
  const load = useCallback(() => { api.get<QuotaProfile[]>('/api/admin/profiles').then(setItems); }, []);
  useEffect(load, [load]);
  if (!items) return <PageLoader />;

  const num = (v: number | null, unit: string) => (v === null ? <span className="text-ink-3">hérité</span> : v === 0 ? 'illimité' : `${v} ${unit}`);

  return (
    <>
      <SectionTitle title="Profils"
        subtitle="Des limites et des règles de liens par groupe d’utilisateurs. Un champ vide hérite des réglages globaux."
        action={<Button variant="accent" size="lg" icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>Nouveau profil</Button>} />
      {items.length === 0 ? (
        <Empty icon={<Layers className="size-6" />} title="Aucun profil" action={<Button variant="accent" onClick={() => setEditing('new')}>Créer un profil</Button>}>
          Sans profil, tout le monde utilise les réglages globaux. Créez-en pour différencier par exemple la Direction, les Stagiaires…
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((p) => (
            <div key={p.id} className="card p-5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><h3 className="text-base font-bold">{p.name}</h3>{p.isDefault && <Badge tone="accent"><Star className="size-3" />Défaut</Badge>}</div>
                  {p.description && <p className="mt-1 text-sm text-ink-3">{p.description}</p>}
                </div>
                <IconButton label="Modifier" onClick={() => setEditing(p)}><Pencil className="size-4" /></IconButton>
                <IconButton label="Supprimer" className="hover:!text-danger" onClick={() => setDel(p)}><Trash2 className="size-4" /></IconButton>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-3">Quota</dt><dd className="font-semibold">{num(p.storageQuotaMb, 'Mo')}</dd>
                <dt className="text-ink-3">Par fichier</dt><dd className="font-semibold">{num(p.maxFileSizeMb, 'Mo')}</dd>
                <dt className="text-ink-3">Expiration max</dt><dd className="font-semibold">{num(p.maxExpiryHours, 'h')}</dd>
                <dt className="text-ink-3">Utilisateurs</dt><dd className="font-semibold">{p.userCount}{p.oidcGroups.length ? ` · ${p.oidcGroups.length} groupe(s) Entra` : ''}</dd>
              </dl>
            </div>
          ))}
        </div>
      )}
      {editing && <ProfileModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      <Confirm open={!!del} onClose={() => setDel(null)} title={`Supprimer « ${del?.name} » ?`}
        onConfirm={async () => { await api.del(`/api/admin/profiles/${del!.id}`); setDel(null); load(); }}>
        Ses utilisateurs repasseront sur le profil par défaut ou les réglages globaux.
      </Confirm>
    </>
  );
}

type Tri = 'inherit' | 'yes' | 'no';
const toTri = (v: boolean | null): Tri => (v === null ? 'inherit' : v ? 'yes' : 'no');
const fromTri = (t: Tri) => (t === 'inherit' ? null : t === 'yes');

function NumField({ label, value, onChange, unit }: { label: string; value: number | null; onChange: (v: number | null) => void; unit: string }) {
  return (
    <Field label={label} hint={value === null ? 'Hérité' : value === 0 ? 'Illimité' : undefined}>
      <div className="relative">
        <Input type="number" min={0} value={value ?? ''} placeholder="Hérité" onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className="!pr-12" />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-3">{unit}</span>
      </div>
    </Field>
  );
}

function ProfileModal({ initial, onClose, onSaved }: { initial: QuotaProfile | null; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState<Omit<QuotaProfile, 'id'>>(() => initial ?? {
    name: '', description: '', maxFileSizeMb: null, maxShareSizeMb: null, storageQuotaMb: null, defaultExpiryHours: null,
    maxExpiryHours: null, allowNeverExpire: null, allowPublic: null, sharexEnabled: null, linkPolicy: {}, oidcGroups: [], isDefault: false,
  });
  const [groups, setGroups] = useState((initial?.oidcGroups ?? []).join('\n'));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => setP({ ...p, [k]: v });

  async function save() {
    setSaving(true);
    const body = { ...p, oidcGroups: groups.split(/[\s,;]+/).map((g) => g.trim()).filter(Boolean) };
    delete (body as any).userCount;
    try {
      if (initial) await api.patch(`/api/admin/profiles/${initial.id}`, body);
      else await api.post('/api/admin/profiles', body);
      toast.success('Profil enregistré');
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={initial ? initial.name : 'Nouveau profil'} width="max-w-3xl"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="accent" loading={saving} disabled={!p.name.trim()} onClick={save}>Enregistrer</Button></>}>
      <div className="space-y-8">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Nom"><Input value={p.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Description"><Input value={p.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <div className="sm:col-span-2"><Toggle checked={p.isDefault} onChange={(v) => set('isDefault', v)} label="Profil par défaut" description="Appliqué aux utilisateurs sans profil explicite." /></div>
        </div>
        <div>
          <div className="label mb-3">Limites</div>
          <div className="grid gap-5 sm:grid-cols-3">
            <NumField label="Quota de stockage" unit="Mo" value={p.storageQuotaMb} onChange={(v) => set('storageQuotaMb', v)} />
            <NumField label="Taille max / fichier" unit="Mo" value={p.maxFileSizeMb} onChange={(v) => set('maxFileSizeMb', v)} />
            <NumField label="Taille max / partage" unit="Mo" value={p.maxShareSizeMb} onChange={(v) => set('maxShareSizeMb', v)} />
            <NumField label="Expiration par défaut" unit="h" value={p.defaultExpiryHours} onChange={(v) => set('defaultExpiryHours', v)} />
            <NumField label="Expiration max" unit="h" value={p.maxExpiryHours} onChange={(v) => set('maxExpiryHours', v)} />
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field label="Liens sans expiration"><Segmented size="sm" value={toTri(p.allowNeverExpire)} onChange={(t) => set('allowNeverExpire', fromTri(t))} options={[{ value: 'inherit', label: 'Hérité' }, { value: 'yes', label: 'Autorisés' }, { value: 'no', label: 'Interdits' }]} /></Field>
            <Field label="Liens publics"><Segmented size="sm" value={toTri(p.allowPublic)} onChange={(t) => set('allowPublic', fromTri(t))} options={[{ value: 'inherit', label: 'Hérité' }, { value: 'yes', label: 'Autorisés' }, { value: 'no', label: 'Interdits' }]} /></Field>
            <Field label="ShareX & API"><Segmented size="sm" value={toTri(p.sharexEnabled)} onChange={(t) => set('sharexEnabled', fromTri(t))} options={[{ value: 'inherit', label: 'Hérité' }, { value: 'yes', label: 'Activé' }, { value: 'no', label: 'Désactivé' }]} /></Field>
          </div>
        </div>
        <Field label="Groupes Entra ID (Object ID)" hint="Un par ligne. À chaque connexion SSO, un membre de l’un de ces groupes reçoit ce profil.">
          <Textarea value={groups} onChange={(e) => setGroups(e.target.value)} className="font-mono text-xs" placeholder="00000000-0000-0000-0000-000000000000" />
        </Field>
        <div>
          <div className="label mb-1">Règles de liens</div>
          <p className="mb-3 text-sm text-ink-3">S’appliquent par-dessus les réglages globaux, pour toutes les sources. Une option verrouillée globalement ne peut pas être changée ici.</p>
          <AdminLinkEditor source="web" inheritable layer={p.linkPolicy} onChange={(l: PolicyLayer) => set('linkPolicy', l)} />
        </div>
      </div>
    </Modal>
  );
}
