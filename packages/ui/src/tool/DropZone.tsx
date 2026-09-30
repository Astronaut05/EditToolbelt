'use client';

import { Camera, ImageIcon, Plus, Upload } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type ReactNode,
} from 'react';

import { cn } from '../cn';
import { Button } from '../primitives/Button';
import { Kbd } from '../primitives/Kbd';
import { MonoLabel } from '../primitives/MonoLabel';
import { formatBytes, matchesAccept } from './format';

export interface DropZoneProps {
  accept: string;
  multiple?: boolean;
  maxBytes: number;
  /** "image", "video" … */
  noun: string;
  /** Desktop heading: "Drop an image here". */
  title: string;
  /** Primary button: "Choose image". */
  chooseLabel: string;
  /** Phone tap area: "Choose\nan image" (a newline sets the line break). */
  tapLabel: string;
  /** Mono formats line: "JPG · PNG · WEBP · AVIF · HEIC · UP TO 24 MP, 200 MB". */
  formats: string;
  formatsShort?: string;
  onFiles: (files: File[]) => void;
  onReject: (message: string) => void;
  onSample?: () => void;
  /** Phone: offer the camera (images and video). */
  camera?: boolean;
  /** Keyboard and paste shortcuts are live (only while the drop zone is shown). */
  active?: boolean;
}

const noSubscribe = () => () => undefined;

function modifierKey(): string {
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';
}

function check(
  files: File[],
  { accept, maxBytes, noun }: Pick<DropZoneProps, 'accept' | 'maxBytes' | 'noun'>,
) {
  for (const file of files) {
    if (!matchesAccept(file, accept)) {
      return `This file isn't ${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun} we can read. Try one of the formats listed.`;
    }
    if (file.size > maxBytes) {
      return `This is a ${formatBytes(file.size)} file; the browser limit for this tool is ${formatBytes(maxBytes)}.`;
    }
  }
  return null;
}

/**
 * Where a file comes in: drag and drop, the file picker (also Ctrl/Cmd+O),
 * paste, and on phones the camera (docs/02 → shared behaviours). Renders the
 * desktop panel from 1024 px and the big tap area below it.
 */
export function DropZone(props: DropZoneProps) {
  const { accept, multiple = false, active = true, onFiles, onReject } = props;
  const input = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  // Marks the input once React owns it: a file set on the server-rendered
  // input before hydration would be lost, so tests (and scripts) wait for this.
  const markHydrated = useCallback((element: HTMLInputElement | null) => {
    input.current = element;
    element?.setAttribute('data-hydrated', '');
  }, []);
  const mod = useSyncExternalStore(noSubscribe, modifierKey, () => 'Ctrl');

  function take(list: FileList | File[] | null | undefined) {
    const files = Array.from(list ?? []).slice(0, multiple ? undefined : 1);
    if (files.length === 0) return;
    const problem = check(files, props);
    if (problem) onReject(problem);
    else onFiles(files);
  }

  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    const files = event.clipboardData?.files;
    if (files && files.length > 0) {
      event.preventDefault();
      take(files);
    }
  });

  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        input.current?.click();
      }
    }
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  }, [active]);

  const dragProps = {
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      setOver(true);
    },
    onDragLeave: () => {
      setOver(false);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setOver(false);
      take(event.dataTransfer.files);
    },
  };

  const hidden = (
    <>
      <input
        ref={markHydrated}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          take(event.target.files);
          event.target.value = '';
        }}
      />
      {props.camera && (
        <input
          ref={cameraInput}
          type="file"
          accept={
            accept
              .split(',')
              .filter((part) => part.includes('/'))
              .join(',') || accept
          }
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            take(event.target.files);
            event.target.value = '';
          }}
        />
      )}
    </>
  );

  return (
    <>
      {hidden}
      {/* Desktop: the preview area is the drop target. */}
      <div
        {...dragProps}
        className={cn(
          'absolute inset-0 hidden flex-col justify-center bg-surface px-18 lg:flex',
          'before:pointer-events-none before:absolute before:inset-6 before:border before:border-dashed before:transition-colors before:duration-(--dur-fast)',
          over ? 'before:border-text' : 'before:border-border',
        )}
      >
        <MonoLabel size="md">Step 1</MonoLabel>
        <h2 className="mt-4 text-46 leading-display font-display tracking-display">
          {props.title}
        </h2>
        <p className="mt-3.5 flex items-center gap-1.5 text-16.5 text-text-muted">
          or choose a file, or paste with <Kbd>{mod}</Kbd>
          <Kbd>V</Kbd>
        </p>
        <div className="relative mt-7 flex gap-3">
          <Button
            variant="primary"
            icon={<Upload aria-hidden="true" size={18} strokeWidth={2} />}
            onClick={() => input.current?.click()}
          >
            {props.chooseLabel}
          </Button>
          {props.onSample && <Button onClick={props.onSample}>Try a sample</Button>}
        </div>
        <p className="mt-5.5 font-mono text-12 uppercase tracking-meta text-text-muted">
          {props.formats}
        </p>
      </div>

      {/* Phone and tablet: one big tap area, camera and sample under it. */}
      <div {...dragProps} className="px-4 pt-5.5 lg:hidden">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex h-52.5 w-full flex-col justify-between rounded-control bg-accent p-4.5 text-left text-accent-contrast active:opacity-90"
        >
          <span className="flex w-full items-end justify-between">
            <span className="font-mono text-11.5 font-medium uppercase tracking-[0.08em]">
              Step 1
            </span>
            <Plus aria-hidden="true" size={26} strokeWidth={1.5} />
          </span>
          <span className="text-26 leading-none font-display tracking-title whitespace-pre-line">
            {props.tapLabel}
          </span>
        </button>
        <div className="flex border border-t-0 border-border">
          {props.camera && (
            <PhoneCell
              onClick={() => cameraInput.current?.click()}
              icon={<Camera aria-hidden="true" size={17} strokeWidth={1.75} />}
            >
              Camera
            </PhoneCell>
          )}
          {props.onSample && (
            <PhoneCell
              onClick={props.onSample}
              icon={<ImageIcon aria-hidden="true" size={17} strokeWidth={1.75} />}
            >
              Try a sample
            </PhoneCell>
          )}
        </div>
        <p className="pt-3.5 font-mono text-11.5 uppercase tracking-[0.04em] text-text-muted">
          {props.formatsShort ?? props.formats}
        </p>
      </div>
    </>
  );
}

function PhoneCell({
  children,
  icon,
  onClick,
}: {
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 flex-1 items-center justify-center gap-2 border-r border-border text-14 last:border-r-0 hover:bg-surface"
    >
      {icon}
      {children}
    </button>
  );
}
