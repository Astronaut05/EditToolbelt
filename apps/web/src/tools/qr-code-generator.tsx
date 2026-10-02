'use client';

import {
  payload,
  qrMatrix,
  qrPaths,
  qrSvg,
  scanWarning,
  type EcLevel,
  type QrContent,
  type QrType,
  type WifiSecurity,
} from '@etb/core/qr';
import {
  Button,
  CalculatorShell,
  ColorInput,
  MonoLabel,
  OptionFact,
  OptionRow,
  Switch,
  type ShellTool,
} from '@etb/ui';
import { Copy, Download, ImagePlus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';

import { ChoiceRow, Rows, SelectField, TextAreaField, TextField, useReady } from './calc-ui';

const TYPES: { value: QrType; label: string }[] = [
  { value: 'url', label: 'Link' },
  { value: 'text', label: 'Text' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'vcard', label: 'Contact card' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone call' },
  { value: 'sms', label: 'Text message' },
];

const SIZES = [512, 1024, 2048, 4096] as const;
/** Share of the code's width kept clear for a centre logo; level H recovers 30 %. */
const LOGO_SHARE = 0.22;

const EMPTY = {
  url: '',
  text: '',
  ssid: '',
  password: '',
  security: 'WPA' as WifiSecurity,
  hidden: false,
  firstName: '',
  lastName: '',
  org: '',
  title: '',
  phone: '',
  email: '',
  website: '',
  to: '',
  subject: '',
  body: '',
  number: '',
  message: '',
};
type Fields = typeof EMPTY;

function content(type: QrType, f: Fields): QrContent {
  switch (type) {
    case 'url':
      return { type, url: f.url };
    case 'text':
      return { type, text: f.text };
    case 'wifi':
      return { type, ssid: f.ssid, password: f.password, security: f.security, hidden: f.hidden };
    case 'vcard':
      return {
        type,
        firstName: f.firstName,
        lastName: f.lastName,
        org: f.org,
        title: f.title,
        phone: f.phone,
        email: f.email,
        website: f.website,
      };
    case 'email':
      return { type, to: f.to, subject: f.subject, body: f.body };
    case 'phone':
      return { type, number: f.number };
    case 'sms':
      return { type, number: f.number, message: f.message };
  }
}

/** Draws a user's logo into a square PNG, so the SVG never embeds their file as-is. */
async function rasteriseLogo(file: File): Promise<{ href: string; image: HTMLImageElement }> {
  const url = URL.createObjectURL(file);
  try {
    const source = new Image();
    source.src = url;
    await source.decode();
    const side = 256;
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    const scale = Math.min(side / source.naturalWidth, side / source.naturalHeight);
    const w = source.naturalWidth * scale;
    const h = source.naturalHeight * scale;
    ctx.drawImage(source, (side - w) / 2, (side - h) / 2, w, h);
    const href = canvas.toDataURL('image/png');
    const image = new Image();
    image.src = href;
    await image.decode();
    return { href, image };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Phones: true while the form is on screen and the preview isn't, so a bottom
 * bar can show the code and the download within thumb reach (docs/03 → Mobile)
 * without covering the preview or the footer.
 */
function useOffscreenPreview(
  form: RefObject<HTMLElement | null>,
  preview: RefObject<HTMLElement | null>,
) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const seen = new Map<Element, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // The preview counts as seen once half of it is on screen; the form, at all.
          const enough =
            entry.target === preview.current
              ? entry.intersectionRatio >= 0.5
              : entry.isIntersecting;
          seen.set(entry.target, enough);
        }
        setShow(
          Boolean(form.current && seen.get(form.current)) &&
            !(preview.current && seen.get(preview.current)),
        );
      },
      { threshold: [0, 0.5] },
    );
    if (form.current) observer.observe(form.current);
    if (preview.current) observer.observe(preview.current);
    return () => {
      observer.disconnect();
    };
  });
  return show;
}

