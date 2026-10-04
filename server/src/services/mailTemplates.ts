import type { BrandingSettings, MailEventKey, MailEventTemplate, MailTemplateSettings, MailTheme } from '@ferry/shared';

// E-mail rendering. Everything here targets the lowest common denominator of
// mail clients (Outlook desktop included): table layout, inline styles, no
// web fonts, bgcolor fallbacks behind every gradient, "bulletproof" buttons,
// a hidden preheader and a plain-text alternative.

export const DEFAULT_MAIL_TEMPLATES: MailTemplateSettings = {
  theme: 'signal',
  showLogo: true,
  footer: '',
  events: {
    share_invite: {
      subject: '{{sender}} vous a envoyé « {{title}} »',
      heading: '{{sender}} vous a envoyé des fichiers',
      body: '{{files}} · {{size}}\n{{message}}\nDisponible jusqu’au {{expires}}.',
      button: 'Télécharger',
    },
    request_invite: {
      subject: '{{sender}} vous demande des fichiers',
      heading: 'Déposez vos fichiers pour {{sender}}',
      body: '« {{title}} »\n{{message}}\nAucun compte n’est nécessaire : ouvrez le lien et glissez vos fichiers.',
      button: 'Déposer mes fichiers',
    },
    request_received: {
      subject: 'Nouveau dépôt : {{title}}',
      heading: 'Vous avez reçu des fichiers',
      body: '{{uploader}} a déposé {{files}} ({{size}}) via votre demande « {{title}} ».\n{{message}}',
      button: 'Voir les fichiers',
    },
    share_downloaded: {
      subject: 'Téléchargé : {{title}}',
      heading: 'Votre partage a été téléchargé',
      body: '« {{title}} » vient d’être téléchargé pour la première fois.',
      button: 'Voir le partage',
    },
  },
};

/** Documentation shown in the admin editor. */
export const MAIL_VARIABLES: Record<MailEventKey, string[]> = {
  share_invite: ['sender', 'title', 'message', 'files', 'size', 'expires', 'link', 'instance'],
  request_invite: ['sender', 'title', 'message', 'expires', 'link', 'instance'],
  request_received: ['uploader', 'title', 'message', 'files', 'size', 'link', 'instance'],
  share_downloaded: ['title', 'link', 'instance'],
};

/** Sample values for the admin preview. */
export const SAMPLE_VARS: Record<string, string> = {
  sender: 'Marie Lefèvre',
  uploader: 'Bob Durand',
  title: 'Photos séminaire Annecy',
  message: 'Merci à tous pour ces deux jours ! Voici les photos.',
  files: '6 fichiers',
  size: '184 Mo',
  expires: '12 octobre 2026',
  link: 'https://share.example.com/mlefevre/photos-seminaire-x7k2',
};

