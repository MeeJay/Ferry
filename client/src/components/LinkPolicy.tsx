import { useMemo, useState, type ReactNode } from 'react';
import { RefreshCw, Lock, Unlock } from 'lucide-react';
import clsx from 'clsx';
import {
  buildName, buildPrefix, LINK_OPTION_KEYS, DEFAULT_LINK_OPTIONS, randomCharsIn, SYSTEM_RESERVED,
  type LinkIdentity, type LinkOptionKey, type LinkOptions, type LinkSource, type PolicyLayer, type ResolvedLinkPolicy,
} from '@ferry/shared';
import { Input, LockTag, Segmented, Select, Toggle } from './ui';

export const SOURCE_LABELS: Record<LinkSource, { title: string; hint: string; sample: string }> = {
  web: { title: 'Partages', hint: 'Fichiers envoyés depuis l’interface', sample: 'Rapport annuel 2026.pdf' },
  sharex: { title: 'ShareX', hint: 'Captures et fichiers envoyés via l’API', sample: 'capture.png' },
  request: { title: 'Demandes de dépôt', hint: 'Liens envoyés pour recevoir des fichiers', sample: 'Pièces fournisseur' },
};

const OPTION_LABELS: Record<LinkOptionKey, string> = {
  prefixMode: 'Préfixe',
  prefixLength: 'Longueur du préfixe aléatoire',
  nameMode: 'Nom',
  nameLength: 'Longueur de l’aléatoire',
  alphabet: 'Caractères aléatoires',
  keepExtension: 'Conserver l’extension',
  sanitize: 'Nettoyer le nom (accents, espaces, majuscules)',
};

function visible(k: LinkOptionKey, o: LinkOptions) {
  if (k === 'prefixLength') return o.prefixMode === 'random';
  if (k === 'nameLength') return o.nameMode === 'random' || o.nameMode === 'original_random';
  if (k === 'alphabet') return o.prefixMode === 'random' || o.nameMode === 'random' || o.nameMode === 'original_random';
  if (k === 'sanitize') return o.nameMode === 'original' || o.nameMode === 'original_random';
  return true;
}

function OptionControl<K extends LinkOptionKey>({ k, value, onChange, disabled }: {
  k: K; value: LinkOptions[K]; onChange: (v: LinkOptions[K]) => void; disabled?: boolean;
}) {
  const set = onChange as (v: unknown) => void;
  switch (k) {
    case 'prefixMode':
      return <Segmented size="sm" disabled={disabled} value={value as string} onChange={set} options={[
        { value: 'username', label: 'Pseudo' }, { value: 'usercode', label: 'Code perso' }, { value: 'random', label: 'Aléatoire' },
        { value: 'vanity', label: 'Alias' }, { value: 'none', label: 'Aucun' },
      ]} />;
    case 'nameMode':
      return (
        <Select disabled={disabled} value={value as string} onChange={(e) => set(e.target.value)} className="!h-10 !text-sm max-w-xs">
          <option value="original">Nom d’origine</option>
          <option value="original_random">Nom d’origine + aléatoire</option>
          <option value="random">Aléatoire</option>
          <option value="words">Mots aléatoires</option>
          <option value="timestamp">Horodatage</option>
          <option value="uuid">UUID</option>
        </Select>
      );
    case 'alphabet':
      return <Segmented size="sm" disabled={disabled} value={value as string} onChange={set} options={[
        { value: 'base62', label: 'Aa0' }, { value: 'lower', label: 'a0' }, { value: 'unambiguous', label: 'Sans ambiguïté' },
      ]} />;
    case 'prefixLength':
    case 'nameLength':
      return <Input type="number" min={k === 'prefixLength' ? 3 : 2} max={32} disabled={disabled} value={value as number}
        onChange={(e) => set(Number(e.target.value))} className="!h-10 !w-24 !text-sm" />;
    default:
      return <Toggle disabled={disabled} checked={value as boolean} onChange={set} />;
  }
}

function Row({ label, locked, children, extra }: { label: string; locked?: ReactNode; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 border-b-2 border-line-soft last:border-0">
      <div className="flex items-center gap-2 text-sm font-bold">{label}{locked}</div>
      <div className="flex items-center gap-3">{children}{extra}</div>
    </div>
  );
}

