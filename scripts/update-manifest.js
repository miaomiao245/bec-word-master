#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const dataDir = path.join(repoRoot, 'data');
const manifestPath = path.join(dataDir, 'manifest.json');

const DAY_FILE_RE = /^day(\d+)\.json$/i;

const normalizeDayCode = (raw) => {
  const n = Number.parseInt(String(raw), 10);
  if (Number.isNaN(n) || n < 1) return '';
  return String(n).padStart(2, '0');
};

const buildManifest = () => {
  if (!fs.existsSync(dataDir)) {
    throw new Error(`data 目录不存在：${dataDir}`);
  }

  const files = fs.readdirSync(dataDir, { withFileTypes: true });
  const days = files
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .map((name) => {
      const m = name.match(DAY_FILE_RE);
      return m ? normalizeDayCode(m[1]) : '';
    })
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));

  return { days };
};

const writeManifest = (manifest) => {
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(manifestPath, content, 'utf8');
};

const main = () => {
  try {
    // 👇 1. 先读取旧的 manifest（如果存在）
    let oldDays = [];
    if (fs.existsSync(manifestPath)) {
      const oldData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      oldDays = oldData.days || [];
    }

    // 👇 2. 生成新的
    const manifest = buildManifest();

    // 👇 3. 写入文件
    writeManifest(manifest);

    // 👇 4. 对比新增的
    const newDays = manifest.days.filter(day => !oldDays.includes(day));

    console.log(`manifest 已更新：${manifest.days.join(', ') || '(空)'}`);

    if (newDays.length > 0) {
      console.log(`✅ 新增：${newDays.join(', ')}`);
    } else {
      console.log(`ℹ️ 没有新增 day`);
    }

  } catch (err) {
    console.error(`更新 manifest 失败：${err.message}`);
    process.exit(1);
  }
};

main();
