/**
 * MapPage —— 地图页（UID §2.4）：板块往下钻到单个学习单元，节点上带掌握度，能拖能点。
 * 复用 MapView 零件（单指拖平移 + 点节点点亮，主线程跟手）；掌握度用 ProgressRing
 * 按板块聚合（avgStability → 已稳固阈值 21 天归一，D5）。
 */
import { useMemo } from '@lynx-js/react';
import { MapView, ProgressRing } from '../components';
import type { AppMachine } from '../composition';
import { useReposSnapshot } from './hooks/useReposSnapshot';

export interface MapPageProps {
  machine: AppMachine;
  onBack: () => void;
}

/** 已稳固阈值（D5：scheduled_days≥21 技术默认值）——掌握度归一分母 */
const CONSOLIDATED_DAYS = 21;

export function MapPage({ machine, onBack }: MapPageProps) {
  const { snap } = useReposSnapshot(machine);

  const { nodes, edges, moduleRings } = useMemo(() => {
    const alus = Object.values(snap?.alus ?? {}).filter((a) => a.kind !== 'resource');
    const ids = new Set(alus.map((a) => a.id));
    const states = snap?.states ?? {};
    const nodes = alus.map((a) => ({
      id: a.id,
      label: a.front,
      definition: a.back,
    }));
    const edges = alus.flatMap((a) =>
      a.prereq.filter((p) => ids.has(p)).map((p) => ({ from: p, to: a.id, relation: 'prereq' as const })),
    );
    // 板块掌握度：S 稳定度均值 / 21 天归一（UID §2.4 节点带掌握度）
    const byModule = new Map<string, number[]>();
    for (const a of alus) {
      const st = states[a.id];
      if (st === undefined) continue;
      const list = byModule.get(a.moduleId) ?? [];
      list.push(st.fsrs.stability);
      byModule.set(a.moduleId, list);
    }
    const moduleRings = [...byModule.entries()].map(([moduleId, stabilityList]) => {
      const avg = stabilityList.reduce((sum, s) => sum + s, 0) / stabilityList.length;
      return {
        moduleId,
        progress: Math.max(0, Math.min(1, avg / CONSOLIDATED_DAYS)),
        count: stabilityList.length,
      };
    }).sort((a, b) => a.moduleId < b.moduleId ? -1 : 1);
    return { nodes, edges, moduleRings };
  }, [snap]);

  return (
    <view className="page">
      <view className="page-head">
        <text className="Text Text--aux page-back pressable" bindtap={onBack}>← 返回</text>
        <text className="Text Text--section-title">地图</text>
      </view>
      <view className="page-body">
        {nodes.length > 0 ? (
          <MapView nodes={nodes} edges={edges} nodeId="map-page" />
        ) : (
          <text className="Text Text--body" style={{ color: 'var(--ink-soft)' }}>
            还没有可画的学习单元，先学一点东西再来。
          </text>
        )}
        {moduleRings.map((ring) => (
          <view key={ring.moduleId} className="a2ui-card a2ui-grow map-module">
            <ProgressRing progress={ring.progress} label={ring.moduleId} />
            <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
              {`${ring.moduleId} · ${String(ring.count)} 个单元`}
            </text>
          </view>
        ))}
      </view>
    </view>
  );
}
