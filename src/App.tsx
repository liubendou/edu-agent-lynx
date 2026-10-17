/**
 * App —— 路由容器 + 条件首屏装配（ARCHITECTURE §1；PRD §6）。
 *
 * 职责（M4 T2/T8）：
 *  - 冷启动装配：createAppMachine()（composition root 一处装配）→ orchestrator.boot()
 *    （首启判定+今日决策，端侧零网络）→ 条件首屏分支依据（isFirstRun → Home 方案 D 分支）；
 *  - 主题接线（T8）：亮暗 readColorScheme()（宿主写 lynx.__globalProps.appTheme，
 *    冷启动即有值无闪白；热切换重渲染 M7 宿主联调）→ 根节点挂 tokens 两件套 class；
 *    降级档信号（settings.reduceMotion → 静止档，触觉保留 D1）注入 haptics 门控；
 *  - 路由：单列流 + 轻入口（无 TabBar，UID §八）；会话以 seq 为 key 重挂载开新会话；
 *    退会话后重算今日决策（队列/画像已因会话而变）。
 *  - 无 Key（cloud.local.json 缺失/Key 为空 → config.mock=true）不做首屏拦截：App 照常启动、
 *    端侧复习/种子/画像照常可用；只把判据传给首屏，由对话页在**真正失败的那一刻**引导去设置页。
 * 启动期骨架先出（StreamSkeleton 定高，UID §2.1 不白屏）；失败给文案。
 */
import { useCallback, useEffect, useState } from '@lynx-js/react';
import './App.css';
import { createAppMachine, seedFirstRunContent, type AppMachine } from './composition';
import { loadCloudConfig } from './cloud/config';
import type { BootOutcome } from './orchestrator/machine';
import { readColorScheme, themeClassName } from './design-system/theme';
import { setHapticsSignals } from './components/haptics';
import { StreamSkeleton } from './components';
import { ChatPage } from './pages/Chat';
import { Home } from './pages/Home';
import { SessionPage } from './pages/Session';
import { MapPage } from './pages/MapPage';
import { LibraryPage } from './pages/LibraryPage';
import { ProfilePage } from './pages/ProfilePage';
import { GrowthPage } from './pages/GrowthPage';
import type { Route } from './pages/routes';

export function App() {
  const [machine, setMachine] = useState<AppMachine | null>(null);
  const [boot, setBoot] = useState<BootOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 无 Key 判据（config.mock === true）：不在首屏拦截——App 照常启动、离线部分可用，
  // 只在真正发起云侧生成且失败时（Chat 页兜底提示）引导去设置页填 API Key。
  const [cloudMock, setCloudMock] = useState(false);
  // 唯一首屏 = chat（改造清单 §1）；home/session 暂留回退对比，批次 3 清理
  const [route, setRoute] = useState<Route>('chat');
  const [sessionSeed, setSessionSeed] = useState<{ initialText?: string; seq: number }>({ seq: 0 });

  // 冷启动装配（一次）：machine → 主题/触觉门控接线 → boot
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const m = await createAppMachine();
        const cloudConfig = await loadCloudConfig(); // 无 Key 判据（读不到/Key 为空 → mock=true）
        const settings = await m.repos.loadSettings();
        setHapticsSignals({
          reduceMotion: settings.reduceMotion === true, // 宿主写 settings（theme.ts 头注）；页内可手动开
          lowEndDevice: false, // 性能信号（内存/核数/省电/持续抖动）宿主接线，M7 实测校准
          powerSave: false,
          sustainedJank: false,
        });
        const outcome0 = await m.orchestrator.boot();
        // M7 T1 种子接线：首启判定成立 → M5 真种子幂等灌库（已有数据不覆盖）→ 重新决策
        let outcome = outcome0;
        if (outcome0.isFirstRun) {
          const seeded = await seedFirstRunContent(m.repos);
          if (seeded > 0) outcome = await m.orchestrator.boot();
        }
        // D3 收缝：配置了 skillUpdateManifestUrl 才拉取热更新（未配置 = skipped，静默零网络）
        void m.skillUpdater.checkAndApplyFromSettings();
        if (!alive) return;
        setMachine(m);
        setBoot(outcome);
        setCloudMock(cloudConfig.mock);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const openSession = useCallback((initialText?: string) => {
    setSessionSeed((prev) => ({
      ...(initialText !== undefined ? { initialText } : {}),
      seq: prev.seq + 1,
    }));
    setRoute('session');
  }, []);

  /** 退会话：重算今日决策（复习批次/队列已因会话而变），再回首页 */
  const exitSession = useCallback(() => {
    setRoute('home');
    if (machine !== null) {
      void machine.orchestrator
        .boot()
        .then((outcome) => setBoot(outcome))
        .catch(() => { /* 会话未正常收尾等异常：保留旧 boot 视图，下次进会话前再收敛 */ });
    }
  }, [machine]);

  const theme = themeClassName(readColorScheme()); // T8：亮暗接线（根节点 tokens 两件套）

  return (
    <view className={`app-root design-tokens ${theme}`}>
      {machine === null || boot === null ? (
        <view className="boot">
          {error !== null ? (
            <text className="Text Text--body">{`启动失败：${error}`}</text>
          ) : (
            <StreamSkeleton heightPx={240} />
          )}
        </view>
      ) : route === 'chat' ? (
        <ChatPage machine={machine} boot={boot} navigate={setRoute} cloudMock={cloudMock} />
      ) : route === 'home' ? (
        <Home machine={machine} boot={boot} navigate={setRoute} onOpenSession={openSession} />
      ) : route === 'session' ? (
        <SessionPage
          key={`session-${String(sessionSeed.seq)}`}
          machine={machine}
          boot={boot}
          initialText={sessionSeed.initialText}
          onExit={exitSession}
        />
      ) : route === 'map' ? (
        <MapPage machine={machine} onBack={() => setRoute('chat')} />
      ) : route === 'library' ? (
        <LibraryPage machine={machine} onBack={() => setRoute('chat')} />
      ) : route === 'profile' ? (
        <ProfilePage machine={machine} onBack={() => setRoute('chat')} />
      ) : (
        <GrowthPage machine={machine} onBack={() => setRoute('chat')} />
      )}
    </view>
  );
}
