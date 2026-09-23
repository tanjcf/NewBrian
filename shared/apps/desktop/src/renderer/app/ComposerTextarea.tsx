import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  COMPOSER_DRAFT_HISTORY_IDLE_MS,
  commitComposerDraftHistory,
  composerDraftHistoryCaps,
  createComposerDraftHistory,
  redoComposerDraftHistory,
  resetComposerDraftHistory,
  shouldForceComposerDraftCheckpoint,
  undoComposerDraftHistory,
  type ComposerDraftHistoryCaps,
  type ComposerDraftHistoryState
} from "./composer-draft-history.ts";
import { insertNewlineIntoDraft } from "./composer-newline.ts";
import { detectComposerMentionQuery } from "./conversation-refs.ts";

export type ComposerTextareaHandle = {
  getValue: () => string;
  setValue: (value: string, cursor?: number) => void;
  focus: () => void;
  insertNewlineAtCursor: () => void;
  /** Insert plain text at the current caret (or replace the active selection). */
  insertTextAtCursor: (text: string) => { next: string; cursor: number };
  getSelectionStart: () => number;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
};

type ComposerTextareaProps = {
  resetKey: string;
  initialValue: string;
  readOnly?: boolean;
  placeholder?: string;
  onEnter: () => void;
  onDraftChange?: (value: string) => void;
  onHistoryChange?: (caps: ComposerDraftHistoryCaps) => void;
  onAltEnter?: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onMentionQueryChange?: (query: { start: number; query: string; cursor: number } | null) => void;
  onMentionNavigate?: (direction: "up" | "down" | "enter" | "escape") => boolean;
};

