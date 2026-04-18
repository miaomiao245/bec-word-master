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
    const ids = Array.isArray(o.mastered_ids) ? o.mastered_ids.filter(Boolean) : [];
    return { mastered_ids: ids, last_updated: o.last_updated || new Date().toISOString() };
  } catch {
    return { mastered_ids: [], last_updated: new Date().toISOString() };
  }
};

const fetchGistProgressRemote = async () => {
  const gistId = readGistId();
  const token = readToken();
  if (!gistId || !token) return { mastered_ids: [], last_updated: null };
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`Gist GET ${res.status}`);
  const data = await res.json();
  const file = data.files && (data.files['progress.json'] || data.files['Progress.json']);
  if (!file || !file.content) return { mastered_ids: [], last_updated: null };
  return parseProgressJson(file.content);
};

const patchGistProgressRemote = async (mastered_ids) => {
  const gistId = readGistId();
  const token = readToken();
  if (!gistId || !token) return;
  const body = {
    mastered_ids: [...new Set(mastered_ids)],
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
  const merged = new Set([...remote.mastered_ids, ...readLocalMasteredIdsFromState()]);
  await patchGistProgressRemote([...merged]);
};

/** 从当前 reactive state 读取（登录流程在 reload 前调用） */
let _stateRef = null;
const readLocalMasteredIdsFromState = () => {
  if (!_stateRef) return [];
  const ids = new Set(_stateRef.mastered_ids || []);
  const bank = _stateRef.originalWordBank || [];
  const mastery = _stateRef.mastery || {};
  bank.forEach((w) => {
    if (w._id && mastery[w.word] === 'known') ids.add(w._id);
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

    const isWordMasteredHighlight = (w) => w && w._id && state.mastered_ids.includes(w._id);

    const filteredWordBank = computed(() => {
      if (!state.reviewFilter) return state.wordBank;
      if (state.reviewFilter === 'unknown') return state.wordBank.filter((w) => state.mastery[w.word] === 'unknown');
      if (state.reviewFilter === 'vague') return state.wordBank.filter((w) => state.mastery[w.word] === 'vague');
      if (state.reviewFilter === 'both') return state.wordBank.filter((w) => state.mastery[w.word] === 'unknown' || state.mastery[w.word] === 'vague');
      return state.wordBank;
    });

    const filteredTotal = computed(() => filteredWordBank.value.length);
    const filteredCurrentIndex = computed(() => {
      const idx = filteredWordBank.value.findIndex((w) => w.word === state.currentWord.word);
      return idx === -1 ? 0 : idx;
    });
    const filteredCurrentNo = computed(() => filteredCurrentIndex.value + 1);

    const stats = computed(() => {
      const res = { known: 0, vague: 0, unknown: 0 };
      Object.values(state.mastery).forEach((v) => {
        if (res[v] !== undefined) res[v]++;
      });
      return res;
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
      const set = new Set(state.mastered_ids);
      state.originalWordBank.forEach((w) => {
        if (w._id && state.mastery[w.word] === 'known') set.add(w._id);
      });
      state.mastered_ids = [...set];
    };

    const pushGistProgress = () => {
      if (!isCloudConnected()) return;
      syncMasteredIdsFromMastery();
      patchGistProgressRemote(state.mastered_ids).catch((e) => console.error('Gist 同步失败', e));
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
        const globalIdx = state.wordBank.findIndex((w) => w.word === target.word);
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
      state.mastery[state.currentWord.word] = s;
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
          const withIds = assignImportWordIds(words);
          state.originalWordBank = withIds;
          state.wordBank = data.randomMode ? shuffleArray([...withIds]) : [...withIds];
          state.currentIndex = data.index || 0;
          state.mastery = data.mastery || {};
          state.mastered_ids = Array.isArray(data.mastered_ids) ? [...data.mastered_ids] : [];
          state.settings.enableRandomMode = data.randomMode || false;
          state.settings.recallMode = data.recallMode || 'en2cn';
          state.reviewFilter = null;
          state.currentWord = state.wordBank[state.currentIndex];
          state.currentWordIndex = state.currentIndex;
          state.showImporter = false;
          state.cloudModeLocked = true;
          localStorage.setItem(LS_CLOUD_MODE_LOCK, '1');
          localStorage.setItem(LS_LOCAL_MODE_LOCK, '0');
          state.localModeLocked = false;
          syncMasteredIdsFromMastery();
          alert(`✅ 导入成功！共加载 ${words.length} 个单词`);
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
      state.mastery = p.mastery || {};
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
        const remote = await fetchGistProgressRemote();
        const set = new Set([...state.mastered_ids, ...remote.mastered_ids]);
        state.mastered_ids = [...set];
        save();
      } catch (e) {
        console.warn('拉取 Gist 进度失败（可离线继续）', e);
      }
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
        if (e.key === 'Enter' && isTypingCorrect.value) {
          e.preventDefault();
          mark('known');
          return;
        }
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
      fetchManifest,
      loadSelectedDay,
      loadAllFromManifest,
      canDismissAuthOverlay,
      formatDayLabel,
    };
  },
}).mount('#app');
