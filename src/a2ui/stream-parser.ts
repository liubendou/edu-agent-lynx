/**
 * stream-parser —— A2UI v0.9 JSONL 流式解析 → surface 增量状态（ARCHITECTURE §1/§10）。
 * M3 2026-10-15。T1 Spike 裁决：自研轻量 renderer（见下），协议形状仍以
 * CONTRACTS §5（A2UI v0.9 的 surfaceUpdate.components[] 投影）为唯一依据。
 *
 * Spike 结论（2026-10-15，@lynx-js/genui 0.6.0 实测其 dist 类型与 @a2ui/web_core
 * 0.10.6 源码）：genui 消费的是官方 v0.9 wire format——`version` + createSurface/
 * updateComponents/updateDataModel/deleteSurface 四类消息，组件节点为
 * `{component:"<Name>", id?, ...props}` 扁平形状、children 按 id 引用、props 需
 * dynamic value 包装（{literalString|path|call}），且 payloadNormalizer 不做
 * `surfaceUpdate.components[{id,name,props,children}]` 的转换；16 零件为领域组件
 * （非其通用原语 catalog），接入须 defineCatalog + 组件内嵌 GenericComponentProps/
 * useDataBinding/useAction 运行时，Action 形状（UserActionPayload）亦与 CONTRACTS
 * §5 A2UIAction 不符 → 按 ARCHITECTURE R1 预案回退：协议解析与渲染端自实现，
 * genui 不进 M3 依赖路径（包仍锁定，供 M7+ 再评估）。
 *
 * 容错设计（能容则容，不能容则明确报错）：
 *  - 分块到达：feed() 缓冲，按 \n 切行；残余半个 JSON 留在 buffer，绝不误解析；
 *  - 非法行（坏 JSON/形状错）：记入 errors 并跳过该行，后续行继续（不抛断整流）；
 *  - 机器行（{"tts":..}/{"tool_call":..}，orchestrator/ports.ts 约定）：跳过计数；
 *  - 同 id 组件再次到达：原位替换（更新语义），首次插入顺序稳定；
 *  - 未知组件名：保留节点（渲染端 fallback.tsx 降级纯文本，绝不白屏）；
 *  - 中途流中断：flush() 收尾——完整尾行照常吸收（无痕迹）；截断残片记
 *    "流中断"错误并丢弃，已完整组件仍可渲染（渐进渲染不整屏等待）。
 *
 * 线程模型：纯数据层（无 React/IO），跑后台线程（PRD §7.1：协议消息后台解析、
 * UI 更新主线程呈现）；A2UIStreamEmitter 适配 A2UiEmitterPort（emit/flush 同构）。
 */
import type { A2UiEmitterPort } from '../orchestrator/ports';

/** 流节点（CONTRACTS §5 A2UIComponentNode 的宽松形态：name 放开为 string 以承接 catalog 外名称） */
export interface A2UIStreamNode {
  id: string;
  name: string;
  props: Record<string, unknown>;
  children?: A2UIStreamNode[];
}

/** surface 快照（不可变；每次 getSnapshot 产出新对象，供 React setState） */
export interface A2UISurfaceSnapshot {
  surfaceId: string;
  /** 组件树根列表（首次插入序；同 id 更新原位替换） */
  components: A2UIStreamNode[];
  /** 已吸收的 surfaceUpdate 消息数（渲染层可据此做增量对比） */
  revision: number;
  /** 机器行跳过数（tts/tool_call） */
  skippedMachineLines: number;
  /** 解析/形状错误（容错继续；不为空即有丢弃内容） */
  errors: string[];
  /** 未成行残余字符数（>0 = 流被截断，内容不完整） */
  pendingChars: number;
}

/** 校验并规整一个组件节点（递归 children）；非法 → 返回 null 并记 error */
function normalizeNode(raw: unknown, errors: string[], path: string): A2UIStreamNode | null {
  if (typeof raw !== 'object' || raw === null) {
    errors.push(`${path}: 节点不是对象`);
    return null;
  }
  const node = raw as Record<string, unknown>;
  if (typeof node.id !== 'string' || node.id.length === 0) {
    errors.push(`${path}: 缺少合法 id`);
    return null;
  }
  if (typeof node.name !== 'string' || node.name.length === 0) {
    errors.push(`${path}:${node.id} 缺少合法 name`);
    return null;
  }
  if (typeof node.props !== 'object' || node.props === null || Array.isArray(node.props)) {
    errors.push(`${path}:${node.id} props 不是对象`);
    return null;
  }
  const normalized: A2UIStreamNode = {
    id: node.id,
    name: node.name,
    props: node.props as Record<string, unknown>,
  };
  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) {
      errors.push(`${path}:${node.id} children 不是数组（忽略 children）`);
    } else {
      const children = node.children
        .map((child, index) => normalizeNode(child, errors, `${path}:${node.id}.children[${index}]`))
        .filter((child): child is A2UIStreamNode => child !== null);
      normalized.children = children;
    }
  }
  return normalized;
}

