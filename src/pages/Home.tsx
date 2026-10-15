/**
 * Home —— 条件式首屏两分支（PRD §6；ARCHITECTURE §1）：
 *  - 首启（boot.isFirstRun）：方案 D 元课程小课引导首屏（§2.5 时间线：骨架先出，
 *    0.5s 内首条内容；M5 管线 seeds 供给元课程内容，M4 会话先跑 Mock 流）；
 *  - 回访：今日计划面板（三行端侧算、零等待，UID §2.2）+ 六卡流
 *    （今天该学的一件事/上次没走完的/还有几张到期/下一步可以学什么/
 *    给自己定个目标(只前三天)/打开即看(资源型入口卡)）。
 * 底部常驻：说困惑入口（V1 文字版，ASR 只服务档4，UID §2.2）；
 * 口播条有音频才出现——M4 无 TTS 源（M6 接入），先不渲染。
 * 顶部轻入口：地图/资料库/画像/成长（无 TabBar/九宫格/抽屉，UID §八）。
 */
import { useCallback, useState } from '@lynx-js/react';
import { DueChip, EntryCard, StreamSkeleton, TodayPlanPanel } from '../components';
import type { AppMachine } from '../composition';
import type { BootOutcome } from '../orchestrator/machine';
import type { TodayDecision } from '../domain/decision';
import type { Route } from './routes';
import { useReposSnapshot } from './hooks/useReposSnapshot';
import { SEED_META_COURSE } from '../pipeline/seeds';

export interface HomePageProps {
  machine: AppMachine;
  boot: BootOutcome;
  navigate: (route: Route) => void;
  /** 开始今日学习（进会话；initialText=说困惑原文） */
  onOpenSession: (initialText?: string) => void;
}

/** "今天建议学的一条"（TodayPlanPanel 第三行；回访首屏不出现 first_run，F6） */
function suggestionTextOf(decision: TodayDecision, frontOf: (aluId: string) => string | undefined): string {
  switch (decision.kind) {
    case 'review':
      return `先还清 ${String(decision.batch.length)} 张到期卡`;
    case 'remediation':
      return `补讲今天答错的 ${String(decision.aluIds.length)} 条`;
    case 'new_learn': {
      const aluId = decision.suggestion.aluId;
      if (aluId !== undefined) {
        const front = frontOf(aluId);
        if (front !== undefined) return front;
      }
      return decision.suggestion.moduleId !== undefined
        ? `新学「${decision.suggestion.moduleId}」`
        : '为你准备了一条新内容';
    }
    default:
      return '开始今天的学习';
  }
}