export const ComposerTextarea = memo(forwardRef<ComposerTextareaHandle, ComposerTextareaProps>(
  function ComposerTextarea({
    resetKey,
    initialValue,
    readOnly = false,
    placeholder,
    onEnter,
    onDraftChange,
    onHistoryChange,
    onAltEnter,
    onContextMenu,
    onPaste,
    onMentionQueryChange,
    onMentionNavigate
  }, ref) {
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const [draft, setDraft] = useState(initialValue);
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const historyRef = useRef<ComposerDraftHistoryState>(createComposerDraftHistory(initialValue));
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const onDraftChangeRef = useRef(onDraftChange);
    const onHistoryChangeRef = useRef(onHistoryChange);
    const onMentionQueryChangeRef = useRef(onMentionQueryChange);
    onDraftChangeRef.current = onDraftChange;
    onHistoryChangeRef.current = onHistoryChange;
    onMentionQueryChangeRef.current = onMentionQueryChange;

    const emitHistoryCaps = () => {
      onHistoryChangeRef.current?.(composerDraftHistoryCaps(historyRef.current));
    };

    const clearIdleCommit = () => {
      if (idleTimerRef.current != null) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };

    const readCursor = () => {
      const input = inputRef.current;
      return input?.selectionStart ?? draftRef.current.length;
    };

    const emitMentionQuery = (text: string, cursor: number) => {
      const mention = detectComposerMentionQuery(text, cursor);
      onMentionQueryChangeRef.current?.(mention
        ? { start: mention.start, query: mention.query, cursor }
        : null);
    };

    const applyDraft = (next: string, cursor?: number) => {
      draftRef.current = next;
      setDraft(next);
      onDraftChangeRef.current?.(next);
      if (typeof cursor === "number") {
        window.requestAnimationFrame(() => {
          if (!inputRef.current) return;
          const clamped = Math.max(0, Math.min(cursor, next.length));
          inputRef.current.selectionStart = clamped;
          inputRef.current.selectionEnd = clamped;
          emitMentionQuery(next, clamped);
        });
      } else {
        emitMentionQuery(next, next.length);
      }
    };

    const commitCheckpoint = (nextText: string, cursor: number, force = false) => {
      historyRef.current = commitComposerDraftHistory(
        historyRef.current,
        { text: nextText, cursor },
        { force }
      );
      emitHistoryCaps();
    };

    const scheduleIdleCommit = (nextText: string, cursor: number) => {
      clearIdleCommit();
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        commitCheckpoint(nextText, cursor, false);
      }, COMPOSER_DRAFT_HISTORY_IDLE_MS);
    };

    const restoreSnapshot = (text: string, cursor: number) => {
      applyingHistoryRef.current = true;
      clearIdleCommit();
      applyDraft(text, cursor);
      window.requestAnimationFrame(() => {
        applyingHistoryRef.current = false;
      });
      emitHistoryCaps();
    };

    const undo = () => {
      if (readOnly) return false;
      clearIdleCommit();
      const current = { text: draftRef.current, cursor: readCursor() };
      // Flush pending typing into committed baseline before undo so the latest
      // coalesced edit is restorable via redo.
      if (current.text !== historyRef.current.committed.text) {
        historyRef.current = commitComposerDraftHistory(historyRef.current, current);
      }
      const result = undoComposerDraftHistory(historyRef.current, current);
      if (!result) {
        emitHistoryCaps();
        return false;
      }
      historyRef.current = result.state;
      restoreSnapshot(result.restored.text, result.restored.cursor);
      return true;
    };

    const redo = () => {
      if (readOnly) return false;
      clearIdleCommit();
      const current = { text: draftRef.current, cursor: readCursor() };
      const result = redoComposerDraftHistory(historyRef.current, current);
      if (!result) return false;
      historyRef.current = result.state;
      restoreSnapshot(result.restored.text, result.restored.cursor);
      return true;
    };

    useEffect(() => {
      clearIdleCommit();
      setDraft(initialValue);
      historyRef.current = resetComposerDraftHistory(initialValue);
      emitHistoryCaps();
      return () => clearIdleCommit();
      // resetKey is the intentional draft-session boundary (thread / new chat).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetKey, initialValue]);

    const insertNewlineAtCursor = () => {
      if (readOnly) return;
      const input = inputRef.current;
      const currentDraft = draftRef.current;
      const start = input?.selectionStart ?? currentDraft.length;
      const end = input?.selectionEnd ?? currentDraft.length;
      clearIdleCommit();
      commitCheckpoint(currentDraft, start, true);
      const { next, cursor } = insertNewlineIntoDraft(currentDraft, start, end);
      applyDraft(next, cursor);
      commitCheckpoint(next, cursor, true);
    };

    const insertTextAtCursor = (text: string) => {
      const insertion = String(text || "");
      const input = inputRef.current;
      const currentDraft = draftRef.current;
      const start = input?.selectionStart ?? currentDraft.length;
      const end = input?.selectionEnd ?? currentDraft.length;
      if (readOnly) {
        return { next: currentDraft, cursor: start };
      }
      clearIdleCommit();
      commitCheckpoint(currentDraft, start, true);
      const next = `${currentDraft.slice(0, start)}${insertion}${currentDraft.slice(end)}`;
      const cursor = start + insertion.length;
      applyDraft(next, cursor);
      commitCheckpoint(next, cursor, true);
      return { next, cursor };
    };

    useImperativeHandle(ref, () => ({
      getValue: () => draftRef.current,
      setValue: (value: string, cursor?: number) => {
        clearIdleCommit();
        applyDraft(value, cursor);
        historyRef.current = resetComposerDraftHistory(value, typeof cursor === "number" ? cursor : value.length);
        emitHistoryCaps();
      },
      focus: () => {
        inputRef.current?.focus();
      },
      insertNewlineAtCursor,
      insertTextAtCursor,
      getSelectionStart: () => inputRef.current?.selectionStart ?? draftRef.current.length,
      undo,
      redo,
      canUndo: () => composerDraftHistoryCaps(historyRef.current).canUndo,
      canRedo: () => composerDraftHistoryCaps(historyRef.current).canRedo
    }), [readOnly]);

    return (
      <textarea
        ref={inputRef}
        data-testid="composer-input"
        value={draft}
        disabled={false}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(event) => {
          if (applyingHistoryRef.current || readOnly) return;
          const next = event.target.value;
          const cursor = event.target.selectionStart ?? next.length;
          const inputType = (event.nativeEvent as InputEvent | undefined)?.inputType;
          applyDraft(next, cursor);
          if (shouldForceComposerDraftCheckpoint(inputType)) {
            clearIdleCommit();
            commitCheckpoint(next, cursor, true);
            return;
          }
          scheduleIdleCommit(next, cursor);
        }}
        onSelect={(event) => {
          const cursor = event.currentTarget.selectionStart ?? draft.length;
          emitMentionQuery(draft, cursor);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;

          if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Escape") {
            const handled = onMentionNavigate?.(
              event.key === "ArrowUp" ? "up" : event.key === "ArrowDown" ? "down" : "escape"
            );
            if (handled) {
              event.preventDefault();
              return;
            }
          }

          const mod = event.ctrlKey || event.metaKey;
          if (mod && event.key.toLowerCase() === "z" && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            undo();
            return;
          }
          if (
            mod
            && !event.altKey
            && (
              event.key.toLowerCase() === "y"
              || (event.key.toLowerCase() === "z" && event.shiftKey)
            )
          ) {
            event.preventDefault();
            redo();
            return;
          }

          if (event.key !== "Enter") return;
          if (event.altKey) {
            event.preventDefault();
            onAltEnter?.();
            return;
          }
          const mentionHandled = onMentionNavigate?.("enter");
          if (mentionHandled) {
            event.preventDefault();
            return;
          }
          // Electron/IME builds often fail to keep Shift+Enter newlines in a
          // controlled textarea; insert explicitly so send keeps real line breaks.
          if (event.shiftKey) {
            event.preventDefault();
            insertNewlineAtCursor();
            return;
          }
          event.preventDefault();
          onEnter();
        }}
        onContextMenu={onContextMenu}
        onPaste={onPaste}
      />
    );
  }
));