export interface RenderedMail { subject: string; html: string; text: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** {{var}} substitution; lines that end up empty (missing optional vars) are dropped. */
function fill(tpl: string, vars: Record<string, string>): string {
  return tpl
    .split('\n')
    .map((line) => {
      let missing = false;
      const out = line.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
        const v = vars[k];
        if (v === undefined || v === '') { missing = true; return ''; }
        return v;
      });
      return missing && !out.replace(/[\s«»“”"'·.,:;()–—-]/g, '') ? null : out;
    })
    .filter((l): l is string => l !== null)
    .join('\n')
    .trim();
}

// ── Colour helpers (mirror of the client's accent → companion hue) ──────────

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) ?? ['', '7c', '5c', 'ff'];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}
function companion(hex: string): string {
  let [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  const h2 = (h + 338) % 360, l2 = Math.min(0.6, Math.max(0.48, l)), s2 = Math.min(1, s * 1.05);
  const k = (n: number) => (n + h2 / 30) % 12;
  const a = s2 * Math.min(l2, 1 - l2);
  const f = (n: number) => Math.round((l2 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255);
  [r, g, b] = [f(0), f(8), f(4)];
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// ── Themes ─────────────────────────────────────────────────────────────────

interface Palette {
  outer: string; card: string; text: string; muted: string; heading: string;
  headerBg: string; headerImage: string | null; headerText: string; headerHeight: number;
  topBar: string | null; button: string; buttonImage: string | null; buttonText: string;
  radius: number; buttonRadius: number; quoteBg: string; divider: string;
}

function palette(theme: MailTheme, accent: string): Palette {
  const a2 = companion(accent);
  switch (theme) {
    case 'minimal':
      return {
        outer: '#f4f3f8', card: '#ffffff', text: '#3d3a4f', muted: '#8a879b', heading: '#16142a',
        headerBg: '#f4f3f8', headerImage: null, headerText: accent, headerHeight: 0, topBar: null,
        button: accent, buttonImage: null, buttonText: '#ffffff', radius: 14, buttonRadius: 10, quoteBg: '#f4f3f8', divider: '#ecebf2',
      };
    case 'corporate':
      return {
        outer: '#eef0f4', card: '#ffffff', text: '#3b4252', muted: '#7b8494', heading: '#1f2533',
        headerBg: '#ffffff', headerImage: null, headerText: '#1f2533', headerHeight: 76, topBar: accent,
        button: accent, buttonImage: null, buttonText: '#ffffff', radius: 4, buttonRadius: 4, quoteBg: '#f5f6f8', divider: '#e6e9ee',
      };
    case 'sunset':
      return {
        outer: '#fff6f1', card: '#ffffff', text: '#4a3b3f', muted: '#9a8a8e', heading: '#2a1a1f',
        headerBg: '#f43f5e', headerImage: `linear-gradient(135deg,#fb923c 0%,#f43f5e 55%,${a2} 100%)`, headerText: '#ffffff', headerHeight: 150, topBar: null,
        button: '#f43f5e', buttonImage: 'linear-gradient(135deg,#fb923c,#f43f5e)', buttonText: '#ffffff', radius: 18, buttonRadius: 12, quoteBg: '#fff3ee', divider: '#f5e6e1',
      };
    default: // signal — Ferry's signature, dark navy
      return {
        outer: '#04070f', card: '#0b101f', text: '#c4cfe6', muted: '#7d8db0', heading: '#ffffff',
        headerBg: accent, headerImage: `linear-gradient(135deg,${accent} 0%,${a2} 100%)`, headerText: '#ffffff', headerHeight: 150, topBar: null,
        button: accent, buttonImage: `linear-gradient(135deg,${accent},${a2})`, buttonText: '#ffffff', radius: 18, buttonRadius: 12, quoteBg: '#111830', divider: '#1e2a4a',
      };
  }
}

export interface LayoutInput {
  theme: MailTheme;
  branding: BrandingSettings;
  baseUrl: string;
  showLogo: boolean;
  footer: string;
  preheader: string;
  heading: string;
  /** Plain text: escaped here, line breaks kept. */
  body: string;
  quote?: string | null;
  button?: { label: string; url: string } | null;
}

function logoUrl(input: LayoutInput, onColor: boolean): string | null {
  if (!input.showLogo) return null;
  const b = input.branding;
  const logo = onColor ? b.logoDark || b.logoLight : b.logoLight || b.logoDark;
  // Most mail clients (Gmail, Outlook) do not render SVG.
  if (!logo || /\.svg$/i.test(logo)) return null;
  return logo.startsWith('http') ? logo : `${input.baseUrl}${logo}`;
}

export function renderLayout(input: LayoutInput): string {
  const p = palette(input.theme, /^#[0-9a-f]{6}$/i.test(input.branding.accent) ? input.branding.accent : '#7C5CFF');
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const name = esc(input.branding.name);
  const hasBand = p.headerHeight > 0 && input.theme !== 'corporate';
  const logo = logoUrl(input, hasBand || input.theme === 'signal');
  const brandMark = logo
    ? `<img src="${esc(logo)}" alt="${name}" height="32" style="display:block;height:32px;width:auto;border:0;outline:none">`
    : `<span style="font-family:${font};font-size:18px;font-weight:700;letter-spacing:-.3px;color:${hasBand ? p.headerText : p.headerText}">${name}</span>`;

  const bodyHtml = esc(input.body).replace(/\n/g, '<br>');
  const quote = input.quote
    ? `<tr><td style="padding:0 40px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="4" bgcolor="${p.button}" style="background:${p.button};border-radius:4px"></td>
        <td bgcolor="${p.quoteBg}" style="background:${p.quoteBg};padding:14px 18px;border-radius:0 10px 10px 0;font-family:${font};font-size:14px;line-height:22px;color:${p.text};font-style:italic">${esc(input.quote).replace(/\n/g, '<br>')}</td>
      </tr></table></td></tr>`
    : '';
  const button = input.button
    ? `<tr><td style="padding:4px 40px 12px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${p.button}" style="background:${p.button};${p.buttonImage ? `background-image:${p.buttonImage};` : ''}border-radius:${p.buttonRadius}px">
          <a href="${esc(input.button.url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${font};font-size:15px;font-weight:700;color:${p.buttonText};text-decoration:none;border-radius:${p.buttonRadius}px">${esc(input.button.label)} &rarr;</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:8px 40px 32px;font-family:${font};font-size:12px;line-height:18px;color:${p.muted}">
        Le bouton ne fonctionne pas ? Copiez ce lien :<br><a href="${esc(input.button.url)}" style="color:${p.muted};word-break:break-all">${esc(input.button.url)}</a>
      </td></tr>`
    : '<tr><td style="padding:0 0 24px"></td></tr>';

  let header = '';
  if (input.theme === 'corporate') {
    header = `<tr><td height="6" bgcolor="${p.topBar}" style="background:${p.topBar};font-size:0;line-height:0;border-radius:${p.radius}px ${p.radius}px 0 0">&nbsp;</td></tr>
      <tr><td bgcolor="${p.headerBg}" style="background:${p.headerBg};padding:22px 40px;border-bottom:1px solid ${p.divider}">${brandMark}</td></tr>`;
  } else if (hasBand) {
    header = `<tr><td bgcolor="${p.headerBg}" height="${p.headerHeight}" valign="bottom" style="background:${p.headerBg};${p.headerImage ? `background-image:${p.headerImage};` : ''}border-radius:${p.radius}px ${p.radius}px 0 0;padding:0 40px 26px;height:${p.headerHeight}px">${brandMark}</td></tr>`;
  } else {
    header = `<tr><td style="padding:0 4px 18px">${brandMark}</td></tr>`;
  }
  const cardTopRadius = input.theme === 'minimal' ? `${p.radius}px ${p.radius}px` : '0 0';
  const footer = [input.footer, `Envoyé via ${input.branding.name}`].filter(Boolean).map(esc).join(' &middot; ');

  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="${input.theme === 'signal' ? 'dark' : 'light'}">
<meta name="supported-color-schemes" content="${input.theme === 'signal' ? 'dark' : 'light'}">
<title>${esc(input.heading)}</title>
<!--[if mso]><style>table,td{font-family:Arial,sans-serif!important}</style><![endif]-->
<style>
  @media (max-width:620px){ .container{width:100%!important} .px{padding-left:24px!important;padding-right:24px!important} }
  a{color:${p.button}}
</style>
</head>
<body style="margin:0;padding:0;background:${p.outer};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${esc(input.preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${p.outer}" style="background:${p.outer}">
<tr><td align="center" style="padding:32px 12px">
  <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px">
    ${header}
    <tr><td bgcolor="${p.card}" style="background:${p.card};border-radius:${cardTopRadius} ${p.radius}px ${p.radius}px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td class="px" style="padding:36px 40px 12px;font-family:${font};font-size:26px;line-height:32px;font-weight:700;letter-spacing:-.4px;color:${p.heading}">${esc(input.heading)}</td></tr>
        <tr><td class="px" style="padding:4px 40px 24px;font-family:${font};font-size:15px;line-height:24px;color:${p.text}">${bodyHtml}</td></tr>
        ${quote}
        ${button}
      </table>
    </td></tr>
    <tr><td align="center" style="padding:22px 24px;font-family:${font};font-size:12px;line-height:18px;color:${p.muted}">${footer}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/** Renders one event e-mail. `vars.message` is shown as a quote, not inline. */
export function renderEvent(
  event: MailEventKey,
  vars: Record<string, string>,
  ctx: { branding: BrandingSettings; templates: MailTemplateSettings; baseUrl: string; overrides?: Partial<MailEventTemplate>; theme?: MailTheme },
): RenderedMail {
  const tpl = { ...DEFAULT_MAIL_TEMPLATES.events[event], ...ctx.templates.events?.[event], ...ctx.overrides };
  const all: Record<string, string> = { instance: ctx.branding.name, ...vars };
  const { message, ...rest } = all;
  const bodyUsesMessage = /\{\{\s*message\s*\}\}/.test(tpl.body);
  const subject = fill(tpl.subject, all).replace(/\s+/g, ' ');
  const heading = fill(tpl.heading, all);
  const body = fill(tpl.body, bodyUsesMessage ? rest : all);
  const link = vars.link;
  const html = renderLayout({
    theme: ctx.theme ?? ctx.templates.theme,
    branding: ctx.branding,
    baseUrl: ctx.baseUrl,
    showLogo: ctx.templates.showLogo,
    footer: ctx.templates.footer,
    preheader: body.split('\n')[0] ?? heading,
    heading,
    body,
    quote: bodyUsesMessage && message ? message : null,
    button: link && tpl.button ? { label: fill(tpl.button, all), url: link } : null,
  });
  const text = [heading, '', body, message && bodyUsesMessage ? `\n« ${message} »` : '', link ? `\n${fill(tpl.button, all) || 'Lien'} : ${link}` : '', `\n— ${ctx.branding.name}`]
    .filter((l) => l !== '')
    .join('\n');
  return { subject, html, text };
}
