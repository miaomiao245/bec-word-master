const { createApp, reactive, computed, onMounted, nextTick } = Vue;

const LS_TOKEN = 'github_token';
const LS_GIST = 'gist_id';
const LS_GUEST = 'bec_cloud_guest';
const LS_LOCAL_MODE_LOCK = 'bec_local_mode_lock';
const LS_CLOUD_MODE_LOCK = 'bec_cloud_mode_lock';
const SS_WAS_GUEST = 'bec_was_guest';
const LS_APP = 'bec_v5_final';

const readToken = () => localStorage.getItem(LS_TOKEN) || '';
const readGistId = () => localStorage.getItem(LS_GIST) || '';

const masteryKeyOfWord = (w) => {
  if (!w) return '';
  return w._id || w.word || '';
};

const readWordStatus = (mastery, w) => {
  if (!mastery || !w) return '';
  const idKey = w._id || '';
  if (idKey && mastery[idKey]) return mastery[idKey];
  const wordKey = w.word || '';
  if (wordKey && mastery[wordKey]) return mastery[wordKey];
  return '';
};

const hasCloudCreds = () => !!(readToken() && readGistId());
const isCloudGuest = () => localStorage.getItem(LS_GUEST) === '1';

const isCloudConnected = () => hasCloudCreds() && !isCloudGuest();

const gistHeaders = () => {
  const token = readToken();
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
};

const parseProgressJson = (text) => {
  try {
    const o = JSON.parse(text || '{}');
    
    // 新格式：word_status 对象
    if (o.word_status && typeof o.word_status === 'object') {
      return {
        word_status: o.word_status,
        last_updated: o.last_updated || new Date().toISOString(),
      };
    }
    
    // 向下兼容：旧格式 mastered_ids 转换为 word_status（所有 ID 标记为 known）
    if (Array.isArray(o.mastered_ids)) {
      const word_status = {};
      o.mastered_ids.filter(Boolean).forEach((id) => {
        word_status[id] = 'known';
      });
      return {
        word_status,
        last_updated: o.last_updated || new Date().toISOString(),
      };
    }
    
    return {
      word_status: {},
      last_updated: new Date().toISOString(),
    };
  } catch {
    return {
      word_status: {},
      last_updated: new Date().toISOString(),
    };
  }
};

const fetchGistProgressRemote = async () => {
  const gistId = readGistId();
  const token = readToken();
  if (!gistId || !token) return { word_status: {}, last_updated: null };
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`Gist GET ${res.status}`);
  const data = await res.json();
  const file = data.files && (data.files['progress.json'] || data.files['Progress.json']);
  if (!file || !file.content) return { word_status: {}, last_updated: null };
  return parseProgressJson(file.content);
};