/** U01 QR Code Generator (tools/utility.md): static codes, drawn by us, never tracked. */
export default function QrCodeGenerator({ tool }: { tool: ShellTool }) {
  const [type, setType] = useState<QrType>('url');
  const ready = useReady();
  const [fields, setFields] = useState<Fields>({ ...EMPTY, url: 'https://example.com' });
  const [chosenEc, setEc] = useState<EcLevel>('M');
  const [dots, setDots] = useState<'square' | 'rounded'>('square');
  const [eyes, setEyes] = useState<'square' | 'rounded'>('square');
  const [fg, setFg] = useState('#000000');
  const [bg, setBg] = useState('#ffffff');
  const [margin, setMargin] = useState('4');
  const [size, setSize] = useState('1024');
  const [logo, setLogo] = useState<{ href: string; image: HTMLImageElement; name: string } | null>(
    null,
  );
  const [status, setStatus] = useState('');
  const logoInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const bar = useOffscreenPreview(formRef, previewRef);
  const logoId = useId();

  const field =
    (key: keyof Fields) =>
    (value: string): void => {
      setFields((current) => ({ ...current, [key]: value }));
    };

  // A logo hides modules, so level H (30 % recovery) is used whenever there is one.
  const ec: EcLevel = logo ? 'H' : chosenEc;
  const built = payload(content(type, fields));
  const text = built.ok ? built.text : null;
  const matrix = useMemo(() => (text === null ? null : qrMatrix(text, ec)), [text, ec]);
  const style = {
    margin: Number(margin),
    dots,
    eyes,
    logo: logo ? LOGO_SHARE : 0,
  };
  const paths = matrix?.ok ? qrPaths(matrix.matrix, style) : null;
  const svg = paths ? qrSvg(paths, { px: Number(size), fg, bg, logoHref: logo?.href }) : null;
  const warning = scanWarning(fg, bg);
  const problem = !built.ok ? built.error : matrix && !matrix.ok ? matrix.error : null;
  const fileBase = `qr-${type}`;

  const png = async (): Promise<Blob> => {
    if (!paths) throw new Error('nothing to draw');
    const px = Number(size);
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, px, px);
    ctx.scale(px / paths.extent, px / paths.extent);
    ctx.fillStyle = fg;
    ctx.fill(new Path2D(paths.eyes), 'evenodd');
    ctx.fill(new Path2D(paths.dots));
    if (paths.logo && logo) {
      const { x, y, size: box } = paths.logo;
      ctx.drawImage(logo.image, x + 0.5, y + 0.5, box - 1, box - 1);
    }
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('PNG encoding failed'));
      }, 'image/png');
    });
  };

  const downloadPng = () => {
    png().then(
      (blob) => {
        save(blob, `${fileBase}.png`);
      },
      () => {
        setStatus('The PNG could not be made in this browser.');
      },
    );
  };

  const inputs = (
    <div ref={formRef}>
      <Rows>
        <SelectField
          id="qr-type"
          label="Content"
          value={type}
          onChange={(value) => {
            setType(value as QrType);
          }}
          options={TYPES}
        />
        {type === 'url' && (
          <TextField
            id="qr-url"
            label="Link"
            type="url"
            value={fields.url}
            onChange={field('url')}
            placeholder="example.com/menu"
            width="w-64"
            align="left"
          />
        )}
        {type === 'text' && (
          <TextAreaField
            id="qr-text"
            label="Text"
            value={fields.text}
            onChange={field('text')}
            rows={4}
          />
        )}
        {type === 'wifi' && (
          <>
            <TextField
              id="qr-ssid"
              label="Network name"
              value={fields.ssid}
              onChange={field('ssid')}
              placeholder="SSID"
              width="w-56"
              align="left"
            />
            <SelectField
              id="qr-security"
              label="Security"
              value={fields.security}
              onChange={field('security')}
              options={[
                { value: 'WPA', label: 'WPA or WPA2' },
                { value: 'SAE', label: 'WPA3' },
                { value: 'WEP', label: 'WEP' },
                { value: 'nopass', label: 'No password' },
              ]}
            />
            {fields.security !== 'nopass' && (
              <TextField
                id="qr-password"
                label="Password"
                value={fields.password}
                onChange={field('password')}
                width="w-56"
                align="left"
              />
            )}
            <OptionRow label="Hidden network">
              <Switch
                label="Hidden network"
                checked={fields.hidden}
                onChange={(hidden) => {
                  setFields((current) => ({ ...current, hidden }));
                }}
              />
            </OptionRow>
          </>
        )}
        {type === 'vcard' && (
          <>
            <TextField
              id="qr-first"
              label="First name"
              value={fields.firstName}
              onChange={field('firstName')}
              width="w-56"
              align="left"
            />
            <TextField
              id="qr-last"
              label="Last name"
              value={fields.lastName}
              onChange={field('lastName')}
              width="w-56"
              align="left"
            />
            <TextField
              id="qr-org"
              label="Company"
              value={fields.org}
              onChange={field('org')}
              width="w-56"
              align="left"
            />
            <TextField
              id="qr-title"
              label="Job title"
              value={fields.title}
              onChange={field('title')}
              width="w-56"
              align="left"
            />
            <TextField
              id="qr-phone"
              label="Phone"
              type="tel"
              value={fields.phone}
              onChange={field('phone')}
              width="w-56"
              align="left"
            />
            <TextField
              id="qr-email"
              label="Email"
              type="email"
              value={fields.email}
              onChange={field('email')}
              width="w-56"
              align="left"
            />
            <TextField
              id="qr-website"
              label="Website"
              type="url"
              value={fields.website}
              onChange={field('website')}
              width="w-56"
              align="left"
            />
          </>
        )}
        {type === 'email' && (
          <>
            <TextField
              id="qr-to"
              label="To"
              type="email"
              value={fields.to}
              onChange={field('to')}
              placeholder="name@example.com"
              width="w-64"
              align="left"
            />
            <TextField
              id="qr-subject"
              label="Subject"
              value={fields.subject}
              onChange={field('subject')}
              width="w-64"
              align="left"
            />
            <TextAreaField
              id="qr-body"
              label="Message"
              value={fields.body}
              onChange={field('body')}
            />
          </>
        )}
        {(type === 'phone' || type === 'sms') && (
          <TextField
            id="qr-number"
            label="Phone number"
            type="tel"
            value={fields.number}
            onChange={field('number')}
            placeholder="+1 555 010 0199"
            width="w-56"
            align="left"
          />
        )}
        {type === 'sms' && (
          <TextAreaField
            id="qr-message"
            label="Message"
            value={fields.message}
            onChange={field('message')}
          />
        )}
      </Rows>

      <MonoLabel as="h2" size="md" className="mt-8">
        Style
      </MonoLabel>
      <Rows>
        {logo ? (
          <OptionFact label="Error correction">H, for the logo</OptionFact>
        ) : (
          <ChoiceRow
            label="Error correction"
            value={ec}
            onChange={setEc}
            options={(['L', 'M', 'Q', 'H'] as const).map((level) => ({
              value: level,
              label: level,
            }))}
          />
        )}
        <ChoiceRow
          label="Dots"
          value={dots}
          onChange={setDots}
          options={[
            { value: 'square', label: 'Square' },
            { value: 'rounded', label: 'Round' },
          ]}
        />
        <ChoiceRow
          label="Corners"
          value={eyes}
          onChange={setEyes}
          options={[
            { value: 'square', label: 'Square' },
            { value: 'rounded', label: 'Rounded' },
          ]}
        />
        <OptionRow label="Dot color">
          <ColorInput label="Dot color" value={fg} onChange={setFg} />
        </OptionRow>
        <OptionRow label="Background">
          <ColorInput label="Background color" value={bg} onChange={setBg} />
        </OptionRow>
        <SelectField
          id="qr-margin"
          label="Quiet zone"
          value={margin}
          onChange={setMargin}
          options={[
            { value: '4', label: '4 modules' },
            { value: '2', label: '2 modules' },
            { value: '0', label: 'None' },
          ]}
        />
        <SelectField
          id="qr-size"
          label="PNG size"
          value={size}
          onChange={setSize}
          options={SIZES.map((px) => ({
            value: String(px),
            label: `${String(px)} × ${String(px)} px`,
          }))}
        />
        <OptionRow label="Logo">
          <span className="flex items-center gap-2">
            {logo && (
              <>
                <span className="max-w-32 truncate text-13.5 text-text-muted">{logo.name}</span>
                <Button
                  size="sm"
                  aria-label="Remove logo"
                  disabled={!ready}
                  onClick={() => {
                    setLogo(null);
                  }}
                  icon={<X aria-hidden="true" size={16} strokeWidth={1.75} />}
                >
                  Remove
                </Button>
              </>
            )}
            {!logo && (
              <Button
                size="sm"
                disabled={!ready}
                onClick={() => logoInput.current?.click()}
                icon={<ImagePlus aria-hidden="true" size={16} strokeWidth={1.75} />}
              >
                Add a logo
              </Button>
            )}
            <input
              id={logoId}
              ref={logoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="sr-only"
              tabIndex={-1}
              aria-label="Logo file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                rasteriseLogo(file).then(
                  (loaded) => {
                    setLogo({ ...loaded, name: file.name });
                  },
                  () => {
                    setStatus('That image could not be read. Try a PNG or JPG.');
                  },
                );
              }}
            />
          </span>
        </OptionRow>
      </Rows>
      {logo && (
        <p className="mt-3 text-13.5 text-text-muted">
          With a logo the code uses level H, which still reads with 30% of it covered.
        </p>
      )}
    </div>
  );

  const src = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
  const results = (
    <div className="max-w-140">
      {problem || !svg || !src || !matrix?.ok ? (
        <p
          className="flex min-h-14 items-center gap-2.5 border-y border-border text-14"
          role="alert"
        >
          <span aria-hidden="true" className="size-2 flex-none rounded-full bg-danger" />
          {problem ?? 'Nothing to encode yet.'}
        </p>
      ) : (
        <>
          <div id="qr-preview" ref={previewRef} className="scroll-mt-20">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL drawn here, nothing to optimise */}
            <img
              src={src}
              alt={`QR code: ${TYPES.find((option) => option.value === type)?.label ?? 'content'}`}
              width={360}
              height={360}
              className="aspect-square w-full max-w-90 border border-border"
            />
          </div>
          <p className="mt-3 font-mono text-12 uppercase tracking-meta text-text-muted">
            Version {matrix.matrix.version} · {matrix.matrix.size} × {matrix.matrix.size} modules ·
            Level {ec}
          </p>
          {warning && (
            <p className="mt-3 flex items-center gap-2.5 text-14">
              <span aria-hidden="true" className="size-2 flex-none rounded-full bg-warning" />
              {warning}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              variant="primary"
              icon={<Download aria-hidden="true" size={18} strokeWidth={2} />}
              disabled={!ready}
              onClick={downloadPng}
            >
              Download PNG
            </Button>
            <Button
              disabled={!ready}
              onClick={() => {
                save(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase}.svg`);
              }}
            >
              Download SVG
            </Button>
            <Button
              icon={<Copy aria-hidden="true" size={16} strokeWidth={1.75} />}
              disabled={!ready}
              onClick={() => {
                png()
                  .then((blob) =>
                    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]),
                  )
                  .then(
                    () => {
                      setStatus('Copied the PNG to the clipboard.');
                    },
                    () => {
                      setStatus('This browser can’t copy images. Download the PNG instead.');
                    },
                  );
              }}
            >
              Copy image
            </Button>
          </div>
          <p role="status" className="mt-3 min-h-5 text-13.5 text-text-muted">
            {status}
          </p>
          <p className="mt-4 flex items-center gap-2.5 text-14">
            <span aria-hidden="true" className="size-2 flex-none rounded-full bg-accent" />
            Your QR code never expires and doesn’t track scans: it holds the text itself, not a link
            to us.
          </p>
          <MonoLabel as="h2" size="md" className="mt-8">
            Encoded text
          </MonoLabel>
          <pre className="mt-3 max-h-40 overflow-auto rounded-control border border-border bg-bg p-3 font-mono text-12.5 whitespace-pre-wrap break-all">
            {text}
          </pre>
          {bar && (
            <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-bg px-4 py-3 lg:hidden">
              <a href="#qr-preview" className="flex min-h-11 items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL drawn here */}
                <img
                  src={src}
                  alt=""
                  width={44}
                  height={44}
                  className="size-11 border border-border"
                />
                <span className="text-14 underline underline-offset-2">Preview</span>
              </a>
              <Button
                variant="primary"
                size="md"
                className="ml-auto"
                icon={<Download aria-hidden="true" size={18} strokeWidth={2} />}
                disabled={!ready}
                onClick={downloadPng}
              >
                Download PNG
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );

  return <CalculatorShell tool={tool} inputs={inputs} results={results} />;
}
