'use client';

// Client interactivity: native modal focus/keyboard semantics and async reason
// submission. Server actions still enforce role, money, idempotency and audit.
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

import type { FormEvent, ReactNode } from 'react';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  consequence: string;
  financialImpact: ReactNode;
  requireReason?: boolean;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (input: { reason: string }) => Promise<void>;
};
export function ConfirmDialog(props: ConfirmDialogProps) {
  return props.open ? <OpenDialog {...props} /> : null;
}
function OpenDialog({
  title,
  consequence,
  financialImpact,
  requireReason = true,
  confirmLabel = 'Confirm',
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null),
    pendingRef = useRef(false);
  const id = useId();
  const [reason, setReason] = useState(''),
    [pending, setPending] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (pendingRef.current || (requireReason && !trimmed)) return;
    pendingRef.current = true;
    setPending(true);
    setFailed(false);
    try {
      await onConfirm({ reason: trimmed });
    } catch {
      setFailed(true);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-consequence`}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border bg-white p-6 shadow-xl backdrop:bg-black/40"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        // Wrap explicitly at the modal boundary; native inertness alone can
        // allow the browser chrome to receive focus after the final control.
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button, textarea, input:not([type="hidden"]), select, a[href], [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (element) =>
            !element.hasAttribute('disabled') &&
            element.tabIndex >= 0 &&
            element.getClientRects().length > 0,
        );
        const first = controls[0],
          last = controls.at(-1);
        if (!first || !last) return event.preventDefault();
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!pendingRef.current) onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          submit(event).catch(() => setFailed(true));
        }}
        aria-busy={pending}
      >
        <h2 id={`${id}-title`} className="text-xl font-semibold">
          {title}
        </h2>
        <p
          id={`${id}-consequence`}
          className="mt-3 text-sm text-muted-foreground"
        >
          {consequence}
        </p>
        <div className="mt-4 rounded-lg bg-muted p-4 text-sm">
          {financialImpact}
        </div>
        <label
          className="mt-5 block text-sm font-semibold"
          htmlFor={`${id}-reason`}
        >
          Reason{requireReason ? ' (required)' : ' (optional)'}
        </label>
        <textarea
          id={`${id}-reason`}
          className="mt-2 min-h-24 w-full rounded-md border p-3 text-sm focus-visible:outline-ring"
          value={reason}
          disabled={pending}
          required={requireReason}
          onChange={(event) => setReason(event.target.value)}
        />
        {failed && (
          <p role="alert" className="mt-3 text-sm">
            Could not confirm. Please try again.
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={pending || (requireReason && !reason.trim())}
          >
            {pending ? 'Confirming…' : confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
