const { createApp, reactive, computed, onMounted } = Vue;

createApp({
  setup() {
    const state = reactive({
      wordBank: [defaultWord],
      currentIndex: 0,
      currentWord: defaultWord,
      settings: {
        enableReviewMode: true,
        enableRandomMode: false,
        recallMode: 'en2cn'
      },
      mastery: {},
      showImporter: false,
      showStats: false,
      importText: '',
      userInput: '',
      originalWordBank: [defaultWord],
      reviewFilter: null,
    });

    // 动态筛选单词
    const filteredWordBank = computed(() => {
      if (!state.reviewFilter) return state.wordBank;
      if (state.reviewFilter === 'unknown') return state.wordBank.filter(w => state.mastery[w.word] === 'unknown');
      if (state.reviewFilter === 'vague') return state.wordBank.filter(w => state.mastery[w.word] === 'vague');
      if (state.reviewFilter === 'both') return state.wordBank.filter(w => state.mastery[w.word] === 'unknown' || state.mastery[w.word] === 'vague');
      return state.wordBank;
    });

    const filteredTotal = computed(() => filteredWordBank.value.length);
    const filteredCurrentIndex = computed(() => {
      const idx = filteredWordBank.value.findIndex(w => w.word === state.currentWord.word);
      return idx === -1 ? 0 : idx;
    });
    const filteredCurrentNo = computed(() => filteredCurrentIndex.value + 1);

    // 统计
    const stats = computed(() => {
      const res = { known: 0, vague: 0, unknown: 0 };
      Object.values(state.mastery).forEach(v => {
        if (res[v] !== undefined) res[v]++;
      });
      return res;
    });

    // 输入判断
    const isTypingCorrect = computed(() => {
      const input = state.userInput.trim();
      if (!input) return false;
      if (state.settings.recallMode === 'cn2en') {
        const target = state.currentWord.word.toLowerCase().replace(/[^a-z]/g, '');
        const inputEn = input.toLowerCase().replace(/[^a-z]/g, '');
        return inputEn === target;
      }
      if (state.settings.recallMode === 'en2cn') {
        const meanings = state.currentWord.meaning.split(/[,;；，、\s]/).filter(i => i.trim());
        return meanings.some(m => input.includes(m.trim()) || m.trim().includes(input));
      }
      return false;
    });

    // 存储
    const save = () => {
      localStorage.setItem('bec_v5_final', JSON.stringify({
        index: state.currentIndex,
        mastery: state.mastery,
        bank: state.originalWordBank,
        randomMode: state.settings.enableRandomMode,
        recallMode: state.settings.recallMode
      }));
    };

    // 切换模式
    const toggleRandomMode = () => {
      state.settings.enableRandomMode = !state.settings.enableRandomMode;
      state.wordBank = state.settings.enableRandomMode
        ? shuffleArray([...state.originalWordBank])
        : [...state.originalWordBank];
      state.currentIndex = 0;
      state.reviewFilter = null;
      state.currentWord = state.wordBank[0];
      save();
    };

    const toggleRecallMode = () => {
      if (state.settings.recallMode === 'all') state.settings.recallMode = 'en2cn';
      else if (state.settings.recallMode === 'en2cn') state.settings.recallMode = 'cn2en';
      else state.settings.recallMode = 'all';
      state.userInput = '';
      save();
    };

    // 翻页逻辑
    const findNextFilteredIndex = (step = 1) => {
      const list = filteredWordBank.value;
      const total = list.length;
      if (total === 0) return state.currentIndex;
      let cur = filteredCurrentIndex.value;
      for (let i = 0; i < total; i++) {
        cur = (cur + step + total) % total;
        const target = list[cur];
        const globalIdx = state.wordBank.findIndex(w => w.word === target.word);
        if (globalIdx !== -1) return globalIdx;
      }
      return state.currentIndex;
    };

    const jump = (i) => {
      state.currentIndex = Math.max(0, Math.min(i, state.wordBank.length - 1));
      state.currentWord = state.wordBank[state.currentIndex];
      state.settings.enableReviewMode = true;
      state.userInput = '';
      save();
    };

    const next = () => state.reviewFilter ? jump(findNextFilteredIndex(1)) : (state.settings.enableRandomMode ? jump(Math.floor(Math.random() * state.wordBank.length)) : jump(state.currentIndex + 1));
    const prev = () => state.reviewFilter ? jump(findNextFilteredIndex(-1)) : jump(state.currentIndex - 1);
    const mark = (s) => { state.mastery[state.currentWord.word] = s; next(); save(); };

    // 复习
    const openStatsAndReview = () => state.showStats = true;
    const reviewWeak = () => { state.reviewFilter = 'both'; jump(findNextFilteredIndex()); state.showStats = false; };
    const reviewOnlyUnknown = () => { state.reviewFilter = 'unknown'; jump(findNextFilteredIndex()); state.showStats = false; };
    const reviewOnlyVague = () => { state.reviewFilter = 'vague'; jump(findNextFilteredIndex()); state.showStats = false; };

    // 导入
    const processImportData = (content) => {
      try {
        const data = JSON.parse(content.trim());
        const words = Array.isArray(data) ? data : data.bank;
        if (words.length) {
          state.originalWordBank = words;
          state.wordBank = data.randomMode ? shuffleArray([...words]) : [...words];
          state.currentIndex = data.index || 0;
          state.mastery = data.mastery || {};
          state.settings.enableRandomMode = data.randomMode || false;
          state.settings.recallMode = data.recallMode || 'en2cn';
          state.reviewFilter = null;
          state.currentWord = state.wordBank[state.currentIndex];
          state.showImporter = false;
          alert("导入成功");
          save();
        }
      } catch (e) { alert("失败：" + e.message); }
    };

    const handleFileUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => processImportData(ev.target.result);
      reader.readAsText(file);
    };

    // 导出
    const exportData = () => {
      const data = JSON.stringify({
        index: state.currentIndex, mastery: state.mastery,
        bank: state.originalWordBank, randomMode: state.settings.enableRandomMode, recallMode: state.settings.recallMode
      }, null, 2);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'BEC单词备份.json';
      a.click();
    };

    // 键盘
    onMounted(() => {
      const data = localStorage.getItem('bec_v5_final');
      if (data) {
        const p = JSON.parse(data);
        state.originalWordBank = p.bank || [defaultWord];
        state.settings.enableRandomMode = p.randomMode || false;
        state.settings.recallMode = p.recallMode || 'en2cn';
        state.wordBank = state.settings.enableRandomMode ? shuffleArray([...state.originalWordBank]) : [...state.originalWordBank];
        state.currentIndex = p.index || 0;
        state.mastery = p.mastery || {};
        state.currentWord = state.wordBank[Math.min(state.currentIndex, state.wordBank.length - 1)];
      }

      document.addEventListener('keydown', (e) => {
        if (state.showImporter || state.showStats) return;
        const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

        if (e.code === 'Space') {
          e.preventDefault();
          if (!isInput) state.settings.enableReviewMode = !state.settings.enableReviewMode;
          return;
        }
        if (e.code === 'ArrowRight') { e.preventDefault(); next(); return; }
        if (e.code === 'ArrowLeft') { e.preventDefault(); prev(); return; }
        if (isInput) return;
        if (e.key === 'Enter' && isTypingCorrect.value) { e.preventDefault(); mark('known'); return; }
        if (e.key.toLowerCase() === 'r') { toggleRandomMode(); return; }
        if (e.key.toLowerCase() === 'm') { toggleRecallMode(); return; }
        if (e.key === '1') { mark('unknown'); return; }
        if (e.key === '2') { mark('vague'); return; }
        if (e.key === '3') { mark('known'); return; }
      });
    });

    return {
      state, stats, filteredCurrentNo, filteredTotal,
      isTypingCorrect, toggleRandomMode, toggleRecallMode,
      next, prev, mark, jump, openStatsAndReview,
      reviewWeak, reviewOnlyUnknown, reviewOnlyVague,
      handleFileUpload, exportData, handleImport: () => processImportData(state.importText), playAudio
    };
  }
}).mount('#app');