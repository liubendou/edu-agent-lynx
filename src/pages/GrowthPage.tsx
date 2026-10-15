/**
 * GrowthPage —— 成长轨迹（UID §2.4）：掌握点数、板块掌握度、"这根柱子长了"
 * （§10.2 信号1：FSRS 的 S 稳定度上涨即时可视化 → ProgressRing）。
 * 红线自查（§10.2/UID §八）：不做连续打卡天数、可失去的资产、排行榜、按时长/卡数给奖。
 * grewBy（柱子长一格）需 S 的历史快照基线，M7 有轨迹数据后接；V1 先呈现当前掌握度。
 */
import { useMemo } from '@lynx-js/react';
import { ProgressRing } from '../components';
import type { AppMachine } from '../composition';
import { useReposSnapshot } from './hooks/useReposSnapshot';

export interface GrowthPageProps {
  machine: AppMachine;
  onBack: () => void;
}

/** 已稳固阈值（D5）：S≥21 天 = 已稳固，掌握度归一分母 */
const CONSOLIDATED_DAYS = 21;

export function GrowthPage({ machine, onBack }: GrowthPageProps) {
  const { snap } = useReposSnapshot(machine);

  const { learnedCount, consolidatedCount, rings } = useMemo(() => {
    const alus = Object.values(snap?.alus ?? {});
    const states = snap?.states ?? {};
    const learned = Object.values(states).filter((s) => s.status !== 'unseen' && s.status !== 'seen');
    const consolidated = learned.filter((s) => s.status === 'consolidated');
    const byModule = new Map<string, number[]>();
    for (const a of alus) {
      const st = states[a.id];
      if (st === undefined || st.status === 'unseen' || st.status === 'seen') continue;
      const list = byModule.get(a.moduleId) ?? [];
      list.push(st.fsrs.stability);
      byModule.set(a.moduleId, list);
    }
    const rings = [...byModule.entries()].map(([moduleId, stabilityList]) => {
      const avg = stabilityList.reduce((sum, s) => sum + s, 0) / stabilityList.length;
      return {
        moduleId,
        progress: Math.max(0, Math.min(1, avg / CONSOLIDATED_DAYS)),
        count: stabilityList.length,
        avgStability: avg,
      };
    }).sort((a, b) => b.progress - a.progress);
    return {
      learnedCount: learned.length,
      consolidatedCount: consolidated.length,
      rings,
    };
  }, [snap]);

  return (
    <view className="page">
      <view className="page-head">
        <text className="Text Text--aux page-back pressable" bindtap={onBack}>← 返回</text>
        <text className="Text Text--section-title">成长轨迹</text>
      </view>
      <view className="page-body">
        <view className="a2ui-card a2ui-grow">
          <text className="Text Text--hero">{`${String(consolidatedCount)}`}</text>
          <text className="Text Text--body" style={{ color: 'var(--ink-soft)' }}>
            {`个已稳固的掌握点（学过 ${String(learnedCount)} 个）`}
          </text>
        </view>
        {rings.length === 0 ? (
          <text className="Text Text--body" style={{ color: 'var(--ink-soft)' }}>
            还没有掌握度可画——先完成一次学习，这里会开始长。
          </text>
        ) : (
          rings.map((ring) => (
            <view key={ring.moduleId} className="a2ui-card a2ui-grow">
              <ProgressRing progress={ring.progress} label={ring.moduleId} />
              <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
                {`${ring.moduleId} · 平均稳定度 ${ring.avgStability.toFixed(1)} 天（${String(ring.count)} 个单元）`}
              </text>
            </view>
          ))
        )}
      </view>
    </view>
  );
}
