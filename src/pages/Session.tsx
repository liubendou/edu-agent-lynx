/**
 * Session —— 四档共用会话容器（UID §2.3；ARCHITECTURE §1）。
 *
 * 职责：
 *  - A2UISurface 宿主：useA2UIStream(machine.a2uiParser) 订阅渐进快照（T1 组合发射器
 *    emit 即喂 parser），骨架先出、内容渐进上屏，绝不白屏（UID §2.1/§四规则2）；
 *  - Action 路由（CONTRACTS §5）：agent → Observation 进 SessionLoop（grade/answer/next）；
 *    client → 本地直处理（M4 无音频/外链宿主，留注释位）；
 *  - 会话进度细线（UID §三 招牌时刻；F10 局部组件不进 catalog）：每还一张缩一格，
 *    scaleX transform-only（禁令1）；total=激活批次长度，done=已推进回合数的 UI 近似；
 *  - 横滑作答（只复习档开，UID §5.2/§八）：主线程脚本 1:1 跟手、主轴 8px 锁定、
 *    越阈（卡宽 30% 补位常量，M7 校准）右=对/左=错，"模糊"只走按钮；越阈吸附给
 *    hapticSnap（D1 ①），提交时 hapticJudge（D1 ②）；松手 1s 撤销窗口
 *    （domain.revokeAnswer ← machine.revokeLastAnswer，撤销后游标回退重呈该卡）；
 *  - 收尾四触发（§5.2）：卡住（先降难度 §10.1③）/跳过（连续 2 次→skip_twice）/收工
 *    （goodbye→正向峰值收尾 wrapUp）/空闲 90s（idle_90s 静默收尾）；退后台触发由
 *    宿主接线（M7），此处留 notifySessionEnd({enteredBackground}) 通道。
 */
import { useCallback, useEffect, useRef, useState } from '@lynx-js/react';
import { runOnBackground, useMainThreadRef } from '@lynx-js/react';
import type { MainThread } from '@lynx-js/types';
import { A2UISurface, useA2UIStream } from '../a2ui/surface';
import type { A2UIAction } from '../a2ui/catalog';
import type { AluId, Grade } from '../domain/types';
import { DIRECTION_LOCK_PX, SWIPE_THRESHOLD_RATIO } from '../design-system/motion';
import { hapticJudge, hapticSnap } from '../components/haptics';
import { StreamSkeleton } from '../components';
import type { AppMachine } from '../composition';
import { TURN_FAILURE_NOTICE } from '../chat';
import type { BootOutcome, Observation, SessionEndOutcome, TurnOutcome } from '../orchestrator/machine';
import { useUndoWindow } from './hooks/useUndoWindow';

/** 空闲收尾阈值 90s（§5.2 四触发之一） */
const IDLE_END_MS = 90_000;
/** 横滑作答阈值（px）：卡宽 30% × 常见卡宽 ~340px 补位；主线程拿不到实测宽度，M7 校准 */
const SWIPE_GRADE_PX = Math.round(SWIPE_THRESHOLD_RATIO * 340);

export interface SessionPageProps {
  machine: AppMachine;
  /** 进入会话时的激活/决策结果（skill 判断横滑开关、批次长度定细线格数） */
  boot: BootOutcome;
  /** 首页"说困惑"文字版带入：开场回合后并入一条 user_text（UID §2.2 底部入口） */
  initialText?: string;
  /** 退场（会话已收尾；App 侧负责重算今日决策） */
  onExit: () => void;
}

/** 会话进度细线（UID §三；局部组件不进 catalog，F10）：剩余格数的 scaleX 细线 */
function SessionHairline({ done, total }: { done: number; total: number }) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, (total - done) / total)) : 0;
  return (
    <view className="s-hairline-track">
      <view className="s-hairline" style={{ transform: `scaleX(${ratio})` }} />
    </view>
  );
}

