# 03 Android 宿主工程报告（M0b）

> 产出时间：2026-10-15。作者：基础设施子智能体（M0b）。
> 范围：Android 构建链安装 + Lynx Android 宿主工程搭建 + 可安装 debug APK 产出。
> 事实依据：docs/ARCHITECTURE.md §1/§12、docs/01_环境与工具链报告.md §5、官方 demo `lynx-family/integrating-lynx-demo-projects@release/4.0`（KotlinEmptyProject）、官方 Native Modules 文档（lynxjs.org/guide/use-native-modules）。

## 1. 安装清单与版本

| 组件 | 版本 | 安装位置 / 来源 |
|---|---|---|
| Temurin JDK | 21.0.12.1+1 | ~/.local/jdk-21.0.12.1+1（清华 Adoptium 镜像 tar.gz，免 root） |
| Android cmdline-tools | 11076708 | ~/Android/Sdk/cmdline-tools/latest（腾讯镜像） |
| platform-tools | 37.0.1 | ~/Android/Sdk/platform-tools |
| Android Platform | android-34 (rev 3) | ~/Android/Sdk/platforms/android-34 |
| Build Tools | 34.0.0 | ~/Android/Sdk/build-tools/34.0.0 |
| Gradle | 8.7（wrapper 分发，腾讯镜像 URL） | 首次构建自动下载至 ~/.gradle |
| AGP / Kotlin | 8.5.0 / 1.9.0 | 同官方 demo |
| Lynx SDK | 4.1.0（primjs 4.1.1，servalsvg 0.0.2） | Maven Central `org.lynxsdk.lynx:*` |

**JDK 兼容处理**：系统默认 OpenJDK 25 无法运行 Gradle 8.7（最高支持 Java 21），且无 sudo。解法：从清华 Adoptium 镜像下载 Temurin 21 免 root 解压到 ~/.local，在 `android/gradle.properties` 中以 `org.gradle.java.home` 显式指定（该路径为本机特有配置，换机器构建时需同步修改或改用 JAVA_HOME）。

**环境变量**：`ANDROID_HOME=~/Android/Sdk`、`PATH` 追加 platform-tools（已写入 ~/.zshrc）。

**镜像策略**：Gradle 发行版走 `mirrors.cloud.tencent.com/gradle`；Maven 仓库在 settings.gradle.kts 配置阿里云（google/public/gradle-plugin 三仓）优先、google()+mavenCentral() 兜底。注意：阿里云镜像的 maven-metadata.xml 有滞后（曾显示 lynx-trace 无 4.1.0），但不影响精确版本解析（本次全量坐标已在 repo1.maven.org 官方源逐一核实存在）。

## 2. 宿主工程结构（edu-agent/android/）

```
android/
├── settings.gradle.kts          # 镜像仓库 + FAIL_ON_PROJECT_REPOS
├── build.gradle.kts             # 根：AGP 8.5.0 / Kotlin 1.9.0
├── gradle.properties            # org.gradle.java.home 指向 JDK 21
├── gradle/libs.versions.toml    # 版本目录
├── gradlew + gradle/wrapper/    # Gradle 8.7（腾讯镜像 URL）
├── local.properties            # sdk.dir（不入 git）
└── app/
    ├── build.gradle.kts        # com.eduagent.app / compileSdk 34 / minSdk 24 / targetSdk 34
    │                            #   Lynx 全套依赖 + copyBundle 任务（见 §3）
    └── src/main/
        ├── AndroidManifest.xml # INTERNET + ACCESS_NETWORK_STATE；Main/Debug 两 Activity
        ├── assets/             # 构建产物（copyBundle 拷入，.gitignore 忽略）
        ├── res/                 # 应用名"学习 Agent"、NoActionBar 主题、launcher 图标
        └── java/com/eduagent/app/
            ├── MainActivity.kt        # 全屏 LynxView 加载 assets/main.lynx.bundle
            ├── DebugActivity.kt       # DevTool OpenCard / 远程 bundle URL 调试入口
            ├── EduAgentApplication.kt # Fresco + 四服务注册 + LynxEnv 初始化 + StorageModule 注册
            ├── AssetTemplateProvider.kt # 从 assets 读 bundle
            └── modules/
                └── StorageModule.kt   # 本任务新增（ARCHITECTURE §12 方案 A）
```

与官方 demo 对齐处：MainActivity/Application/Provider/依赖清单照 KotlinEmptyProject（版本升至 4.1.0 线）；生命周期在 demo 基础上补齐（照 Lynx Explorer）：`onResume/onPause → lynxView.onEnterForeground()/onEnterBackground()`，`onDestroy → lynxView.destroy()`。返回键走 Activity 默认行为（官方 demo 同款，LynxView 无公开返回键 API）。