export class A2UIStreamParser {
  private buffer = '';
  private readonly compMap = new Map<string, A2UIStreamNode>();
  private surfaceId = 'main';
  private revision = 0;
  private skippedMachineLines = 0;
  private readonly errors: string[] = [];
  private readonly listeners = new Set<() => void>();

  /** 流式喂数据（任意分块；按 \n 切行，残余留 buffer） */
  feed(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) this.ingestLine(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
    this.notify();
  }

  /**
   * 回合边界 flush（A2UiEmitterPort.flush 语义）：尾部残余行收尾——
   *  - 完整 JSON（生成端未补换行符的正常收尾）→ 照常吸收，无中断痕迹；
   *  - 解析失败的截断内容 → 记"流中断"错误并丢弃（半个 JSON 无法渲染，
   *    已完整组件照常渐进渲染，绝不因尾部残片阻塞整屏）。
   */
  flush(): void {
    const tail = this.buffer.trim();
    if (tail.length > 0) {
      let complete = false;
      try {
        complete = JSON.parse(tail) !== undefined;
      } catch {
        complete = false;
      }
      if (complete) {
        this.ingestLine(tail);
      } else {
        this.errors.push(`流中断：尾部 ${this.buffer.length} 字符无法解析为完整消息（已丢弃，不影响已完整组件渲染）：${tail.slice(0, 40)}`);
      }
    }
    this.buffer = '';
    this.notify();
  }

  /** 当前快照（不可变；数组/错误列表浅拷贝） */
  getSnapshot(): A2UISurfaceSnapshot {
    return {
      surfaceId: this.surfaceId,
      components: [...this.compMap.values()],
      revision: this.revision,
      skippedMachineLines: this.skippedMachineLines,
      errors: [...this.errors],
      pendingChars: this.buffer.length,
    };
  }

  /** 新回合/新会话清空（缓冲、组件树、错误全部复位） */
  reset(): void {
    this.buffer = '';
    this.compMap.clear();
    this.surfaceId = 'main';
    this.revision = 0;
    this.skippedMachineLines = 0;
    this.errors.length = 0;
    this.notify();
  }

  /** 订阅快照变化（React 侧 useEffect 订阅用；返回退订函数） */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 解析一行：机器行跳过 / surfaceUpdate 合并 / 其余记错（容错不断流） */
  private ingestLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.errors.push(`非法 JSONL 行（已跳过）：${line.slice(0, 80)}`);
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      this.errors.push(`消息不是 JSON 对象（已跳过）：${line.slice(0, 80)}`);
      return;
    }
    const message = parsed as Record<string, unknown>;
    // 机器级行内指令（cloud → orchestrator；非渲染消息）
    if (message.tts !== undefined || message.tool_call !== undefined) {
      this.skippedMachineLines += 1;
      return;
    }
    const update = message.surfaceUpdate;
    if (typeof update !== 'object' || update === null) {
      this.errors.push(`非 surfaceUpdate 消息（已跳过）：${line.slice(0, 80)}`);
      return;
    }
    const surface = update as Record<string, unknown>;
    if (!Array.isArray(surface.components)) {
      this.errors.push('surfaceUpdate.components 不是数组（已跳过该消息）');
      return;
    }
    if (typeof surface.surfaceId === 'string' && surface.surfaceId.length > 0) {
      this.surfaceId = surface.surfaceId; // V1 单 surface；异常 id 仍容错记录
    }
    for (let index = 0; index < surface.components.length; index += 1) {
      const node = normalizeNode(surface.components[index], this.errors, `components[${index}]`);
      if (node !== null) this.compMap.set(node.id, node); // 同 id → 原位替换（Map 保插入序）
    }
    this.revision += 1;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * A2UiEmitterPort 适配器：emit=feed、flush=flush（composition 根替换
 * BufferingA2UiEmitter 的落点，端口签名不动——ARCHITECTURE §3/ports.ts）。
 */
export class A2UIStreamEmitter implements A2UiEmitterPort {
  constructor(private readonly parser: A2UIStreamParser) {}

  emit(jsonlChunk: string): void {
    this.parser.feed(jsonlChunk);
  }

  flush(): void {
    this.parser.flush();
  }
}
