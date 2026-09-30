/**
 * What goes inside a QR code for each content type of U01 (tools/utility.md).
 * The formats are the ones phone cameras understand: MECARD-style Wi-Fi,
 * vCard 3.0, mailto:, tel: and SMSTO:.
 */

export type WifiSecurity = 'WPA' | 'SAE' | 'WEP' | 'nopass';

export type QrContent =
  | { type: 'url'; url: string }
  | { type: 'text'; text: string }
  | { type: 'wifi'; ssid: string; password: string; security: WifiSecurity; hidden: boolean }
  | {
      type: 'vcard';
      firstName: string;
      lastName: string;
      org: string;
      title: string;
      phone: string;
      email: string;
      website: string;
    }
  | { type: 'email'; to: string; subject: string; body: string }
  | { type: 'phone'; number: string }
  | { type: 'sms'; number: string; message: string };

export type QrType = QrContent['type'];

export type PayloadResult = { ok: true; text: string } | { ok: false; error: string };

/** Wi-Fi fields escape \ ; , : and " with a backslash. */
function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

/** vCard 3.0 text values escape \ , ; and newlines (RFC 2426). */
function escapeVcard(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([,;])/g, '\\$1')
    .replace(/\r?\n/g, '\\n');
}

/** Digits, and a leading + if there is one: "+1 (555) 010-0199" → "+15550100199". */
export function phoneDigits(value: string): string {
  const trimmed = value.trim();
  return (trimmed.startsWith('+') ? '+' : '') + trimmed.replace(/\D/g, '');
}

/** Adds https:// to "example.com/page"; keeps any scheme that is already there. */
export function normaliseUrl(value: string): string {
  const url = value.trim();
  if (!url) return url;
  return /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`;
}

export function payload(content: QrContent): PayloadResult {
  switch (content.type) {
    case 'url': {
      const url = normaliseUrl(content.url);
      if (!url) return { ok: false, error: 'Type or paste a link.' };
      return { ok: true, text: url };
    }
    case 'text':
      return content.text
        ? { ok: true, text: content.text }
        : { ok: false, error: 'Type some text.' };
    case 'wifi': {
      if (!content.ssid) return { ok: false, error: 'Enter the network name (SSID).' };
      if (content.security !== 'nopass' && !content.password) {
        return { ok: false, error: 'Enter the Wi-Fi password, or pick No password.' };
      }
      const parts = [
        `T:${content.security}`,
        `S:${escapeWifi(content.ssid)}`,
        content.security === 'nopass' ? '' : `P:${escapeWifi(content.password)}`,
        content.hidden ? 'H:true' : '',
      ].filter(Boolean);
      return { ok: true, text: `WIFI:${parts.join(';')};;` };
    }
    case 'vcard': {
      const first = content.firstName.trim();
      const last = content.lastName.trim();
      if (!first && !last && !content.org.trim()) {
        return { ok: false, error: 'Enter a name or a company.' };
      }
      const full = [first, last].filter(Boolean).join(' ') || content.org.trim();
      const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${escapeVcard(last)};${escapeVcard(first)};;;`,
        `FN:${escapeVcard(full)}`,
        content.org.trim() && `ORG:${escapeVcard(content.org.trim())}`,
        content.title.trim() && `TITLE:${escapeVcard(content.title.trim())}`,
        content.phone.trim() && `TEL;TYPE=CELL:${phoneDigits(content.phone)}`,
        content.email.trim() && `EMAIL:${escapeVcard(content.email.trim())}`,
        content.website.trim() && `URL:${escapeVcard(normaliseUrl(content.website))}`,
        'END:VCARD',
      ].filter(Boolean);
      return { ok: true, text: lines.join('\r\n') };
    }
    case 'email': {
      const to = content.to.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
        return { ok: false, error: 'Enter an email address.' };
      const query = [
        content.subject && `subject=${encodeURIComponent(content.subject)}`,
        content.body && `body=${encodeURIComponent(content.body)}`,
      ].filter(Boolean);
      return { ok: true, text: `mailto:${to}${query.length ? `?${query.join('&')}` : ''}` };
    }
    case 'phone': {
      const number = phoneDigits(content.number);
      if (number.replace('+', '').length < 3) return { ok: false, error: 'Enter a phone number.' };
      return { ok: true, text: `tel:${number}` };
    }
    case 'sms': {
      const number = phoneDigits(content.number);
      if (number.replace('+', '').length < 3) return { ok: false, error: 'Enter a phone number.' };
      return { ok: true, text: `SMSTO:${number}:${content.message}` };
    }
  }
}