包名 `com.eduagent.app`（demo 为 com.lynx.kotlinemptyproject，无冲突）。

## 3. 构建命令链（可复现）

```bash
# 0. 前置（已写入 ~/.zshrc，非交互 shell 需手动 export）
export PATH="$HOME/.local/node-v22/bin:$PATH"
export ANDROID_HOME="$HOME/Android/Sdk"

# 1. 前端构建
cd /home/lbd/桌面/agent/edu-agent && npm run build          # → dist/main.lynx.bundle

# 2. Android 构建（copyBundle 已挂接 preBuild，自动把 dist/ 拷入 app/src/main/assets/）
cd android && ./gradlew assembleDebug

# 3. 产物
#    android/app/build/outputs/apk/debug/app-debug.apk

# 4. 真机安装
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

实测：首建 4m44s（含发行版+依赖下载，Lynx 依赖缓存 121MB）；增量复跑 830ms。APK 大小 187MB（debug 含 devtool 与 3 个 ABI 的 .so，属正常水平；后续 release + ABI splits 可显著缩减）。APK 内容已验证：`assets/main.lynx.bundle`（98,618B 与 dist 一致）、static 资源、arm64-v8a/armeabi-v7a/x86 原生库齐全。

真机验证：本机 adb 无设备连接，`adb install` 未执行（待有真机后按 §3 第 4 步验证）。

## 4. StorageModule 接口签名（JS 侧调用）

原生侧 `StorageModule.kt`：继承 `LynxModule`，`@LynxMethod` 暴露四个方法，落 SharedPreferences（`edu_agent_storage`）。注册：Application 中 `LynxEnv.inst().registerModule("StorageModule", StorageModule::class.java)`。JS 侧（后台线程）经全局 `NativeModules` 调用：

```ts
declare let NativeModules: {
  StorageModule: {
    setItem(key: string, value: string): void
    getItem(key: string, callback: (value: string | null) => void): void
    removeItem(key: string): void
    getAllKeys(callback: (keys: string[]) => void): void
  }
}

// 用法
NativeModules.StorageModule.setItem('k', JSON.stringify(v))
NativeModules.StorageModule.getItem('k', (v) => { /* v 为 string|null，JSON.parse 由调用方负责 */ })
```

说明：`setItem/removeItem` 为 fire-and-forget（apply 异步落盘）；如需写完成回传，可后续加可选 Callback 参数（@LynxMethod 支持重载）。JS 侧封装落点为 `src/storage/kv.ts`（M2 范围，本任务不动 src/）。命名按 V1 简单 KV 语义取 getItem/setItem/removeItem/getAllKeys；若仓库层需要集合批量接口（按 ARCHITECTURE §12 分集合 JSON），由 kv.ts 之上再加，不改原生签名。

## 5. 已知限制

1. **org.gradle.java.home 为本机绝对路径**：换机器/CI 需修改 android/gradle.properties 或改用 JAVA_HOME。
2. **debug APK 187MB**：devtool + 多 ABI 所致；release 构建 + `ndk.abiFilters`/splits 可优化，V1 不阻塞。
3. **未真机验证**：adb 无设备，安装与启动链路待真机回归（devtool 需真机同局域网）。
4. **assets 拷贝进源码树**：copyBundle 写 `app/src/main/assets/`（.gitignore 已忽略 bundle 与 static/）；dist 不存在时 Copy 任务静默跳过，构建出的 APK 会缺 bundle——务必先跑 `npm run build`。
5. **x86_64 ABI 缺失**：Lynx 4.1.0 AAR 未带 x86_64，模拟器需选 x86 或 arm64 镜像（arm64 真机无影响）。

## 6. 后续集成注意事项（SpeechModule 预留位）

- `modules/` 目录即原生模块落点：M6 的 `SpeechModule.kt`（sherpa-onnx TTS/ASR 桥）与 StorageModule 同模式——继承 LynxModule + @LynxMethod + LynxEnv 注册，无需新依赖链。
- DevTool 已启用（enableDevtool/enableLogBox/enableLynxDebug）：开发期扫码/输 URL 走 DebugActivity；发布版在 EduAgentApplication 关闭三个开关。
- 前端若启用 lazy bundle（`async/*.lynx.bundle`），AssetTemplateProvider 无需改动（按 uri 读 assets），copyBundle 已覆盖 async/ 目录拷入。
- SpeechModule 涉及 so 库时注意与 Lynx 现有 ABI（arm64-v8a/armeabi-v7a/x86）对齐，避免引入新 ABI 增包体。
- 下游若需 http 缓存/图片圆角等宿主能力，参考 Lynx 官方 service 列表扩展 LynxServiceCenter 注册，不自研。
