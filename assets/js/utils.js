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