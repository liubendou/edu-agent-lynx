// M2c 云侧配置测试：本地配置文件读取、无 Key 自动 Mock、.gitignore 生效。
import { describe, expect, test } from '@rstest/core';
import {
  CLOUD_GLOBAL_INJECTION_KEY,
  MODEL_FLASH,
  MODEL_PRO,
  loadCloudConfig,
  parseCloudLocalFile,
  resolveCloudConfig,
} from '../cloud';

describe('cloud-config: 本地配置读取与 Mock 判定', () => {
  test('文件缺失 → 自动 Mock（D7：无 Key 全链路可开发可测）', async () => {
    const config = await loadCloudConfig({ read: () => null });
    expect(config.mock).toBe(true);
    expect(config.source).toBe('none');
    expect(config.apiKey).toBe('');
  });

  test('apiKey 为空/缺失 → Mock；有 Key → 非 Mock 且默认值齐备', () => {
    const emptyKey = resolveCloudConfig(parseCloudLocalFile('{"apiKey":""}'), 'file');
    expect(emptyKey.mock).toBe(true);
    expect(emptyKey.source).toBe('file');

    const missingKey = resolveCloudConfig(parseCloudLocalFile('{"baseUrl":"https://x/v1"}'), 'file');
    expect(missingKey.mock).toBe(true);

    const withKey = resolveCloudConfig(parseCloudLocalFile('{"apiKey":"sk-test","baseUrl":"https://api.test/v1"}'), 'file');
    expect(withKey.mock).toBe(false);
    expect(withKey.baseUrl).toBe('https://api.test/v1');
    expect(withKey.modelFlash).toBe(MODEL_FLASH);
    expect(withKey.modelPro).toBe(MODEL_PRO);
  });

  test('默认 baseUrl/模型名回退 + 非法 JSON 容错', async () => {
    const defaults = resolveCloudConfig(parseCloudLocalFile('{"apiKey":"sk-x"}'), 'file');
    expect(defaults.baseUrl).toBe('https://api.deepseek.com/v1');

    const broken = await loadCloudConfig({ read: () => '{not json' });
    expect(broken.mock).toBe(true);
    expect(broken.source).toBe('none');
  });

  test('globalThis 宿主注入优先于文件', async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = g[CLOUD_GLOBAL_INJECTION_KEY];
    g[CLOUD_GLOBAL_INJECTION_KEY] = { apiKey: 'sk-injected', baseUrl: 'https://injected/v1' };
    try {
      const config = await loadCloudConfig({ read: () => null });
      expect(config.mock).toBe(false);
      expect(config.source).toBe('global');
      expect(config.baseUrl).toBe('https://injected/v1');
    } finally {
      if (saved === undefined) delete g[CLOUD_GLOBAL_INJECTION_KEY];
      else g[CLOUD_GLOBAL_INJECTION_KEY] = saved;
    }
  });

  test('.gitignore 忽略 cloud.local.json 且模板 cloud.local.example.json 可用', async () => {
    // 经 Function 构造的动态 import 引 node:fs（与 config.ts 同法，不打进产物）
    const dynamicImport = new Function('p', 'return import(p)') as (p: string) => Promise<{
      readFileSync: (p: string, enc: string) => string;
      existsSync: (p: string) => boolean;
    }>;
    const fs = await dynamicImport('node:fs');
    const gitignore = fs.readFileSync('.gitignore', 'utf-8');
    expect(gitignore).toContain('cloud.local.json');

    expect(fs.existsSync('cloud.local.example.json')).toBe(true);
    const template = JSON.parse(fs.readFileSync('cloud.local.example.json', 'utf-8')) as { apiKey?: string };
    expect(template.apiKey).toBe(''); // 模板不含真实 Key
  });
});