export function Home({ machine, boot, navigate, onOpenSession }: HomePageProps) {
  const { snap } = useReposSnapshot(machine);
  const [confessOpen, setConfessOpen] = useState(false);
  const [confessText, setConfessText] = useState('');

  const decision = boot.decision;
  const profile = snap?.profile ?? null;
  const summaries = profile?.sessionSummaries ?? [];
  const lastSummary = summaries[summaries.length - 1];
  const goals = profile?.facts.goals ?? [];
  const frontOf = useCallback(
    (aluId: string) => snap?.alus[aluId]?.front,
    [snap],
  );

  // 首启：方案 D 小课引导（§2.5：骨架+首条卡容器先出，小课 3s 后开始——M4 由 Mock 流承接）
  if (boot.isFirstRun) {
    return (
      <view className="page home-page">
        <view className="home-nav">
          {(['map', 'library', 'profile', 'growth'] as const).map((r) => (
            <text key={r} className="Text Text--aux home-nav-link pressable" bindtap={() => navigate(r)}>
              {r === 'map' ? '地图' : r === 'library' ? '资料库' : r === 'profile' ? '画像' : '成长'}
            </text>
          ))}
        </view>
        <view className="page-body home-stream">
          <view className="a2ui-card a2ui-grow home-first">
            <text className="Text Text--hero">先把方法装进来</text>
            {/* M7 T1：首启元课程文案改由 M5 真种子驱动（替换 M4 fixture 占位） */}
            <text className="Text Text--body" style={{ color: 'var(--ink-soft)' }}>
              {`《${SEED_META_COURSE.subjects[0].name}》小课：${SEED_META_COURSE.modules.map((m) => m.name).join('、')}——边讲边插问，答对才算学会。`}
            </text>
            <view className="tpp-start pressable" bindtap={() => onOpenSession()}>
              <text className="Text Text--body tpp-start-text">开始小课</text>
            </view>
          </view>
          <StreamSkeleton heightPx={120} />
        </view>
      </view>
    );
  }

  // ── 回访首屏：今日计划面板 + 六卡流 ──
  const dueCount = decision.kind === 'review' ? decision.batch.length : 0;
  const remediationCount =
    decision.kind === 'review' ? decision.remediationCount : decision.kind === 'remediation' ? decision.aluIds.length : 0;
  const suggestionText = suggestionTextOf(decision, frontOf);
  const newAluId = decision.kind === 'new_learn' ? decision.suggestion.aluId : undefined;
  const newAlu = newAluId !== undefined ? snap?.alus[newAluId] : undefined;
  const resourceAlus = Object.values(snap?.alus ?? {}).filter((a) => a.kind === 'resource');
  const showGoalCard = summaries.length < 3; // 只前三天出现（≈前 3 个会话），之后不打扰（UID §2.2）

  const submitConfess = () => {
    const text = confessText.trim();
    if (text.length === 0) return;
    setConfessOpen(false);
    setConfessText('');
    onOpenSession(text); // 说困惑 → 带原话进会话（点名优先级最高，§7.8②）
  };

  return (
    <view className="page home-page">
      <view className="home-nav">
        {(['map', 'library', 'profile', 'growth'] as const).map((r) => (
          <text key={r} className="Text Text--aux home-nav-link pressable" bindtap={() => navigate(r)}>
            {r === 'map' ? '地图' : r === 'library' ? '资料库' : r === 'profile' ? '画像' : '成长'}
          </text>
        ))}
      </view>

      <view className="page-body home-stream">
        {/* 回访第一屏：三行端侧算，零等待（UID §2.2） */}
        <TodayPlanPanel
          dueCount={dueCount}
          remediationCount={remediationCount}
          suggestionText={suggestionText}
          nodeId="home-plan"
        />

        {/* 六卡流（UID §2.2；stagger 只对首 6 条生效由 .a2ui-grow+css 承担） */}
        {/* ① 今天该学的一件事（每次打开的第一条） */}
        <view className="a2ui-card a2ui-grow">
          <text className="Text Text--card-title">今天该学的一件事</text>
          <text className="Text Text--body" style={{ color: 'var(--ink-soft)' }}>{boot.reason}</text>
          <view className="tpp-start pressable" bindtap={() => onOpenSession()}>
            <text className="Text Text--body tpp-start-text">开始</text>
          </view>
        </view>

        {/* ② 上次没走完的 */}
        {lastSummary !== undefined && lastSummary.nextSuggestion.length > 0 ? (
          <view className="a2ui-card a2ui-grow">
            <text className="Text Text--card-title">上次没走完的</text>
            <text className="Text Text--body">{lastSummary.nextSuggestion}</text>
          </view>
        ) : null}

        {/* ③ 还有几张到期（点开就还，进复习会话=招牌时刻入口） */}
        {dueCount > 0 ? (
          <view className="a2ui-card a2ui-grow">
            <DueChip count={dueCount} nodeId="home-due" onAction={() => onOpenSession()} />
          </view>
        ) : null}

        {/* ④ 下一步可以学什么（有推荐才出现，一次最多两条；M4 候选=决策建议 1 条） */}
        {newAlu !== undefined ? (
          <view className="a2ui-card a2ui-grow">
            <text className="Text Text--card-title">下一步可以学什么</text>
            <text className="Text Text--body">{newAlu.front}</text>
            <view className="tpp-start pressable" bindtap={() => onOpenSession()}>
              <text className="Text Text--body tpp-start-text">学这个</text>
            </view>
          </view>
        ) : null}

        {/* ⑤ 给自己定个目标（前三天引导，无目标时给最低成本入口） */}
        {showGoalCard && goals.length === 0 ? (
          <view className="a2ui-card a2ui-grow">
            <text className="Text Text--card-title">给自己定个目标</text>
            <text className="Text Text--body" style={{ color: 'var(--ink-soft)' }}>
              有期限的目标会自动调节复习节奏（临近就调高保持率、压缩新内容）。
            </text>
            <view className="tpp-start pressable" bindtap={() => navigate('profile')}>
              <text className="Text Text--body tpp-start-text">去画像页</text>
            </view>
          </view>
        ) : null}

        {/* ⑥ 打开即看（资源型入口卡，不进复习队列） */}
        {resourceAlus.map((alu) => (
          <EntryCard
            key={alu.id}
            title={alu.front}
            url={alu.source.locator.kind === 'url' ? alu.source.locator.url : ''}
            sourceRef={alu.source}
            nodeId={`home-entry-${alu.id}`}
          />
        ))}
      </view>

      {/* 底部常驻：说困惑（V1 文字版）；口播条 M6 有音频源后再上（UID §2.2） */}
      <view className="home-bottom">
        {confessOpen ? (
          <view className="home-confess">
            <input
              className="home-confess-input"
              placeholder="写一句你的困惑，比如：复习一下信度"
              bindinput={(e) => setConfessText(e.detail.value)}
            />
            <view className="s-footer-btn pressable" bindtap={submitConfess}>
              <text className="Text Text--body">发送</text>
            </view>
          </view>
        ) : (
          <view className="s-footer-btn pressable" bindtap={() => setConfessOpen(true)}>
            <text className="Text Text--body">说困惑（写一句话）</text>
          </view>
        )}
      </view>
    </view>
  );
}
