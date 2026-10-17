/**
 * 冒烟层：一条命令跑完前面各层，出退出码（electron-app-engineering §八 冒烟层 / §九）。
 *
 * 顺序固定、任一步失败即停把失败退出码传出（不产出半成品）：
 *   1) 静态规范校验（scripts/verify-static.mjs）
 *   2) 类型检查（tsc -b）
 *   3) 单元测试（rstest run）
 *   4) 打包构建（rspeedy build）
 *   5) 运行时断言（scripts/verify-runtime.mjs，Web 预览起服务 + HTTP 断言）
 *
 * 用法：npm run verify
 */
import { PROJECT_ROOT, createChecker, spawnNpm } from './lib/verify-utils.mjs';

const check = createChecker('冒烟');

/** 固定顺序；每步都是 package.json 里的入口（单一事实源：命令只写在 package.json）。 */
const STEPS = [
  ['静态规范校验', ['run', 'verify:static']],
  ['类型检查', ['run', 'typecheck']],
  ['单元测试', ['run', 'verify:unit']],
  ['打包构建', ['run', 'build']],
  ['运行时断言', ['run', 'verify:runtime']],
];

console.log(`冒烟：工程根 ${PROJECT_ROOT}`);
console.log(`冒烟：步骤 校验 → 类型 → 单元 → 打包 → 运行时（任一步失败即停）\n`);

let failed = null;
for (const [index, [title, args]] of STEPS.entries()) {
  console.log(`── 第 ${index + 1}/${STEPS.length} 步：${title}（npm ${args.join(' ')}）`);
  const code = await new Promise((done) => {
    const child = spawnNpm(args, { cwd: PROJECT_ROOT });
    child.on('exit', (c) => done(c ?? 1));
    child.on('error', () => done(1));
  });
  if (code !== 0) {
    failed = { title, code };
    break;
  }
  check.ok(`${title}（退出码 0）`);
}

if (failed !== null) {
  check.fail(`${failed.title} 失败（退出码 ${failed.code}），已停止后续步骤`);
  console.log(`\n[冒烟] 结果：失败于「${failed.title}」→ 退出码 ${failed.code}`);
  process.exit(failed.code === 0 ? 1 : failed.code);
}
check.ok(`全部 ${STEPS.length} 步通过`);
process.exit(check.report());