export function LinkPreview({ options, identity, sample, publicMin = 0 }: { options: LinkOptions; identity: LinkIdentity; sample: string; publicMin?: number }) {
  const [seed, setSeed] = useState(0);
  const url = useMemo(() => {
    const extra = publicMin > 0 ? Math.max(0, publicMin - randomCharsIn(options)) : 0;
    let prefix = buildPrefix(options, identity);
    if (prefix && SYSTEM_RESERVED.includes(prefix)) prefix = identity.userCode; // mirrors the server fallback
    const name = buildName(sample, options, extra);
    return { prefix, name };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, identity, sample, publicMin, seed]);
  return (
    <div className="flex items-center gap-2 rounded-xl bg-ink text-bg px-4 h-12 font-mono text-[13px] overflow-hidden">
      <span className="opacity-50 shrink-0">{window.location.host}/</span>
      <span className="truncate">
        {url.prefix && <><span className="text-accent font-bold">{url.prefix}</span><span className="opacity-50">/</span></>}
        <span className="font-bold">{url.name}</span>
      </span>
      <button className="ml-auto shrink-0 opacity-60 hover:opacity-100" onClick={() => setSeed(seed + 1)} title="Régénérer l’exemple"><RefreshCw className="size-4" /></button>
    </div>
  );
}

/** User-facing editor: locked options are shown read-only with their imposed value. */
export function UserLinkEditor({ source, policy, value, onChange, identity, publicMin, compact }: {
  source: LinkSource;
  policy: ResolvedLinkPolicy;
  value: Partial<LinkOptions>;
  onChange: (v: Partial<LinkOptions>) => void;
  identity: LinkIdentity;
  publicMin?: number;
  compact?: boolean;
}) {
  const effective = { ...policy.options } as LinkOptions;
  for (const k of LINK_OPTION_KEYS) if (!policy.locked[k] && value[k] !== undefined) (effective as any)[k] = value[k];
  return (
    <div className={clsx(!compact && 'space-y-4')}>
      <LinkPreview options={effective} identity={identity} sample={SOURCE_LABELS[source].sample} publicMin={publicMin} />
      <div className={clsx(compact ? 'mt-2' : '')}>
        {LINK_OPTION_KEYS.filter((k) => visible(k, effective)).map((k) => (
          <Row key={k} label={OPTION_LABELS[k]} locked={policy.locked[k] ? <LockTag /> : null}>
            <OptionControl k={k} value={effective[k]} disabled={policy.locked[k]} onChange={(v) => onChange({ ...value, [k]: v })} />
          </Row>
        ))}
      </div>
    </div>
  );
}

/** Admin editor: every option has a value and a lock that freezes it for profiles and users. */
export function AdminLinkEditor({ source, layer, onChange, inheritable }: {
  source: LinkSource;
  layer: PolicyLayer;
  onChange: (l: PolicyLayer) => void;
  /** Profile layers may leave an option unset ("hérite du réglage global"). */
  inheritable?: boolean;
}) {
  const effective = { ...DEFAULT_LINK_OPTIONS[source] } as LinkOptions;
  for (const k of LINK_OPTION_KEYS) if (layer[k]?.value !== undefined) (effective as any)[k] = layer[k]!.value;
  const identity = { username: 'jdupont', userCode: 'k7qp2', vanity: 'compta' };
  const setEntry = (k: LinkOptionKey, patch: { value?: unknown; locked?: boolean } | undefined) => {
    const next = { ...layer } as Record<string, unknown>;
    if (patch === undefined) delete next[k];
    else next[k] = { ...(layer[k] ?? {}), ...patch };
    onChange(next as PolicyLayer);
  };
  return (
    <div className="space-y-4">
      <LinkPreview options={effective} identity={identity} sample={SOURCE_LABELS[source].sample} />
      <div>
        {LINK_OPTION_KEYS.filter((k) => visible(k, effective)).map((k) => {
          const entry = layer[k];
          const inherited = inheritable && entry?.value === undefined;
          return (
            <Row key={k} label={OPTION_LABELS[k]}
              extra={
                <>
                  {inheritable && (
                    <button onClick={() => setEntry(k, inherited ? { value: effective[k] } : undefined)}
                      className={clsx('text-[11px] font-extrabold uppercase tracking-wider rounded-md px-2 h-7', inherited ? 'bg-surface-2 text-ink-3' : 'text-ink-3 hover:text-ink')}>
                      {inherited ? 'Hérité' : 'Réinitialiser'}
                    </button>
                  )}
                  <button
                    onClick={() => setEntry(k, { locked: !entry?.locked, ...(entry?.value === undefined ? { value: effective[k] } : {}) })}
                    title={entry?.locked ? 'Verrouillé : les utilisateurs ne peuvent pas modifier' : 'Libre : les utilisateurs peuvent personnaliser'}
                    className={clsx('flex size-8 items-center justify-center rounded-lg border-2 transition',
                      entry?.locked ? 'bg-ink text-bg border-ink' : 'border-line-soft text-ink-3 hover:text-ink')}>
                    {entry?.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
                  </button>
                </>
              }>
              <div className={clsx(inherited && 'opacity-50')}>
                <OptionControl k={k} value={effective[k]} onChange={(v) => setEntry(k, { value: v })} />
              </div>
            </Row>
          );
        })}
      </div>
    </div>
  );
}
