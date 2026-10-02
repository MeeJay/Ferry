export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(i === 0 ? 0 : decimals).replace(/\.0$/, '')} ${units[i]}`;
}

export const MB = 1024 * 1024;
