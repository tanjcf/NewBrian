import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";

export type ComposerTextareaHandle = {
  getValue: () => string;
  setValue: (value: string) => void;
  focus: () => void;
  insertNewlineAtCursor: () => void;
};

type ComposerTextareaProps = {
  resetKey: string;
  initialValue: string;
  readOnly?: boolean;
  placeholder?: string;
  onEnter: () => void;
  onDraftChange?: (value: string) => void;
  onAltEnter?: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
};

export const ComposerTextarea = memo(forwardRef<ComposerTextareaHandle, ComposerTextareaProps>(
  function ComposerTextarea({
    resetKey,
    initialValue,
    readOnly = false,
    placeholder,
    onEnter,
    onDraftChange,
    onAltEnter,
    onContextMenu,
    onPaste
  }, ref) {
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const [draft, setDraft] = useState(initialValue);

    useEffect(() => {
      setDraft(initialValue);
    }, [resetKey, initialValue]);

    useImperativeHandle(ref, () => ({
      getValue: () => draft,
      setValue: (value: string) => {
        setDraft(value);
        if (inputRef.current) inputRef.current.value = value;
      },
      focus: () => {
        inputRef.current?.focus();
      },
      insertNewlineAtCursor: () => {
        const input = inputRef.current;
        if (!input) return;
        const start = input.selectionStart ?? draft.length;
        const end = input.selectionEnd ?? draft.length;
        const next = `${draft.slice(0, start)}\n${draft.slice(end)}`;
        setDraft(next);
        window.requestAnimationFrame(() => {
          input.selectionStart = start + 1;
          input.selectionEnd = start + 1;
        });
      }
    }), [draft]);

    return (
      <textarea
        ref={inputRef}
        data-testid="composer-input"
        value={draft}
        disabled={false}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          onDraftChange?.(next);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing || event.key !== "Enter") return;
          if (event.altKey) {
            event.preventDefault();
            onAltEnter?.();
            return;
          }
          if (event.shiftKey) return;
          event.preventDefault();
          onEnter();
        }}
        onContextMenu={onContextMenu}
        onPaste={onPaste}
      />
    );
  }
));
