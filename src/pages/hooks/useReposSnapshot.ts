/**
 * useReposSnapshot —— 页面级仓库快照装载（M4 pages/hooks，ARCHITECTURE §1）。
 * Home/Library/Map/Profile/Growth 五页面共用的冷启动读数：alu 主数据 + 用户状态 +
 * 画像 + 设置。reload 供写操作（收藏开关/画像编辑/设置开关）后刷新视图。
 * 数据源为 repos（端侧本地、离线可跑）；machine 内部状态以 boot/loadSnapshot 为准，
 * 页面写库后由下次 boot 收敛（ProfilePage 头注）。
 */
import { useCallback, useEffect, useState } from '@lynx-js/react';
import type { Alu, AluUserState } from '../../domain/alu';
import type { LearnerProfile } from '../../domain/profile';
import type { AluId } from '../../domain/types';
import type { AppSettings } from '../../storage/repos';
import type { AppMachine } from '../../composition';

export interface ReposSnapshot {
  alus: Record<AluId, Alu>;
  states: Record<AluId, AluUserState>;
  profile: LearnerProfile | null;
  settings: AppSettings;
}

export function useReposSnapshot(machine: AppMachine): {
  snap: ReposSnapshot | null;
  reload: () => Promise<void>;
} {
  const [snap, setSnap] = useState<ReposSnapshot | null>(null);

  const reload = useCallback(async () => {
    const [alus, states, profile, settings] = await Promise.all([
      machine.repos.listAlus(),
      machine.repos.listAluStates(),
      machine.repos.loadProfile(),
      machine.repos.loadSettings(),
    ]);
    setSnap({ alus, states, profile: profile ?? null, settings });
  }, [machine]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { snap, reload };
}
