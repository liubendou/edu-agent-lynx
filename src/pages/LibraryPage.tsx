/**
 * LibraryPage —— 资料库（UID §2.4）：切成单元后的列表，分两类摆——
 * 知识型条目是可测卡；资源型条目只生成入口卡（打开即看）、不进复习队列。
 * 每条都能点回原句（SourceLink，§4.3 可追溯 100% 硬门槛的展示面）。
 * 收藏（D11）：资料库列表操作，仅提升抽取优先级、不改间隔策略，可取消；
 * 仅对已有用户状态的条目开放（未见条目无状态可标，先学再收藏）。
 */
import { useCallback } from '@lynx-js/react';
import { EntryCard, SourceLink } from '../components';
import type { Alu, AluUserState } from '../domain/alu';
import type { AppMachine } from '../composition';
import { useReposSnapshot } from './hooks/useReposSnapshot';

export interface LibraryPageProps {
  machine: AppMachine;
  onBack: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  unseen: '未学',
  seen: '见过',
  learned_once: '学过一轮',
  retaining: '暂记',
  consolidated: '已稳固',
};

export function LibraryPage({ machine, onBack }: LibraryPageProps) {
  const { snap, reload } = useReposSnapshot(machine);

  const toggleBookmark = useCallback(
    async (alu: Alu, state: AluUserState) => {
      const next: AluUserState = { ...state, bookmarked: !(state.bookmarked === true) };
      await machine.repos.putAluState({ ...next, updatedAt: new Date().toISOString() });
      await reload();
    },
    [machine, reload],
  );

  const alus = Object.values(snap?.alus ?? {}).sort((a, b) => (a.id < b.id ? -1 : 1));
  const states = snap?.states ?? {};
  const knowledge = alus.filter((a) => a.kind !== 'resource');
  const resources = alus.filter((a) => a.kind === 'resource');

  return (
    <view className="page">
      <view className="page-head">
        <text className="Text Text--aux page-back pressable" bindtap={onBack}>← 返回</text>
        <text className="Text Text--section-title">资料库</text>
      </view>
      <view className="page-body">
        {alus.length === 0 ? (
          <text className="Text Text--body" style={{ color: 'var(--ink-soft)' }}>
            资料库还是空的——内容来源：学习科学元课程、一个真实学科、搜索与识图（§4.3）。
          </text>
        ) : null}

        <text className="Text Text--card-title lib-section">可测卡（知识型）</text>
        {knowledge.map((alu) => {
          const state = states[alu.id];
          const bookmarked = state?.bookmarked === true;
          return (
            <view key={alu.id} className="a2ui-card a2ui-grow lib-row">
              <text className="Text Text--body">{alu.front}</text>
              <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
                {`${alu.moduleId} · ${STATUS_LABEL[state?.status ?? 'unseen'] ?? '未学'}`}
              </text>
              <SourceLink aluId={alu.id} sourceRef={alu.source} label={alu.source.docTitle} nodeId={`lib-src-${alu.id}`} />
              {state !== undefined ? (
                <text
                  className="Text Text--aux pressable lib-bookmark"
                  style={{ color: bookmarked ? 'var(--accent)' : 'var(--ink-soft)' }}
                  bindtap={() => void toggleBookmark(alu, state)}
                >
                  {bookmarked ? '★ 已收藏（点取消）' : '☆ 收藏（抽取优先）'}
                </text>
              ) : null}
            </view>
          );
        })}

        <text className="Text Text--card-title lib-section">入口卡（资源型，不进复习队列）</text>
        {resources.map((alu) => (
          <EntryCard
            key={alu.id}
            title={alu.front}
            url={alu.source.locator.kind === 'url' ? alu.source.locator.url : ''}
            sourceRef={alu.source}
            nodeId={`lib-entry-${alu.id}`}
          />
        ))}
        {resources.length === 0 ? (
          <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>暂无资源型条目</text>
        ) : null}
      </view>
    </view>
  );
}
