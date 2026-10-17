/**
 * Chat —— 唯一首屏「对话页」（改造清单 §1；体验脚本 §1 首启第一屏 / §2 回访）。
 *
 * 批次 1 范围（首屏最小可看版）：首启开场**自动发生**（无需点任何东西，脚本 §1.3）+
 * 对话流外壳 + 常驻输入框。
 *
 * 职责：
 *  - 冷启动：reset parser → openSession → 立即落下 agent 开场消息 → open 回合（内容流式上屏）；
 *  - 卡片：仍走原路（A2UI 组件节点 → A2UISurface），由 MessageList 嵌进对话流（不单独占页）；
 *  - 输入：常驻 Composer，发送走现成通道 turn({kind:'user_text'})——orchestrator 与云侧零改动；
 *  - Action：agent 类判定（grade/answer）回流回合；client 类（TTS/外链）M6 再接，先静默吸收。
 *
 * 三级兜底（验收 S1.8 / 红线 R-P3，本页落第③级「显式告知用户」）：① 升级重试、② 纯文本降级
 * 在 orchestrator/云侧完成；本页保证**任何一次发送回合都不留白、不静默**——
 * 失败（云侧异常 / validator 终态未过 / 本回合无内容可上屏 / 上一回合未跑完又发）一律在会话流里
 * 落一条可见提示 + 可重试入口；文案只说"下一步做什么"，不透出堆栈与内部代号。
 * 无 Key 引导（不首屏拦截）：离线部分照常可用，只在回合真失败且 config.mock === true 时，
 * 由提示里的入口引导去设置页填 API Key。
 *
 * 硬约束：对话外壳（src/chat/*）客户端本地渲染，不进 a2ui/surface.tsx registry 与
 * a2ui/catalog.ts（catalog 是云侧字节级稳定前缀③，见 cloud/context-builder.ts）。
 * 本批不做：回访折叠条（批次 2）、会话内三按钮 → 对话快捷回复、free 型作答输入框、卡片留灰（批次 3）。
 */
import { useCallback, useEffect, useRef, useState } from '@lynx-js/react';
import { useA2UIStream } from '../a2ui/surface';
import type { A2UIAction } from '../a2ui/catalog';
import type { AluId, Grade } from '../domain/types';
import {
  ChatComposer, MessageList, SuggestionChips, agentItem, isRetryable, noticeItem, openingTextFor,
  typingItem, userItem, withTyping, TURN_BUSY_NOTICE, TURN_FAILURE_NOTICE, TURN_NO_KEY_NOTICE,
  type ChatItem,
} from '../chat';
import type { AppMachine } from '../composition';
import type { BootOutcome, Observation, TurnOutcome } from '../orchestrator/machine';
import type { Route } from './routes';

/** 空闲收尾阈值 90s（§5.2 四触发之一；批次 1 只用于"上一场未收尾"的静默兜底） */
const IDLE_END_MS = 90_000;

export interface ChatPageProps {
  machine: AppMachine;
  boot: BootOutcome;
  /** 顶部轻入口（⚙ 设置 → 画像/设置页，☰ 更多 → 地图/资料库/成长） */
  navigate: (route: Route) => void;
  /** 无 Key 判据（App 冷启动读 config.mock === true）：回合真失败时引导去设置页，不首屏拦截 */
  cloudMock: boolean;
}

