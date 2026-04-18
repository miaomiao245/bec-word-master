/** 相对路径 fetch 防缓存（Cloudflare Pages 等） */
const cacheBustUrl = (url) => {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${Date.now()}`;
};

/**
 * 将 manifest / URL 中的 day 规范为两位数字符串（如 01、12），用于 day05.json
 * 支持 "05"、5、"day05" 等
 */
const normalizeDayCode = (raw) => {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim().replace(/^day/i, '').replace(/\.json$/i, '');
  const n = parseInt(s, 10);
  if (Number.isNaN(n) || n < 1) return '';
  return String(n).padStart(2, '0');
};

/** 与资源路径一致：./data/day${code}.json */
const dayJsonRelativePath = (rawDay) => {
  const code = normalizeDayCode(rawDay);
  if (!code) return '';
  return `./data/day${code}.json`;
};

/** 下拉等 UI：Day 01 */
const formatDayLabel = (rawDay) => {
  const code = normalizeDayCode(rawDay);
  return code ? `Day ${code}` : String(rawDay ?? '');
};

/** 由 day 文件名与下标生成稳定 id，如 day01.json + 0 -> d01_01 */
const wordIdFromDayFile = (dayFile, index0) => {
  const base = dayFile.replace(/\.json$/i, '');
  const m = base.match(/(\d+)/);
  const dayNum = m ? m[1] : '1';
  const dPre = 'd' + String(parseInt(dayNum, 10)).padStart(2, '0');
  return `${dPre}_${String(index0 + 1).padStart(2, '0')}`;
};

/** 为导入/无 id 的词库补全 _id */
const assignImportWordIds = (words) => {
  return words.map((w, i) => ({
    ...w,
    _id: w.id || w._id || `imp_${String(i + 1).padStart(4, '0')}`,
  }));
};

/** 解析单日 JSON（数组或 { words: [] }）并写入 _id */
const normalizeWordsFromDay = (rawJson, dayFile) => {
  const list = Array.isArray(rawJson) ? rawJson : (rawJson.words || []);
  return list.map((w, i) => ({
    ...w,
    _id: w.id || w._id || wordIdFromDayFile(dayFile, i),
  }));
};

// 随机打乱数组
const shuffleArray = (array) => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

// 默认单词
const defaultWord = {
  word: "Start",
  phonetic: "/stɑːrt/",
  pos: "v.",
  meaning: "开始",
  mod1_desc: "BEC 场景中常用于项目启动。",
  mod2_desc: "底层逻辑：阶段性切换。",
  mod3_word: "Commence",
  mod3_meaning: "开始；着手",
  mod4_en: "We will start the project.",
  mod4_zh: "我们将启动项目。",
  mod4_core: "意图：确认时间。"
};

// 播放发音
const playAudio = (word, type) => {
  const url = `https://dict.youdao.com/dictvoice?type=${type}&audio=${encodeURIComponent(word)}`;
  new Audio(url).play();
};