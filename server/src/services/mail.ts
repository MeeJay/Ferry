import nodemailer from 'nodemailer';
import type { MailEventKey, MailSettings } from '@ferry/shared';
import { getSetting } from './settings.js';
import { renderEvent, type RenderedMail } from './mailTemplates.js';
import { logger } from '../logger.js';

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

/** Delivers an already-rendered e-mail through the configured provider (SMTP or Microsoft Graph). */
export async function deliver(to: string, mail: RenderedMail, settings?: MailSettings): Promise<void> {
  const s = settings ?? (await getSetting('mail'));
  if (s.provider === 'none') return;

  if (s.provider === 'smtp') {
    const transport = nodemailer.createTransport({
      host: s.smtp.host,
      port: s.smtp.port,
      secure: s.smtp.secure,
      auth: s.smtp.user ? { user: s.smtp.user, pass: s.smtp.pass } : undefined,
    });
    await transport.sendMail({ from: s.from, to, subject: mail.subject, html: mail.html, text: mail.text });
    return;
  }

  const token = await graphToken(s.graph);
  const sender = s.graph.sender || s.from;
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: mail.subject,
        body: { contentType: 'HTML', content: mail.html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) throw new Error(`Graph sendMail HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export async function renderFor(event: MailEventKey, vars: Record<string, string>, baseUrl: string): Promise<RenderedMail> {
  const [branding, mail] = await Promise.all([getSetting('branding'), getSetting('mail')]);
  return renderEvent(event, vars, { branding, templates: mail.templates, baseUrl });
}

export async function sendEvent(event: MailEventKey, to: string, vars: Record<string, string>, baseUrl: string): Promise<void> {
  await deliver(to, await renderFor(event, vars, baseUrl));
}

/** Fire-and-forget variant for notifications: never fails the request. */
export function notifyEvent(event: MailEventKey, to: string | string[], vars: Record<string, string>, baseUrl: string) {
  for (const addr of Array.isArray(to) ? to : [to]) {
    sendEvent(event, addr, vars, baseUrl).catch((err) => logger.warn({ err: err.message, to: addr, event }, 'mail notification failed'));
  }
}