export function ChatPage({ machine, boot, navigate, cloudMock }: ChatPageProps) {
  const snapshot = useA2UIStream(machine.a2uiParser);
  /** 0s 就有打字骨架（脚本 §1.3）：开场消息在挂载后的 effect 里落下，骨架随即被顶掉 */
  const [items, setItems] = useState<ChatItem[]>([typingItem()]);
  const [moreOpen, setMoreOpen] = useState(false);

  const busyRef = useRef(false);
  const startedRef = useRef(false);
  const lastTarget = useRef<AluId | null>(null);
  const lastTurnAt = useRef(0);

  /** 兜底落点：一次失败回合 → 会话流里一条可见提示（+ 可重试入口；无 Key 时 + 去设置页入口） */
  const pushNotice = useCallback(
    (text: string, observation: Observation | null, settingsGuide: boolean) => {
      setItems((prev) => [
        ...prev,
        noticeItem(text, {
          ...(observation !== null && isRetryable(observation) ? { retry: observation } : {}),
          ...(settingsGuide ? { settingsGuide: true } : {}),
        }),
      ]);
    },
    [],
  );

  /**
   * 回合成功后**按 notice 粒度消费**本条提示：移除 retry 指向本回合 observation（同一对象）的提示——
   * 它说的"这一回合没接上"已不成立，留着是自相矛盾；其余 notice 一律原样保留，包括它们各自的重试
   * 入口（例如上一回合未跑完时落下的忙提示，其 retry 指向的是另一条 observation，不得被连带抹掉）。
   * 判据用对象引用（pushNotice/noticeItem 存的就是同一个 observation，重试入口原样传回 turn）。
   */
  const consumeNotice = useCallback((observation: Observation) => {
    setItems((prev) => prev.filter((i) => !(i.kind === 'notice' && i.retry === observation)));
  }, []);

  /**
   * 一回合：observation → machine.runTurn（A2UI 流式上屏）。
   * 绝不静默：跑不完 / 没内容 / 上一回合没完 → 都落可见提示，给出下一步动作。
   */
  const turn = useCallback(
    async (observation: Observation): Promise<TurnOutcome | null> => {
      if (busyRef.current) {
        // 不静默丢弃（R-P3）：这条也进流，并给重试入口
        pushNotice(TURN_BUSY_NOTICE, observation, false);
        return null;
      }
      busyRef.current = true;
      setItems((prev) => withTyping(prev, true)); // "对方正在输入"（必被内容顶掉）
      try {
        const outcome = await machine.orchestrator.runTurn(observation);
        if (outcome.targetAluId !== null) lastTarget.current = outcome.targetAluId;
        lastTurnAt.current = Date.now();
        if (!outcome.ok || outcome.components.length === 0) {
          // validator 终态未过 / 本回合无任何可上屏内容 = 空白回合 → 显式告知
          pushNotice(TURN_FAILURE_NOTICE, observation, cloudMock);
        } else {
          consumeNotice(observation);
        }
        return outcome;
      } catch {
        // 云侧异常：只给用户动作，不暴露堆栈（错误明细走埋点，D4）
        pushNotice(cloudMock ? TURN_NO_KEY_NOTICE : TURN_FAILURE_NOTICE, observation, cloudMock);
        return null;
      } finally {
        busyRef.current = false;
        setItems((prev) => withTyping(prev, false));
      }
    },
    [machine, cloudMock, pushNotice, consumeNotice],
  );

  /** 判定提交（FeedbackBar 三档）：answer observation 回流回合 */
  const submitGrade = useCallback(
    async (grade: Grade) => {
      const aluId = lastTarget.current;
      if (aluId === null) return;
      const latencyMs = Math.max(0, Date.now() - (lastTurnAt.current || Date.now()));
      await turn({ kind: 'answer', aluId, grade, latencyMs });
    },
    [turn],
  );

  /** Action 路由（宿主）：agent → observation；client → 本地直处理（M6 接 TTS/外链，先静默吸收） */
  const onAction = useCallback(
    (action: A2UIAction) => {
      if (action.kind === 'client') return;
      const payload = (action.payload ?? {}) as { grade?: unknown };
      if (
        action.action === 'grade'
        && (payload.grade === 'correct' || payload.grade === 'fuzzy' || payload.grade === 'wrong')
      ) {
        void submitGrade(payload.grade);
      } else if (action.action === 'answer') {
        void turn({ kind: 'user_text', text: `选择作答：${JSON.stringify(action.payload ?? {})}` });
      }
    },
    [submitGrade, turn],
  );

  /** 用户在输入框打字 → 右侧 user 消息进流 + agent 在同一流里回应（脚本 §3） */
  const onSend = useCallback(
    (text: string) => {
      setItems((prev) => [...prev, userItem(text)]);
      void turn({ kind: 'user_text', text }); // 打字骨架由 turn 统一挂/摘，避免回合被丢弃时残留死骨架
    },
    [turn],
  );

  // 冷启动开场（脚本 §1.3：0s 骨架可见；≤0.5s 第一条真实内容；全程无需点击）
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      machine.a2uiParser.reset();
      // 上一场若没正常收尾（用户中途跳去次级页又回来）→ 先静默收尾、再重新激活开新场
      const fled = await machine.orchestrator.notifySessionEnd({ idleMs: IDLE_END_MS }).catch(() => null);
      if (fled !== null) await machine.orchestrator.boot().catch(() => { /* 收尾后重激活失败：交给下方兜底文案 */ });
      machine.orchestrator.openSession();
      // 开场消息立刻落进流里（初始态已有打字骨架），随后 open 回合让内容自动跑起来
      setItems((prev) => [...prev, agentItem(openingTextFor(boot))]);
      await turn({ kind: 'open' }); // 内容自动跑起来，用户不用做任何动作
    })().catch(() => {
      // 开表前就失败（reset/收尾/激活/开表任一步）：开场仍然可见 + 流内兜底提示，不留白
      pushNotice(cloudMock ? TURN_NO_KEY_NOTICE : TURN_FAILURE_NOTICE, null, cloudMock);
    });
    // 仅挂载时执行一次（ChatPage 是唯一首屏；重挂载场景由上方静默收尾守卫处理）
  }, []);

  /** 流内重试入口：重放失败那一回合（answer/tool_result 不给入口，见 isRetryable） */
  const retryTurn = useCallback((observation: Observation) => { void turn(observation); }, [turn]);

  return (
    <view className="page chat-page">
      {/* 顶部条（脚本 §1.1-1）：应用名 + 右上角 ⚙设置 / ☰更多（首启不显示计划条） */}
      <view className="chat-nav">
        <text className="Text Text--section-title chat-nav-app">学习 Agent</text>
        <view className="chat-nav-actions">
          <text className="chat-nav-icon pressable" bindtap={() => navigate('profile')}>⚙</text>
          <text
            className="chat-nav-icon pressable"
            bindtap={() => setMoreOpen((open) => !open)}
          >
            ☰
          </text>
        </view>
      </view>
      {moreOpen ? (
        <view className="chat-more">
          {(['map', 'library', 'growth'] as const).map((r) => (
            <text key={r} className="Text Text--aux chat-more-link pressable" bindtap={() => navigate(r)}>
              {r === 'map' ? '地图' : r === 'library' ? '资料库' : '成长'}
            </text>
          ))}
        </view>
      ) : null}

      <view className="page-body chat-body">
        {/* 失败提示的可见性由 MessageList 在流内就地渲染（三级兜底第③级），此处不再另挂一条飘在外面的错误文本 */}
        <MessageList
          items={items}
          surface={snapshot}
          onAction={onAction}
          onRetry={retryTurn}
          onOpenSettings={() => navigate('profile')}
        />
        {/* 示例问题（豆包式入口，3~4 条）：用户还没开口时出现在输入框上方，一开口即收起 */}
        {items.some((item) => item.kind === 'user') ? null : <SuggestionChips onPick={onSend} />}
      </view>

      <ChatComposer onSend={onSend} />
    </view>
  );
}
