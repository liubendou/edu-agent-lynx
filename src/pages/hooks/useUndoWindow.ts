/**
 * useUndoWindow —— 1s 撤销窗口（UID §三/附录：滑动判定撤销窗口=松手后 1 秒，
 * 撤销条压在卡片下方，不做弹窗）。滑动作答直接写 FSRS 参数，误滑得给反悔机会。
 * open(aluId, grade) 开窗（自动 1s 后静默关闭=落定）；undo() 在窗口内撤销并返回该卡 id。
 * 窗口关闭不清 judge 结果——judge 已在开窗前发生，撤销动作由调用方接 machine.revokeLastAnswer。
 */
import { useCallback, useEffect, useRef, useState } from '@lynx-js/react';
import type { Grade, AluId } from '../../domain/types';

/** 撤销窗口时长（UID 附录参数表） */
export const UNDO_WINDOW_MS = 1000;

export interface UndoEntry {
  aluId: AluId;
  grade: Grade;
}

export function useUndoWindow(): {
  entry: UndoEntry | null;
  open: (aluId: AluId, grade: Grade) => void;
  close: () => void;
} {
  const [entry, setEntry] = useState<UndoEntry | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setEntry(null);
  }, []);

  const open = useCallback((aluId: AluId, grade: Grade) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setEntry({ aluId, grade });
    timer.current = setTimeout(() => {
      timer.current = null;
      setEntry(null);
    }, UNDO_WINDOW_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  return { entry, open, close };
}