export function SessionPage({ machine, boot, initialText, onExit }: SessionPageProps) {
  const snapshot = useA2UIStream(machine.a2uiParser);
  const [done, setDone] = useState(0);
  const [ended, setEnded] = useState<SessionEndOutcome | null>(null);
  /** 回合失败的可见提示文案（三级兜底第③级；只放面向用户的话，不放内部错误） */
  const [turnNotice, setTurnNotice] = useState<string | null>(null);
  const undo = useUndoWindow();

  const total = Math.max(1, boot.activation.aluIds.length);
  const swipeEnabled = boot.activation.skill === 'review'; // UID §八：横滑作答只复习档开

  const busyRef = useRef(false);
  const endingRef = useRef(false);
  const startedRef = useRef(false);
  const lastTarget = useRef<AluId | null>(null);
  const lastTurnAt = useRef(0);
  /** 失败那一回合的 observation（可安全重放时给「接着讲」入口） */
  const failedRef = useRef<Observation | null>(null);

  /**
   * 一回合：observation → machine.runTurn（流式渐进上屏）。
   * 三级兜底第③级（S1.8 / R-P3）：失败不留白、不静默——本回合没接上就落一条可见提示并给
   * 「接着讲」重试入口；提示只讲"下一步做什么"，不透出内部错误信息。
   */
  const turn = useCallback(
    async (obs: Observation): Promise<TurnOutcome | null> => {
      if (busyRef.current || ended !== null) return null;
      busyRef.current = true;
      try {
        const outcome = await machine.orchestrator.runTurn(obs);
        if (outcome.targetAluId !== null) lastTarget.current = outcome.targetAluId;
        if (outcome.phase !== 'wrap_up') setDone((d) => Math.min(total, d + 1));
        lastTurnAt.current = Date.now();
        if (!outcome.ok) {
          // validator 终态未过 = 本回合白跑：显式告知 + 可重放（重试入口见下方）
          failedRef.current = obs;
          setTurnNotice(TURN_FAILURE_NOTICE);
        } else {
          failedRef.current = null;
          setTurnNotice(null);
        }
        return outcome;
      } catch {
        failedRef.current = obs;
        setTurnNotice(TURN_FAILURE_NOTICE);
        return null;
      } finally {
        busyRef.current = false;
      }
    },
    [machine, ended, total],
  );

  /** 流内重试入口：重放失败那一回合（answer 带记账副作用 → 只留可见提示，不给入口） */
  const retryTurn = useCallback(() => {
    const obs = failedRef.current;
    if (obs === null) return;
    failedRef.current = null;
    setTurnNotice(null);
    void turn(obs);
  }, [turn]);

  /** 会话收尾（四触发经 domain.detectSessionEndTrigger 判定；无触发/无活动会话返回 null） */
  const endSession = useCallback(
    async (signals: { idleMs?: number; saidGoodbye?: boolean; enteredBackground?: boolean }): Promise<SessionEndOutcome | null> => {
      if (endingRef.current || ended !== null) return null;
      endingRef.current = true;
      try {
        const outcome = await machine.orchestrator.notifySessionEnd(signals);
        if (outcome !== null) setEnded(outcome);
        return outcome;
      } catch {
        // 收尾失败同样不静默：给可见提示（用户可继续作答或重试收尾），不透出内部错误
        setTurnNotice(TURN_FAILURE_NOTICE);
        return null;
      } finally {
        endingRef.current = false;
      }
    },
    [machine, ended],
  );

  /** 判定提交（FeedbackBar 三档 / 横滑越阈共用）：answer observation + 撤销窗开窗 */
  const submitGrade = useCallback(
    async (grade: Grade) => {
      const aluId = lastTarget.current;
      if (aluId === null) return;
      const latencyMs = Math.max(0, Date.now() - (lastTurnAt.current || Date.now()));
      const outcome = await turn({ kind: 'answer', aluId, grade, latencyMs });
      if (outcome !== null && grade !== 'fuzzy') undo.open(aluId, grade); // fuzzy 不写 FSRS，无需撤销
    },
    [turn, undo],
  );

  /** 横滑越阈提交（主线程 runOnBackground 落点；触觉两连：吸附+判定，D1） */
  const commitSwipe = useCallback(
    (grade: Grade) => {
      hapticJudge(grade);
      void submitGrade(grade);
    },
    [submitGrade],
  );

  // ── 横滑作答主线程脚本（1:1 跟手；主轴 8px 锁定；松手复位 transform）──
  const swipe = useMainThreadRef<{ startX: number; startY: number; locked: boolean } | null>(null);
  const onTouchStart = (e: MainThread.TouchEvent) => {
    'main thread';
    if (!swipeEnabled) return;
    const touch = e.touches[0];
    swipe.current = { startX: touch?.clientX ?? 0, startY: touch?.clientY ?? 0, locked: false };
  };
  const onTouchMove = (e: MainThread.TouchEvent) => {
    'main thread';
    const state = swipe.current;
    const touch = e.touches[0];
    if (state === null || touch === undefined) return;
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    if (!state.locked) {
      if (Math.abs(dx) < DIRECTION_LOCK_PX || Math.abs(dx) <= Math.abs(dy)) return;
      state.locked = true; // 主轴锁定为横向（竖向留给 RevealCard 上滑揭晓）
    }
    if (state.locked) {
      e.currentTarget.setStyleProperty('transform', `translateX(${dx}px)`); // 跟手 1:1
    }
  };
  const onTouchEnd = (e: MainThread.TouchEvent) => {
    'main thread';
    const state = swipe.current;
    swipe.current = null;
    e.currentTarget.setStyleProperty('transform', 'translateX(0px)'); // 复位（判定后整卡换新）
    if (state === null || !state.locked) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - state.startX;
    if (Math.abs(dx) < SWIPE_GRADE_PX) return; // 滑不够回中、不算数（UID §5.2）
    hapticSnap(); // 吸附到位触觉（D1 ①）
    runOnBackground(commitSwipe)(dx > 0 ? 'correct' : 'wrong'); // 右=对 / 左=错
  };

  /** 撤销窗口内反悔：撤销最近一次作答（FSRS 回滚+游标回退），重呈该卡 */
  const onUndo = useCallback(async () => {
    const entry = undo.entry;
    if (entry === null) return;
    undo.close();
    hapticSnap();
    const record = machine.orchestrator.revokeLastAnswer(entry.aluId);
    if (record !== null) await turn({ kind: 'open' }); // open 无域效应：纯重放当前目标卡
  }, [undo, machine, turn]);

  /** Action 路由（宿主）：agent → observation；client → 本地直处理（M4 留位） */
  const onAction = useCallback(
    (action: A2UIAction) => {
      if (ended !== null) {
        if (action.kind === 'agent' && action.action === 'next') onExit(); // 收尾卡"下一个"
        return;
      }
      if (action.kind === 'client') {
        // 本地直处理：TTS 播停（M6 语音接入）、open_source/open_url（宿主外链 M6）——
        // M4 无对应能力，静默吸收（不进 SessionLoop）
        return;
      }
      const payload = (action.payload ?? {}) as { grade?: unknown };
      if (action.action === 'grade' && (payload.grade === 'correct' || payload.grade === 'fuzzy' || payload.grade === 'wrong')) {
        void submitGrade(payload.grade);
      } else if (action.action === 'answer') {
        // 选择作答：端侧无判分器 → 并入对话观察交模型判定（validator 正常回路）
        void turn({ kind: 'user_text', text: `选择作答：${JSON.stringify(action.payload ?? {})}` });
      }
    },
    [ended, onExit, submitGrade, turn],
  );

  // 冷启动开表：清场上会话 surface（parser 复用）→ openSession + 开场回合（+ 首页带入的困惑原文）
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      machine.a2uiParser.reset();
      machine.orchestrator.openSession();
      await turn({ kind: 'open' });
      const text = initialText?.trim();
      if (text !== undefined && text.length > 0) await turn({ kind: 'user_text', text });
    })();
    // 仅挂载时执行一次（SessionPage 以 seq 为 key 重挂载开新会话）
  }, []);

  // 空闲 90s 收尾（§5.2）：每回合快照变化即重置计时
  useEffect(() => {
    if (ended !== null) return;
    const timer = setTimeout(() => void endSession({ idleMs: IDLE_END_MS }), IDLE_END_MS);
    return () => clearTimeout(timer);
  }, [snapshot, ended, endSession]);

  const showSkeleton = snapshot.components.length === 0 && turnNotice === null;
  const boundedLine = boot.boundedLine; // 开场有界话术（§10.1①：会话有界，不做开放结尾）

  return (
    <view className="page s-page">
      <view className="page-head">
        <text className="Text Text--section-title">{boundedLine}</text>
        <SessionHairline done={done} total={total} />
      </view>
      <view
        className="page-body s-surface-wrap"
        main-thread:bindtouchstart={onTouchStart}
        main-thread:bindtouchmove={onTouchMove}
        main-thread:bindtouchend={onTouchEnd}
        main-thread:bindtouchcancel={onTouchEnd}
      >
        {showSkeleton ? (
          <view>
            <StreamSkeleton heightPx={160} />
            <StreamSkeleton heightPx={120} />
          </view>
        ) : (
          <A2UISurface state={snapshot} onAction={onAction} />
        )}
        {turnNotice !== null ? (
          <view className="s-footer">
            <text className="Text Text--aux s-error">{turnNotice}</text>
            {failedRef.current !== null ? (
              <view className="s-footer-btn pressable" bindtap={retryTurn}>
                <text className="Text Text--body">接着讲</text>
              </view>
            ) : null}
          </view>
        ) : null}
      </view>
      {undo.entry !== null ? (
        <view className="s-undo pressable" bindtap={() => void onUndo()}>
          <text className="Text Text--body">撤销刚才的判定</text>
        </view>
      ) : null}
      {ended === null ? (
        <view className="s-footer">
          <view className="s-footer-btn pressable" bindtap={() => void turn({ kind: 'stuck' })}>
            <text className="Text Text--body">卡住了</text>
          </view>
          <view
            className="s-footer-btn pressable"
            bindtap={() =>
              void (async () => {
                await turn({ kind: 'skip' });
                await endSession({}); // 连续 2 次跳过 → skip_twice（触发判定在机器侧）
              })()
            }
          >
            <text className="Text Text--body">跳过</text>
          </view>
          <view
            className="s-footer-btn pressable"
            bindtap={() =>
              void (async () => {
                // goodbye 必触发收尾；返回 null（无活动会话等异常）→ 直接退场兜底
                const outcome = await endSession({ saidGoodbye: true });
                if (outcome === null) onExit();
              })()
            }
          >
            <text className="Text Text--body">收工</text>
          </view>
        </view>
      ) : (
        <view className="s-footer">
          {ended.wrapUp === null ? (
            // idle_90s 等静默收尾：无 wrapUp 收尾卡，给一个明确退场
            <view className="s-footer-btn pressable" bindtap={onExit}>
              <text className="Text Text--body">回首页</text>
            </view>
          ) : null}
        </view>
      )}
    </view>
  );
}
