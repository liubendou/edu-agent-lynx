/**
 * 技能包只读源目录定位（跨机器可移植，单一事实源）。
 *
 * 背景：原实现把源目录硬编码为 Linux 绝对路径 '/home/lbd/桌面/agent/skill'，
 * 工程搬到 Windows（d:\agent\edu-agent）后 6 个保真测试全部 ENOENT。
 * 现改为三级定位，顺序如下：
 *   1) 环境变量 EDU_SKILL_ROOT（CI / 换机时可显式指定）
 *   2) 从当前工作目录逐级向上找 skill/quick-learning/SKILL.md（默认命中 d:\agent\skill）
 *   3) 兜底：取当前工作目录的兄弟目录 skill/
 *
 * 只导出常量，不导出函数——调用方拿到的就是唯一确定的根目录。
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** 定位判据：该文件存在即认为是合法的 skill/ 源目录。 */
const MARKER = 'quick-learning/SKILL.md';

function locateSkillRoot(): string {
  const env = process.env['EDU_SKILL_ROOT'];
  if (env !== undefined && env.trim() !== '') return env.trim();

  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(dir, 'skill');
    if (existsSync(resolve(candidate, MARKER))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), '..', 'skill');
}

/** 只读事实源根目录：skill/（内含 quick-learning / review / standard-learning / deep-learning / score-boost）。 */
export const SKILL_SRC_ROOT = locateSkillRoot();
