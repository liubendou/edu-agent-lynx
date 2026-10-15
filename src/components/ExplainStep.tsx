/**
 * ExplainStep —— 标准/高质量：步骤序列，一步步走（四段式：概念→例子→反例→常见坑）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.ExplainStep。
 * current 由 Agent 侧推进（讲完即问、卡住即降难度，§10.1③）；当前步 accent 描边、
 * 已过步淡出 0.6，全部静态呈现不做位移动画（同屏并发动画 ≤2 条，UID §7.2 禁令3）。
 */
import type { ComponentPropsMap } from '../a2ui/catalog';

export type ExplainStepProps = ComponentPropsMap['ExplainStep'];

export function ExplainStep({ steps, current }: ExplainStepProps) {
  return (
    <view className="a2ui-card a2ui-grow">
      {steps.map((step, index) => {
        const state = index === current ? '--current' : index < current ? '--past' : '';
        return (
          <view key={`${index}-${step.title}`} className={`es-step${state}`}>
            <view>
              <text className="Text Text--body">{`${index + 1}. ${step.title}`}</text>
              <text className="Text Text--aux es-body" style={{ color: 'var(--ink-soft)' }}>
                {step.body}
              </text>
            </view>
          </view>
        );
      })}
    </view>
  );
}
