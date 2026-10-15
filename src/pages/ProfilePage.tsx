/**
 * ProfilePage —— 我的画像（UID §2.4）：全部记录可见，逐条能改能删；两个隐私开关放这里。
 *  - 偏好边界：声明（即时落库）/删除（直接写 profile 集合）；会话中的机器内存画像
 *    以 boot 快照为基准，页面写库后下次 boot 收敛（composition.loadSnapshot 是唯一入口）；
 *  - 两个隐私开关（§5.5 分级开关①②）：privacyAdaptive / privacyCloudInference；
 *  - reduceMotion（宿主写入的系统"减少动态效果"）可在此手动开：静止档触觉保留（D1），
 *    开关即时经 setHapticsSignals 生效（T8 主题接线）；
 *  - 记录可见：作答流水（review_log，仅 correct/wrong 落盘 D8）+ 会话摘要尾部；
 *  - 成绩录入（D4）入口在 M6 识图链路接通后补（GradeEvent 手动录入兜底同批）。
 */
import { useCallback, useState } from '@lynx-js/react';
import { declareBoundary } from '../domain/profile';
import { setHapticsSignals } from '../components/haptics';
import type { AppMachine } from '../composition';
import { useReposSnapshot } from './hooks/useReposSnapshot';

export interface ProfilePageProps {
  machine: AppMachine;
  onBack: () => void;
}

export function ProfilePage({ machine, onBack }: ProfilePageProps) {
  const { snap, reload } = useReposSnapshot(machine);
  const [boundaryText, setBoundaryText] = useState('');

  const settings = snap?.settings;
  const profile = snap?.profile ?? null;
  const boundaries = profile?.preferences.boundaries ?? [];
  const goals = profile?.facts.goals ?? [];
  const summaries = profile?.sessionSummaries ?? [];

  const toggleSwitch = useCallback(
    async (key: 'privacyAdaptive' | 'privacyCloudInference' | 'reduceMotion') => {
      const current = settings ?? { privacyAdaptive: true, privacyCloudInference: true, cloudSync: false };
      const next = { ...current, [key]: !current[key] };
      await machine.repos.saveSettings(next);
      if (key === 'reduceMotion') {
        setHapticsSignals({
          reduceMotion: next.reduceMotion === true,
          lowEndDevice: false,
          powerSave: false,
          sustainedJank: false,
        });
      }
      await reload();
    },
    [settings, machine, reload],
  );

  const addBoundary = useCallback(async () => {
    const text = boundaryText.trim();
    const base = profile;
    if (text.length === 0 || base === null) return;
    const boundary = declareBoundary(base.preferences, text, new Date()); // 纯域函数：去重/时间戳
    await machine.repos.saveProfile({
      ...base,
      preferences: {
        ...base.preferences,
        boundaries: [...base.preferences.boundaries.filter((b) => b.text !== text), boundary],
      },
    });
    setBoundaryText('');
    await reload();
  }, [boundaryText, profile, machine, reload]);

  const removeBoundary = useCallback(
    async (id: string) => {
      const base = profile;
      if (base === null) return;
      await machine.repos.saveProfile({
        ...base,
        preferences: { ...base.preferences, boundaries: base.preferences.boundaries.filter((b) => b.id !== id) },
      });
      await reload();
    },
    [profile, machine, reload],
  );

  return (
    <view className="page">
      <view className="page-head">
        <text className="Text Text--aux page-back pressable" bindtap={onBack}>← 返回</text>
        <text className="Text Text--section-title">我的画像</text>
      </view>
      <view className="page-body">
        {/* 隐私开关（§5.5 分级开关①②） */}
        <view className="a2ui-card a2ui-grow">
          <text className="Text Text--card-title">隐私</text>
          {([
            ['privacyAdaptive', '学习数据用于端侧自适应'],
            ['privacyCloudInference', '数据用于云端推理（不用于训练）'],
            ['reduceMotion', '减少动态效果（静止档：只留透明度切换，触觉保留）'],
          ] as const).map(([key, label]) => {
            const on = settings?.[key] === true;
            return (
              <view key={key} className="row" bindtap={() => void toggleSwitch(key)}>
                <text className="Text Text--body row-main">{label}</text>
                <text className="Text Text--body" style={{ color: on ? 'var(--accent)' : 'var(--ink-soft)' }}>
                  {on ? '开' : '关'}
                </text>
              </view>
            );
          })}
        </view>

        {/* 目标（全部记录可见） */}
        <view className="a2ui-card a2ui-grow">
          <text className="Text Text--card-title">目标</text>
          {goals.length === 0 ? (
            <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>还没有目标（V1 由会话中自然声明收集）</text>
          ) : (
            goals.map((goal) => (
              <view key={goal.text} className="row">
                <text className="Text Text--body row-main">{goal.text}</text>
                <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
                  {goal.deadline !== undefined ? goal.deadline.slice(0, 10) : '无期限'}
                </text>
              </view>
            ))
          )}
        </view>

        {/* 偏好边界：逐条能删；可声明 */}
        <view className="a2ui-card a2ui-grow">
          <text className="Text Text--card-title">偏好边界（硬约束）</text>
          {boundaries.length === 0 ? (
            <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
              还没有边界。声明一条，比如：别用太多类比。
            </text>
          ) : (
            boundaries.map((boundary) => (
              <view key={boundary.id} className="row">
                <text className="Text Text--body row-main">{boundary.text}</text>
                <text
                  className="Text Text--aux pressable"
                  style={{ color: 'var(--bad)' }}
                  bindtap={() => void removeBoundary(boundary.id)}
                >
                  删除
                </text>
              </view>
            ))
          )}
          <view className="home-confess">
            <input
              className="home-confess-input"
              placeholder="声明一条偏好边界"
              bindinput={(e) => setBoundaryText(e.detail.value)}
            />
            <view className="s-footer-btn pressable" bindtap={() => void addBoundary()}>
              <text className="Text Text--body">添加</text>
            </view>
          </view>
        </view>

        {/* 记录可见：作答流水 + 最近会话 */}
        <view className="a2ui-card a2ui-grow">
          <text className="Text Text--card-title">学习记录</text>
          {summaries.length === 0 ? (
            <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>还没有会话记录</text>
          ) : (
            summaries.slice(-5).map((summary) => (
              <text key={summary.sessionId} className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
                {`${summary.at.slice(0, 10)} · ${summary.whatHappened}`}
              </text>
            ))
          )}
        </view>
      </view>
    </view>
  );
}
