import nodemailer from 'nodemailer';
import type { MailSettings } from '@ferry/shared';
import { getSetting } from './settings.js';
import { logger } from '../logger.js';

export interface MailMessage { to: string; subject: string; title: string; body: string; cta?: { label: string; url: string } }

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

async function render(m: MailMessage): Promise<string> {
  const b = await getSetting('branding');
  const accent = /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : '#FF5A1F';
  return `<!doctype html><html><body style="margin:0;background:#f4f4f0;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0a0a0a">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:2px solid #0a0a0a;border-radius:16px">
<tr><td style="padding:32px 32px 8px;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${accent}">${escapeHtml(b.name)}</td></tr>
<tr><td style="padding:0 32px 8px;font-size:28px;font-weight:800;line-height:1.15">${escapeHtml(m.title)}</td></tr>
<tr><td style="padding:8px 32px 24px;font-size:15px;line-height:1.6;color:#3a3a3a">${m.body}</td></tr>
${m.cta ? `<tr><td style="padding:0 32px 32px"><a href="${escapeHtml(m.cta.url)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:10px">${escapeHtml(m.cta.label)}</a></td></tr>` : ''}
</table></td></tr></table></body></html>`;
}

async function graphToken(g: MailSettings['graph']): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(g.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: g.clientId,
      client_secret: g.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(json.error_description || `Graph token HTTP ${res.status}`);
  return json.access_token;
}

export async function sendMail(m: MailMessage, settings?: MailSettings): Promise<void> {
  const s = settings ?? (await getSetting('mail'));
  if (s.provider === 'none') return;
  const html = await render(m);

  if (s.provider === 'smtp') {
    const transport = nodemailer.createTransport({
      host: s.smtp.host,
      port: s.smtp.port,
      secure: s.smtp.secure,
      auth: s.smtp.user ? { user: s.smtp.user, pass: s.smtp.pass } : undefined,
    });
    await transport.sendMail({ from: s.from, to: m.to, subject: m.subject, html });
    return;
  }

  const token = await graphToken(s.graph);
  const sender = s.graph.sender || s.from;
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: m.subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: m.to } }],
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) throw new Error(`Graph sendMail HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Fire-and-forget variant for notifications: never fails the request. */
export function notify(m: MailMessage) {
  sendMail(m).catch((err) => logger.warn({ err: err.message, to: m.to }, 'mail notification failed'));
}

export { escapeHtml };
