'use client';

import { useActionState } from 'react';

import { Button, CopyButton, Input } from '@etb/ui';

import type { NewKeyState } from '../../app/account/actions';

interface Props {
  action: (state: NewKeyState, formData: FormData) => Promise<NewKeyState>;
  scopes: { id: string; label: string }[];
}

/** Makes an API key and shows it once, with a copy button. */
export function NewKeyForm({ action, scopes }: Props) {
  const [state, submit, pending] = useActionState(action, {});
  return (
    <>
      {state.key && (
        <div
          role="status"
          className="flex max-w-xl flex-col gap-3 rounded-card border border-border bg-surface p-4"
        >
          <p className="font-strong">Your new key “{state.name}”</p>
          <p className="text-14 text-text-muted">
            Copy it now. We keep only a fingerprint of it, so it can’t be shown again.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all font-mono text-14" data-testid="new-api-key">
              {state.key}
            </code>
            <CopyButton text={state.key} label="Copy the key">
              Copy
            </CopyButton>
          </div>
        </div>
      )}
      <form action={submit} className="flex max-w-md flex-col gap-3">
        {state.error && <p role="alert">{state.error}</p>}
        <label htmlFor="key-name" className="text-14 font-strong">
          Key name
        </label>
        <Input
          id="key-name"
          name="name"
          maxLength={60}
          required
          autoComplete="off"
          placeholder="Render script on the studio PC"
        />
        <fieldset className="flex flex-col">
          <legend className="text-14 font-strong">It can</legend>
          {scopes.map((scope) => (
            <label key={scope.id} className="flex min-h-11 items-center gap-3 text-16">
              <input
                type="checkbox"
                name="scopes"
                value={scope.id}
                defaultChecked
                className="size-4.5 accent-(--accent)"
              />
              {scope.label}
              <span className="font-mono text-14 text-text-muted">{scope.id}</span>
            </label>
          ))}
        </fieldset>
        <Button type="submit" variant="primary" className="self-start" disabled={pending}>
          {pending ? 'Making the key…' : 'Make a key'}
        </Button>
      </form>
    </>
  );
}
