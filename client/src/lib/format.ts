export { formatBytes } from '@ferry/shared';

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

export function relative(date: string | Date | null): string {
  if (!date) return 'jamais';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return rtf.format(Math.round(diff / (86400 * 30)), 'month');
}

export function dateTime(date: string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function absolute(path: string): string {
  return `${window.location.origin}${path}`;
}

export const EXPIRY_PRESETS: { label: string; hours: number }[] = [
  { label: '1 h', hours: 1 },
  { label: '1 jour', hours: 24 },
  { label: '7 jours', hours: 168 },
  { label: '30 jours', hours: 720 },
  { label: '90 jours', hours: 2160 },
  { label: 'Jamais', hours: 0 },
];

export function expiryLabel(hours: number): string {
  if (hours === 0) return 'Jamais';
  if (hours % 24 === 0) return `${hours / 24} j`;
  return `${hours} h`;
}