const patchGistProgressRemote = async (word_status) => {
  const gistId = readGistId();
  const token = readToken();
  if (!gistId || !token) return;
  const body = {
    word_status: word_status || {},
    last_updated: new Date().toISOString(),
  };
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: gistHeaders(),
    body: JSON.stringify({
      files: {
        'progress.json': {
          content: JSON.stringify(body, null, 2),
        },
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gist PATCH ${res.status}: ${err}`);
  }
};

const mergeLocalProgressToGist = async () => {
  const remote = await fetchGistProgressRemote();
  const remoteStatus = remote.word_status || {};
  
  // 生成本地 word_status（在 _stateRef 可用时）
  const localStatus = {};
  if (_stateRef) {
    const bank = _stateRef.originalWordBank || [];
    const mastery = _stateRef.mastery || {};
    bank.forEach((w) => {
      if (w._id) {
        const s = readWordStatus(mastery, w);
        if (s) localStatus[w._id] = s;
      }
    });
  }
  
  // 合并：云端优先，本地补充
  const merged = {};
  Object.assign(merged, remoteStatus);
  Object.assign(merged, localStatus);
  
  await patchGistProgressRemote(merged);
};

/** 从当前 reactive state 读取（登录流程在 reload 前调用） */
let _stateRef = null;
const readLocalMasteredIdsFromState = () => {
  if (!_stateRef) return [];
  const ids = new Set(_stateRef.mastered_ids || []);
  const bank = _stateRef.originalWordBank || [];
  const mastery = _stateRef.mastery || {};
  bank.forEach((w) => {
    if (w._id && readWordStatus(mastery, w) === 'known') ids.add(w._id);
  });
  return [...ids];
};

createApp({
  setup() {
    const initialBank = assignImportWordIds([defaultWord]);
    const state = reactive({
      wordBank: [...initialBank],
      currentIndex: 0,
      currentWord: initialBank[0],
      settings: {
        enableReviewMode: true,
        enableRandomMode: false,
        recallMode: 'en2cn',
      },
      mastery: {},
      mastered_ids: [],
      showImporter: false,
      showStats: false,
      importText: '',
      userInput: '',
      originalWordBank: [...initialBank],
      reviewFilter: null,
      transitionName: 'slide-left',
      currentWordIndex: 0,
      authForm: { token: '', gistId: '' },
      manifestDays: [],
      selectedDayFile: '',
      dataLoadMessage: '',
      dataLoadBusy: false,
      showSyncDrawer: false,
      showSettingsMenu: false,
      localModeLocked: false,
      cloudModeLocked: false,
      showAllWordInfo: false,
      syncInProgress: false,
    });

    _stateRef = state;

    const gistIdSuffix = computed(() => {
      const id = readGistId();
      return id.length >= 4 ? id.slice(-4) : id || '----';
    });

    const canDismissAuthOverlay = computed(() => hasCloudCreds() || isCloudGuest());
    const cloudModeActive = computed(() => isCloudConnected());
    const localModeActive = computed(() => !cloudModeActive.value && (isCloudGuest() || state.localModeLocked));
    const isCloudLocked = computed(() => state.cloudModeLocked);
    const isLocalLocked = computed(() => state.localModeLocked);
    const canUseCloudLogin = computed(() => !isLocalLocked.value);
    const canUseLocalManual = computed(() => !isCloudLocked.value);

    const closeSyncDrawer = () => {
      state.showSyncDrawer = false;
    };

    const openSyncDrawer = () => {
      state.showSyncDrawer = true;
      state.showSettingsMenu = false;
      state.authForm.token = readToken();
      state.authForm.gistId = readGistId();
    };

    const closeSettingsMenu = () => {
      state.showSettingsMenu = false;
    };

    let panelTouchStartX = 0;

    const handlePanelTouchStart = (e) => {
      panelTouchStartX = e.touches[0].clientX;
    };

    const handlePanelTouchEnd = (panelType) => {
      return (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const deltaX = touchEndX - panelTouchStartX;
        const minSwipeDistance = 50; // 最小滑动距离
        
        // 从左往右滑动超过阈值，关闭面板
        if (deltaX > minSwipeDistance) {
          if (panelType === 'settings') {
            closeSettingsMenu();
          } else if (panelType === 'sync') {
            closeSyncDrawer();
          }
        }
      };
    };

    const unlockModes = () => {
      if (confirm('解除锁定后，你可以重新选择另一种模式。\n你的学习进度不会被删除，已保存的数据会保留。')) {
        state.localModeLocked = false;
        state.cloudModeLocked = false;
        localStorage.removeItem(LS_LOCAL_MODE_LOCK);
        localStorage.removeItem(LS_CLOUD_MODE_LOCK);
      }
    };

    const toggleShowAllWordInfo = () => {
      state.showAllWordInfo = !state.showAllWordInfo;
    };

    const getWordStatus = (w) => readWordStatus(state.mastery, w);

    const isWordMasteredHighlight = (w) => w && w._id && state.mastered_ids.includes(w._id);

    const filteredWordBank = computed(() => {
      if (!state.reviewFilter) return state.wordBank;
      if (state.reviewFilter === 'unknown') return state.wordBank.filter((w) => getWordStatus(w) === 'unknown');
      if (state.reviewFilter === 'vague') return state.wordBank.filter((w) => getWordStatus(w) === 'vague');
      if (state.reviewFilter === 'both') return state.wordBank.filter((w) => getWordStatus(w) === 'unknown' || getWordStatus(w) === 'vague');
      return state.wordBank;
    });

    const filteredTotal = computed(() => filteredWordBank.value.length);
    const filteredCurrentIndex = computed(() => {
      const currentKey = masteryKeyOfWord(state.currentWord);
      const idx = filteredWordBank.value.findIndex((w) => masteryKeyOfWord(w) === currentKey);
      return idx === -1 ? 0 : idx;
    });
    const filteredCurrentNo = computed(() => filteredCurrentIndex.value + 1);

    const getCurrentBankStats = () => {
      const res = { known: 0, vague: 0, unknown: 0 };
      state.wordBank.forEach((w) => {
        const s = getWordStatus(w);
        if (res[s] !== undefined) res[s]++;
      });
      return res;
    };

    const stats = computed(() => {
      return getCurrentBankStats();
    });

    const isTypingCorrect = computed(() => {
      const input = state.userInput.trim();
      if (!input) return false;
      if (state.settings.recallMode === 'cn2en') {
        const target = state.currentWord.word.toLowerCase().replace(/[^a-z]/g, '');
        const inputEn = input.toLowerCase().replace(/[^a-z]/g, '');
        return inputEn === target;
      }
      if (state.settings.recallMode === 'en2cn') {
        const meanings = state.currentWord.meaning.split(/[,;；，、\s]/).filter((i) => i.trim());
        return meanings.some((m) => input.includes(m.trim()) || m.trim().includes(input));
      }
      return false;
    });

    const save = () => {
      localStorage.setItem(
        LS_APP,
        JSON.stringify({
          index: state.currentIndex,
          mastery: state.mastery,
          bank: state.originalWordBank,
          randomMode: state.settings.enableRandomMode,
          recallMode: state.settings.recallMode,
          mastered_ids: state.mastered_ids,
        }),
      );
    };

    const syncMasteredIdsFromMastery = () => {
      const set = new Set();
      state.originalWordBank.forEach((w) => {
        if (w._id && getWordStatus(w) === 'known') set.add(w._id);
      });
      state.mastered_ids = [...set];
    };

    // 生成当前的 word_status 对象（包含所有状态：known、vague、unknown）
    const generateWordStatus = () => {
      const status = {};
      state.originalWordBank.forEach((w) => {
        if (w._id) {
          const s = getWordStatus(w);
          if (s) status[w._id] = s;
        }
      });
      return status;
    };

    const pushGistProgress = async () => {
      if (!isCloudConnected()) return;
      try {
        // 生成当前的 word_status
        const localStatus = generateWordStatus();
        
        // 先读取云端已有的进度
        const remote = await fetchGistProgressRemote();
        const remoteStatus = remote.word_status || {};
        
        // 合并：取并集，云端优先（云端如果有该 ID 就用云端的状态）
        const merged = {};
        Object.assign(merged, remoteStatus);
        // 再加入本地状态（如果云端没有该 ID 就用本地的）
        Object.entries(localStatus).forEach(([id, status]) => {
          if (!merged[id]) {
            merged[id] = status;
          }
        });
        
        // 统一时间戳并上传合并后的数据
        await patchGistProgressRemote(merged);
      } catch (e) {
        console.error('Gist 同步失败', e);
      }
    };

    const toggleRandomMode = () => {
      state.settings.enableRandomMode = !state.settings.enableRandomMode;
      state.wordBank = state.settings.enableRandomMode ? shuffleArray([...state.originalWordBank]) : [...state.originalWordBank];
      state.currentIndex = 0;
      state.currentWordIndex = 0;
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

    const findNextFilteredIndex = (step = 1) => {
      const list = filteredWordBank.value;
      const total = list.length;
      if (total === 0) return state.currentIndex;
      let cur = filteredCurrentIndex.value;
      for (let i = 0; i < total; i++) {
        cur = (cur + step + total) % total;
        const target = list[cur];
        const targetKey = masteryKeyOfWord(target);
        const globalIdx = state.wordBank.findIndex((w) => masteryKeyOfWord(w) === targetKey);
        if (globalIdx !== -1) return globalIdx;
      }
      return state.currentIndex;
    };

    const jump = (i) => {
      state.currentIndex = Math.max(0, Math.min(i, state.wordBank.length - 1));
      state.currentWord = state.wordBank[state.currentIndex];
      state.currentWordIndex = state.currentIndex;
      state.settings.enableReviewMode = true;
      state.userInput = '';
      state.showAllWordInfo = false;
      save();
    };

    const nextWord = () => {
      state.transitionName = 'slide-left';
      state.reviewFilter
        ? jump(findNextFilteredIndex(1))
        : state.settings.enableRandomMode
          ? jump(Math.floor(Math.random() * state.wordBank.length))
          : jump(state.currentIndex + 1);
    };
    const prevWord = () => {
      state.transitionName = 'slide-right';
      state.reviewFilter ? jump(findNextFilteredIndex(-1)) : jump(state.currentIndex - 1);
    };

    const applyMasteryLevel = (s) => {
      const key = masteryKeyOfWord(state.currentWord);
      if (key) state.mastery[key] = s;
      const wid = state.currentWord._id;
      if (wid) {
        if (s === 'known') {
          if (!state.mastered_ids.includes(wid)) state.mastered_ids.push(wid);
        } else {
          const ix = state.mastered_ids.indexOf(wid);
          if (ix !== -1) state.mastered_ids.splice(ix, 1);
        }
      }
      save();
      pushGistProgress();
    };

    const mark = (s) => {
      applyMasteryLevel(s);
      nextWord();
    };

    const handleTouch = (start, end) => {
      if (state.showImporter || state.showStats || state.showSyncDrawer || state.showSettingsMenu) return;
      const threshold = 50;
      const diff = start - end;
      if (Math.abs(diff) > threshold) {
        if (diff > 0) nextWord();
        else prevWord();
      }
    };

    let touchStartX = 0;
    let touchGestureFromCard = false;

    const openStatsAndReview = () => (state.showStats = true);
    const reviewWeak = () => {
      state.reviewFilter = 'both';
      jump(findNextFilteredIndex());
      state.showStats = false;
    };
    const reviewOnlyUnknown = () => {
      state.reviewFilter = 'unknown';
      jump(findNextFilteredIndex());
      state.showStats = false;
    };
    const reviewOnlyVague = () => {
      state.reviewFilter = 'vague';
      jump(findNextFilteredIndex());
      state.showStats = false;
    };

    const applyWordBank = (words, options = {}) => {
      const { shuffle = false } = options;
      const list = assignImportWordIds(words);
      state.originalWordBank = list;
      state.settings.enableRandomMode = !!shuffle;
      state.wordBank = shuffle ? shuffleArray([...list]) : [...list];
      state.currentIndex = 0;
      state.currentWordIndex = 0;
      state.reviewFilter = null;
      state.currentWord = state.wordBank[0];
      save();
    };

    const fetchManifest = async (silent = false) => {
      try {
        const res = await fetch(cacheBustUrl('./data/manifest.json'));
        if (!res.ok) throw new Error(`manifest ${res.status}`);
        const json = await res.json();
        const rawDays = Array.isArray(json.days) ? json.days : json.files || [];
        const days = rawDays.map((d) => normalizeDayCode(d)).filter(Boolean);
        state.manifestDays = days;
        if (days.length && !state.selectedDayFile) state.selectedDayFile = days[0];
      } catch (e) {
        console.warn(e);
        if (!silent) alert('读取 manifest 失败：' + e.message);
      }
    };

    /** 拉取并应用某日词库；fromUrl=true 且 404 时使用友好提示 */
    const loadDayJsonByCode = async (rawDay, options = {}) => {
      const { fromUrl = false } = options;
      const code = normalizeDayCode(rawDay);
      if (!code) {
        alert('无效的 Day 编号');
        return false;
      }
      const path = dayJsonRelativePath(code);
      state.dataLoadBusy = true;
      state.dataLoadMessage = '';
      try {
        const res = await fetch(cacheBustUrl(path));
        if (res.status === 404) {
          if (fromUrl) {
            alert(`Day ${code} 的 JSON 文件尚未上传至仓库`);
          } else {
            alert(`未找到文件：day${code}.json`);
          }
          return false;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        const fileLabel = `day${code}.json`;
        const words = normalizeWordsFromDay(raw, fileLabel);
        if (!words.length) throw new Error('该日文件无单词');
        applyWordBank(words, { shuffle: state.settings.enableRandomMode });
        state.selectedDayFile = code;
        if (!state.manifestDays.includes(code)) {
          state.manifestDays = [code, ...state.manifestDays];
        }
        state.dataLoadMessage = `已加载 ${formatDayLabel(code)}，共 ${words.length} 词`;
        return true;
      } catch (e) {
        state.dataLoadMessage = '';
        alert('加载失败：' + e.message);
        return false;
      } finally {
        state.dataLoadBusy = false;
      }
    };

    const loadSelectedDay = async () => {
      const code = state.selectedDayFile;
      if (!code) {
        alert('请先在 manifest 中配置推荐 days，或使用 ?day= 参数');
        return;
      }
      await loadDayJsonByCode(code, { fromUrl: false });
    };

    const loadAllFromManifest = async () => {
      state.dataLoadBusy = true;
      state.dataLoadMessage = '';
      try {
        if (!state.manifestDays.length) await fetchManifest(true);
        const days = state.manifestDays;
        if (!days.length) throw new Error('manifest 中暂无推荐 day 列表');
        const results = await Promise.all(
          days.map((code) => {
            const path = dayJsonRelativePath(code);
            return fetch(cacheBustUrl(path)).then((r) => {
              if (!r.ok) throw new Error(`day${normalizeDayCode(code)}.json ${r.status}`);
              return r.json();
            });
          }),
        );
        const merged = [];
        days.forEach((code, idx) => {
          const fileLabel = `day${normalizeDayCode(code)}.json`;
          const chunk = normalizeWordsFromDay(results[idx], fileLabel);
          merged.push(...chunk);
        });
        if (!merged.length) throw new Error('合并后无单词');
        applyWordBank(merged, { shuffle: true });
        state.settings.enableRandomMode = true;
        save();
        state.dataLoadMessage = `已全部合并 ${merged.length} 词（已乱序）`;
      } catch (e) {
        state.dataLoadMessage = '';
        alert('全部加载失败：' + e.message);
      } finally {
        state.dataLoadBusy = false;
      }
    };

    const tryLoadFromUrlDayParam = async () => {
      let dayParam = null;
      try {
        dayParam = new URLSearchParams(window.location.search).get('day');
      } catch {
        return;
      }
      if (dayParam == null || dayParam === '') return;
      await loadDayJsonByCode(dayParam, { fromUrl: true });
    };

    const processImportData = (content) => {
      try {
        if (!canUseLocalManual.value) {
          alert('当前已连接云端，同步模式下不可手动导入。');
          return;
        }
        const data = JSON.parse(content.trim());
        const words = Array.isArray(data) ? data : data.bank || [];
        if (words.length) {
          // 手动导入视为“切换词库”：仅保留新词库中仍存在词的进度
          const withIds = assignImportWordIds(words);
          const previousMastery = { ...state.mastery };
          state.originalWordBank = withIds;
          state.wordBank = data.randomMode ? shuffleArray([...withIds]) : [...withIds];
          state.currentIndex = 0;
          state.mastery = {};
          withIds.forEach((w) => {
            const s = readWordStatus(previousMastery, w);
            const key = masteryKeyOfWord(w);
            if (s && key) state.mastery[key] = s;
          });
          state.mastered_ids = [];
          state.settings.enableRandomMode = data.randomMode || false;
          state.settings.recallMode = data.recallMode || 'en2cn';
          state.reviewFilter = null;
          state.currentWord = state.wordBank[state.currentIndex];
          state.currentWordIndex = state.currentIndex;
          state.showImporter = false;
          state.importText = '';
          state.cloudModeLocked = true;
          localStorage.setItem(LS_CLOUD_MODE_LOCK, '1');
          localStorage.setItem(LS_LOCAL_MODE_LOCK, '0');
          state.localModeLocked = false;
          syncMasteredIdsFromMastery();
          alert(`✅ 导入成功！共加载 ${words.length} 个单词\n已按新词库重建进度（保留重合词状态）。`);
          save();
          pushGistProgress();
        } else {
          alert('⚠️ 导入的文件中没有找到单词数据');
        }
      } catch (e) {
        alert('❌ 导入解析出错\n错误信息：' + e.message);
      }
    };

    const handleFileUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => processImportData(ev.target.result);
      reader.readAsText(file);
    };

    const exportData = () => {
      if (!canUseLocalManual.value) {
        alert('当前已连接云端，同步模式下不可手动导出。');
        return;
      }
      syncMasteredIdsFromMastery();
      const data = JSON.stringify(
        {
          index: state.currentIndex,
          mastery: state.mastery,
          bank: state.originalWordBank,
          randomMode: state.settings.enableRandomMode,
          recallMode: state.settings.recallMode,
          mastered_ids: state.mastered_ids,
        },
        null,
        2,
      );
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'BEC单词备份.json';
      a.click();
    };

    const enterGuestMode = () => {
      localStorage.setItem(LS_GUEST, '1');
      localStorage.setItem(LS_LOCAL_MODE_LOCK, '1');
      sessionStorage.setItem(SS_WAS_GUEST, '1');
      state.localModeLocked = true;
      closeSyncDrawer();
    };

    const submitCloudLogin = async () => {
      if (!canUseCloudLogin.value) {
        alert('当前处于本地导入模式，请解除本地锁定后再连接云端。');
        return;
      }
      const token = state.authForm.token.trim();
      const gistId = state.authForm.gistId.trim();
      if (!token || !gistId) {
        alert('请填写 GitHub Token 与 Gist ID');
        return;
      }
      try {
        const res = await fetch(`https://api.github.com/gists/${gistId}`, {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });
        if (!res.ok) {
          alert('验证失败，请检查 Token 与 Gist ID（HTTP ' + res.status + '）');
          return;
        }
      } catch (e) {
        alert('网络错误：' + e.message);
        return;
      }
      const wasGuest = sessionStorage.getItem(SS_WAS_GUEST) === '1';
      localStorage.setItem(LS_TOKEN, token);
      localStorage.setItem(LS_GIST, gistId);
      localStorage.removeItem(LS_GUEST);
      localStorage.removeItem(LS_CLOUD_MODE_LOCK);
      state.cloudModeLocked = false;
      state.localModeLocked = true;
      localStorage.setItem(LS_LOCAL_MODE_LOCK, '1');
      sessionStorage.removeItem(SS_WAS_GUEST);
      if (wasGuest && confirm('是否将当前的本地进度同步至云端？')) {
        try {
          await mergeLocalProgressToGist();
        } catch (e) {
          alert('同步到云端失败：' + e.message + '\n仍将刷新页面，可稍后重试。');
        }
      }
      location.reload();
    };

    const hydrateFromLocalStorage = () => {
      const raw = localStorage.getItem(LS_APP);
      if (!raw) return;
      const p = JSON.parse(raw);
      const bank = p.bank || [defaultWord];
      state.originalWordBank = assignImportWordIds(bank);
      state.settings.enableRandomMode = p.randomMode || false;
      state.settings.recallMode = p.recallMode || 'en2cn';
      state.wordBank = state.settings.enableRandomMode ? shuffleArray([...state.originalWordBank]) : [...state.originalWordBank];
      state.currentIndex = p.index || 0;
      const rawMastery = p.mastery || {};
      const normalizedMastery = {};
      state.originalWordBank.forEach((w) => {
        const s = readWordStatus(rawMastery, w);
        const key = masteryKeyOfWord(w);
        if (s && key) normalizedMastery[key] = s;
      });
      state.mastery = normalizedMastery;
      state.mastered_ids = Array.isArray(p.mastered_ids) ? [...p.mastered_ids] : [];
      state.currentWord = state.wordBank[Math.min(state.currentIndex, state.wordBank.length - 1)];
      state.currentWordIndex = state.currentIndex;
      syncMasteredIdsFromMastery();
    };

    const initializeModeLocksOnLoad = () => {
      const hasValidToken = !!readToken();
      const hasUserImportedData = !!localStorage.getItem(LS_APP);
      
      // 清理旧的、不合法的锁定标记
      const oldLocalLock = localStorage.getItem(LS_LOCAL_MODE_LOCK);
      const oldCloudLock = localStorage.getItem(LS_CLOUD_MODE_LOCK);
      
      // 如果有本地锁但没有实际导入数据，清除它
      if (oldLocalLock === '1' && !hasUserImportedData) {
        localStorage.removeItem(LS_LOCAL_MODE_LOCK);
      }
      
      // 初始化状态：确定哪个模式应该被锁定
      // 原则：只有当已真正操作过才锁定
      if (hasValidToken) {
        // 已登录云端：锁定本地模式
        state.localModeLocked = true;
      } else if (hasUserImportedData && oldLocalLock === '1') {
        // 曾导入过数据：锁定云端模式
        state.cloudModeLocked = true;
      } else {
        // 初始状态或不确定：都解锁
        state.localModeLocked = false;
        state.cloudModeLocked = false;
      }
      
      localStorage.setItem(LS_LOCAL_MODE_LOCK, state.localModeLocked ? '1' : '0');
      localStorage.setItem(LS_CLOUD_MODE_LOCK, state.cloudModeLocked ? '1' : '0');
    };

    const mergeRemoteMastered = async () => {
      if (!isCloudConnected()) return;
      try {
        // 拉取云端最新的 word_status
        const remote = await fetchGistProgressRemote();
        const remoteStatus = remote.word_status || {};
        
        // 创建 ID 到 word 的映射表
        const idToWord = {};
        state.originalWordBank.forEach((w) => {
          if (w._id) idToWord[w._id] = w.word;
        });
        
        // 强力双向合并：将云端状态强制更新到本地 state.mastery
        Object.entries(remoteStatus).forEach(([id, status]) => {
          if (idToWord[id]) {
            state.mastery[id] = status;
          }
        });
        
        // 重新生成 mastered_ids（用于向后兼容和本地存储）
        const merged = {};
        Object.assign(merged, remoteStatus);
        
        // 加入本地有但云端没有的状态
        state.originalWordBank.forEach((w) => {
          if (w._id) {
            const s = getWordStatus(w);
            if (s && !merged[w._id]) merged[w._id] = s;
          }
        });
        
        // 从合并后的状态重建 mastered_ids（only 'known' 状态）
        state.mastered_ids = Object.entries(merged)
          .filter(([_, status]) => status === 'known')
          .map(([id, _]) => id);
        
        // 保存到本地
        save();
      } catch (e) {
        console.warn('拉取 Gist 进度失败（可离线继续）', e);
      }
    };

    const logoutCloud = () => {
      if (!confirm('确定要退出云端登录吗？退出后，你仍然可以重新连接。')) return;
      // 清除 localStorage 中的凭证
      localStorage.removeItem(LS_TOKEN);
      localStorage.removeItem(LS_GIST);
      localStorage.removeItem(LS_CLOUD_MODE_LOCK);
      
      // 重置状态
      state.authForm.token = '';
      state.authForm.gistId = '';
      state.cloudModeLocked = false;
      state.localModeLocked = false;
      
      // 清除 UI 状态
      state.showSyncDrawer = false;
      
      // 刷新页面
      location.reload();
    };

    const manualSync = async () => {
      if (!isCloudConnected()) {
        alert('请先连接云端');
        return;
      }
      
      state.syncInProgress = true;
      try {
        // 第一步：生成当前的 word_status
        const localStatus = generateWordStatus();
        
        // 第二步：拉取云端最新状态
        const remote = await fetchGistProgressRemote();
        const remoteStatus = remote.word_status || {};
        
        // 第三步：合并本地和云端状态
        // 规则：云端状态优先，本地补充
        const merged = {};
        Object.assign(merged, remoteStatus); // 先加入云端所有状态
        Object.entries(localStatus).forEach(([id, status]) => {
          if (!merged[id]) {
            // 仅当云端没有该 ID 时，才加入本地状态
            merged[id] = status;
          }
        });
        
        // 第四步：强制更新本地 state.mastery
        const idToWord = {};
        state.originalWordBank.forEach((w) => {
          if (w._id) idToWord[w._id] = w.word;
        });
        
        let statusChangedCount = 0;
        Object.entries(merged).forEach(([id, status]) => {
          if (idToWord[id] && state.mastery[id] !== status) {
            state.mastery[id] = status;
            statusChangedCount++;
          }
        });
        
        // 重建 mastered_ids（只包含 'known' 状态）
        state.mastered_ids = Object.entries(merged)
          .filter(([_, status]) => status === 'known')
          .map(([id, _]) => id);
        
        // 第五步：推送合并后的最终状态到云端
        await patchGistProgressRemote(merged);
        
        // 保存到本地
        save();
        
        // 获取当前词库统计（不包含已从词库删除的旧词）
        const currentStats = getCurrentBankStats();
        const knownCount = currentStats.known;
        const vagueCount = currentStats.vague;
        const unknownCount = currentStats.unknown;
        
        // 显示成功提示，展示同步的单词状态数量
        alert(`✅ 同步成功！\n已同步 ${Object.keys(merged).length} 个单词状态\n已掌握: ${knownCount} | 模糊: ${vagueCount} | 未掌握: ${unknownCount}`);
      } catch (e) {
        console.error('手动同步失败', e);
        alert('❌ 同步失败：' + e.message);
      } finally {
        state.syncInProgress = false;
      }
    };

    const cleanObsoleteStatuses = () => {
      const before = Object.keys(state.mastery || {}).length;
      const nextMastery = {};
      state.originalWordBank.forEach((w) => {
        const key = masteryKeyOfWord(w);
        const s = getWordStatus(w);
        if (key && s) nextMastery[key] = s;
      });
      state.mastery = nextMastery;
      syncMasteredIdsFromMastery();
      save();
      pushGistProgress();
      const after = Object.keys(nextMastery).length;
      const removed = Math.max(0, before - after);
      alert(`已清理 ${removed} 条旧状态记录。`);
    };

    onMounted(async () => {
      initializeModeLocksOnLoad();
      hydrateFromLocalStorage();
      await fetchManifest(true);
      await mergeRemoteMastered();
      await tryLoadFromUrlDayParam();

      document.addEventListener('keydown', (e) => {
        if (state.showImporter || state.showStats || state.showSyncDrawer || state.showSettingsMenu) return;
        const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

        // PC 答题体验：输入框中答案判定为正确时，回车直接判定并切到下一词
        if (e.key === 'Enter' && isTypingCorrect.value) {
          e.preventDefault();
          mark('known');
          return;
        }

        if (e.code === 'Space') {
          e.preventDefault();
          if (!isInput) state.settings.enableReviewMode = !state.settings.enableReviewMode;
          return;
        }
        if (e.code === 'ArrowRight') {
          e.preventDefault();
          nextWord();
          return;
        }
        if (e.code === 'ArrowLeft') {
          e.preventDefault();
          prevWord();
          return;
        }
        if (isInput) return;
        if (e.key.toLowerCase() === 'r') {
          toggleRandomMode();
          return;
        }
        if (e.key.toLowerCase() === 'm') {
          toggleRecallMode();
          return;
        }
        if (e.key === '1') {
          mark('unknown');
          return;
        }
        if (e.key === '2') {
          mark('vague');
          return;
        }
        if (e.key === '3') {
          mark('known');
          return;
        }
      });

      nextTick(() => {
        const scrollMain = document.querySelector('main.custom-scroll');
        if (!scrollMain) return;
        scrollMain.addEventListener(
          'touchstart',
          (e) => {
            if (!e.target.closest('#word-card')) {
              touchGestureFromCard = false;
              return;
            }
            touchGestureFromCard = true;
            touchStartX = e.changedTouches[0].screenX;
          },
          { passive: true },
        );
        scrollMain.addEventListener(
          'touchend',
          (e) => {
            if (!touchGestureFromCard) return;
            touchGestureFromCard = false;
            const touchEndX = e.changedTouches[0].screenX;
            handleTouch(touchStartX, touchEndX);
          },
          { passive: true },
        );
        scrollMain.addEventListener('touchcancel', () => {
          touchGestureFromCard = false;
        }, { passive: true });
      });
    });

    return {
      state,
      stats,
      filteredCurrentNo,
      filteredTotal,
      isTypingCorrect,
      toggleRandomMode,
      toggleRecallMode,
      nextWord,
      prevWord,
      mark,
      jump,
      openStatsAndReview,
      reviewWeak,
      reviewOnlyUnknown,
      reviewOnlyVague,
      handleFileUpload,
      exportData,
      handleImport: () => processImportData(state.importText),
      playAudio,
      isCloudConnected,
      isCloudGuest,
      gistIdSuffix,
      cloudModeActive,
      localModeActive,
      isCloudLocked,
      isLocalLocked,
      canUseCloudLogin,
      canUseLocalManual,
      isWordMasteredHighlight,
      enterGuestMode,
      submitCloudLogin,
      openSyncDrawer,
      closeSyncDrawer,
      closeSettingsMenu,
      handlePanelTouchStart,
      handlePanelTouchEnd,
      unlockModes,
      toggleShowAllWordInfo,
      logoutCloud,
      manualSync,
      fetchManifest,
      loadSelectedDay,
      loadAllFromManifest,
      cleanObsoleteStatuses,
      getWordStatus,
      canDismissAuthOverlay,
      formatDayLabel,
    };
  },
}).mount('#app');
