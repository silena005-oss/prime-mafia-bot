const tg = window.Telegram && window.Telegram.WebApp;
const THEME_KEY = 'pm_miniapp_theme';

const state = {
  data: null,
  selectedGame: null,
  selectedKlubId: null,
  theme: localStorage.getItem(THEME_KEY) || 'default',
  nominateArmed: false,
  nominateMode: null,
  foulArmed: false,
  showEvening: false,
  /** Локальный тик таймера речи (сек), синхронизируется с сервером */
  localTimerSec: 0,
  localTimerKod: null,
  localTimerSpeaking: null,
};

if (tg) {
  tg.ready();
  tg.expand();
  tg.MainButton.setText('Меню бота');
  tg.MainButton.onClick(() => sendAction('open_menu'));
  tg.MainButton.hide();
}

const el = {
  avatar: document.getElementById('avatar'),
  profileName: document.getElementById('profileName'),
  profileMeta: document.getElementById('profileMeta'),
  brandEyebrow: document.getElementById('brandEyebrow'),
  brandMark: document.querySelector('.mark'),
  themeGrid: document.getElementById('themeGrid'),
  clubsList: document.getElementById('clubsList'),
  gamesList: document.getElementById('gamesList'),
  gameTitle: document.getElementById('gameTitle'),
  gameStatus: document.getElementById('gameStatus'),
  table: document.getElementById('table'),
  tableBrandTop: document.getElementById('tableBrandTop'),
  tableBrandMain: document.getElementById('tableBrandMain'),
  gamesCount: document.getElementById('gamesCount'),
  playersCount: document.getElementById('playersCount'),
  aliveCount: document.getElementById('aliveCount'),
  myRating: document.getElementById('myRating'),
  bestGame: document.getElementById('bestGame'),
  roleStats: document.getElementById('roleStats'),
  ratingSection: document.getElementById('ratingSection'),
  giftsSection: document.getElementById('giftsSection'),
  giftsList: document.getElementById('giftsList'),
  clubTop: document.getElementById('clubTop'),
  toast: document.getElementById('toast'),
  celebrationOverlay: document.getElementById('celebrationOverlay'),
  celebrationEmoji: document.getElementById('celebrationEmoji'),
  celebrationTitle: document.getElementById('celebrationTitle'),
  celebrationSub: document.getElementById('celebrationSub'),
  celebrationClose: document.getElementById('celebrationClose'),
  lastGameResult: document.getElementById('lastGameResult'),
  profileSettingsTrigger: document.getElementById('profileSettingsTrigger'),
  profileSettingsDialog: document.getElementById('profileSettingsDialog'),
  settingsAvatar: document.getElementById('settingsAvatar'),
  syncAvatarBtn: document.getElementById('syncAvatarBtn'),
  settingsThemeHint: document.getElementById('settingsThemeHint'),
  openBotSettingsBtn: document.getElementById('openBotSettingsBtn'),
  posterDialog: document.getElementById('posterDialog'),
  posterCanvas: document.getElementById('posterCanvas'),
  posterClub: document.getElementById('posterClub'),
  posterDate: document.getElementById('posterDate'),
  posterTime: document.getElementById('posterTime'),
  posterPlace: document.getElementById('posterPlace'),
  posterRender: document.getElementById('posterRender'),
  posterDownload: document.getElementById('posterDownload'),
  posterTile: document.getElementById('posterTile'),
  hostIntro: document.getElementById('hostIntro'),
  hostIntroStep: document.getElementById('hostIntroStep'),
  hostIntroHint: document.getElementById('hostIntroHint'),
  hostIntroCardWrap: document.getElementById('hostIntroCardWrap'),
  hostIntroCard: document.getElementById('hostIntroCard'),
  myRolePanel: document.getElementById('myRolePanel'),
  myRoleCard: document.getElementById('myRoleCard'),
  myRoleName: document.getElementById('myRoleName'),
  hostMirny: document.getElementById('hostMirny'),
  mirnyCandidates: document.getElementById('mirnyCandidates'),
  mirnyInput: document.getElementById('mirnyInput'),
  mirnyEditWrap: document.getElementById('mirnyEditWrap'),
  confirmMirnyBtn: document.getElementById('confirmMirnyBtn'),
  editMirnyBtn: document.getElementById('editMirnyBtn'),
  submitMirnyBtn: document.getElementById('submitMirnyBtn'),
  hostSummary: document.getElementById('hostSummary'),
  hostSummaryText: document.getElementById('hostSummaryText'),
  hostMeta: document.getElementById('hostMeta'),
  hostActions: document.getElementById('hostActions'),
  hostRoster: document.getElementById('hostRoster'),
  rosterInput: document.getElementById('rosterInput'),
  submitRosterBtn: document.getElementById('submitRosterBtn'),
  hostNight: document.getElementById('hostNight'),
  nightStepLabel: document.getElementById('nightStepLabel'),
  nightPickActions: document.getElementById('nightPickActions'),
  createGameDialog: document.getElementById('createGameDialog'),
  createGameClub: document.getElementById('createGameClub'),
  createGameSize: document.getElementById('createGameSize'),
  createGameConfirm: document.getElementById('createGameConfirm'),
  createGameCancel: document.getElementById('createGameCancel'),
  eveningPanel: document.getElementById('eveningPanel'),
  eveningMeta: document.getElementById('eveningMeta'),
  eveningPlayers: document.getElementById('eveningPlayers'),
  eveningActions: document.getElementById('eveningActions'),
  eveningRosterLabel: document.getElementById('eveningRosterLabel'),
  eveningRosterInput: document.getElementById('eveningRosterInput'),
  eveningFooter: document.getElementById('eveningFooter'),
  hostVoting: document.getElementById('hostVoting'),
  votingNominees: document.getElementById('votingNominees'),
  voteFinishBtn: document.getElementById('voteFinishBtn'),
  importRatingSection: document.getElementById('importRatingSection'),
  importRatingInput: document.getElementById('importRatingInput'),
  importRatingBtn: document.getElementById('importRatingBtn'),
};

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'scroll_rating') {
      el.ratingSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast('Личный рейтинг и лучшая игра — справа');
      return;
    }
    if (action === 'scroll_gifts') {
      el.giftsSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (action === 'poster') {
      openPosterDialog();
      return;
    }
    if (action === 'create_game') {
      openCreateGameDialog();
      return;
    }
    if (action === 'igrovoy_vecher') {
      state.showEvening = true;
      loadState(state.selectedKlubId, true).then(() => showToast('Игровой вечер — слева'));
      return;
    }
    sendAction(action);
  });
});

if (el.voteFinishBtn) {
  el.voteFinishBtn.addEventListener('click', () => hostAction('vote_finish'));
}
if (el.importRatingBtn) {
  el.importRatingBtn.addEventListener('click', async () => {
    const text = el.importRatingInput?.value || '';
    if (!text.trim()) {
      showToast('Вставь CSV');
      return;
    }
    try {
      const json = await miniappAction('import_rating', { klub_id: state.selectedKlubId, text });
      showToast(json?.message || 'Готово');
      if (json?.data) {
        state.data = json.data;
        render();
      }
    } catch {
      showToast('Ошибка импорта');
    }
  });
}

async function vecherAction(sub, extra = {}) {
  const klub_id = state.selectedKlubId;
  if (!klub_id) {
    showToast('Выбери клуб');
    return;
  }
  try {
    const json = await miniappAction('vecher_action', { klub_id, sub, ...extra });
    showToast(json?.message || 'Готово');
    if (json?.data) {
      state.data = json.data;
      if (json.selected_game) {
        state.selectedGame = json.data.games?.find((g) => String(g.kod) === String(json.selected_game)) || state.selectedGame;
      }
      render();
    }
  } catch (err) {
    showToast(err?.message === 'action_failed' ? 'Не удалось выполнить действие' : (err?.message || 'Не удалось выполнить действие'));
  }
}

function confirmFinishEvening() {
  if (!window.confirm('Завершить игровой вечер?\n\nРейтинг будет подсчитан по всем внесённым играм.\nСостав сохранится, новые игры не привяжутся к этому вечеру.')) return;
  vecherAction('finish');
}

if (el.celebrationClose) {
  el.celebrationClose.addEventListener('click', () => {
    el.celebrationOverlay?.classList.add('hidden');
    sendAction('ack_celebration');
  });
}

if (el.posterRender) el.posterRender.addEventListener('click', renderPosterCanvas);
if (el.submitRosterBtn) el.submitRosterBtn.addEventListener('click', submitRoster);
if (el.submitMirnyBtn) el.submitMirnyBtn.addEventListener('click', submitMirnyList);
if (el.confirmMirnyBtn) {
  el.confirmMirnyBtn.addEventListener('click', async () => {
    await hostAction('intro_mirny', { confirm_all: true });
  });
}
if (el.editMirnyBtn) {
  el.editMirnyBtn.addEventListener('click', () => {
    el.mirnyEditWrap?.classList.remove('hidden');
    el.submitMirnyBtn?.classList.remove('hidden');
    el.confirmMirnyBtn?.classList.add('hidden');
    el.editMirnyBtn?.classList.add('hidden');
    showToast('Кликни место за столом или введи ники списком');
  });
}
if (el.createGameConfirm) el.createGameConfirm.addEventListener('click', confirmCreateGame);
if (el.createGameCancel) el.createGameCancel.addEventListener('click', () => el.createGameDialog?.close());

if (el.profileSettingsTrigger) {
  el.profileSettingsTrigger.addEventListener('click', openProfileSettings);
  el.profileSettingsTrigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openProfileSettings();
    }
  });
}
if (el.syncAvatarBtn) el.syncAvatarBtn.addEventListener('click', syncAvatarFromTelegram);
if (el.openBotSettingsBtn) {
  el.openBotSettingsBtn.addEventListener('click', () => {
    el.profileSettingsDialog?.close();
    sendAction('profile_settings');
  });
}

function openProfileSettings() {
  const user = state.data?.user;
  if (user) {
    renderAvatar(el.settingsAvatar, user.name, user.avatar_url);
  }
  updateSettingsThemeHint();
  el.profileSettingsDialog?.showModal();
}

function updateSettingsThemeHint() {
  if (!el.settingsThemeHint) return;
  const club = (state.data?.clubs || []).find((c) => c.id === state.selectedKlubId);
  if (club?.club_theme) {
    el.settingsThemeHint.textContent = 'Клуб «' + (club.nazvaniye || '') + '» задаёт свою тему — цвет применяется автоматически.';
  } else {
    el.settingsThemeHint.textContent = 'Выбери цвет интерфейса для себя. Клубные темы (Ellada, Sochi) видны только участникам этих клубов.';
  }
}

async function miniappAction(action, extra = {}) {
  if (!tg || !tg.initData) {
    showToast('Открой mini app внутри Telegram.');
    return null;
  }
  const response = await fetch('/api/miniapp/action', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-init-data': tg.initData,
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const json = await response.json();
  if (!response.ok || !json.ok) throw new Error(json.error || 'action_failed');
  return json;
}

async function syncAvatarFromTelegram() {
  try {
    showToast('Обновляю аватар...');
    const json = await miniappAction('sync_avatar');
    showToast(json?.message || 'Готово');
    await loadState(state.selectedKlubId, true);
    renderAvatar(el.settingsAvatar, state.data?.user?.name, state.data?.user?.avatar_url);
  } catch {
    showToast('Не удалось обновить аватар.');
  }
}

function initials(name) {
  return String(name || 'PM')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function statusLabel(status) {
  if (status === 'live') return 'идёт';
  if (status === 'paused') return 'пауза';
  if (status === 'lobby') return 'лобби';
  return status || 'ожидание';
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.remove('show'), 2400);
}

function applyTheme(themeId) {
  const id = themeId || 'default';
  state.theme = id;
  document.documentElement.setAttribute('data-theme', id);
  localStorage.setItem(THEME_KEY, id);
  document.querySelectorAll('[data-theme-id]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeId === id);
  });
}

function effectiveTheme(data) {
  const club = (data?.clubs || []).find((c) => c.id === state.selectedKlubId);
  if (club?.club_theme) return club.club_theme;
  const saved = state.theme;
  const allowed = (data?.themes || []).map((t) => t.id);
  if (allowed.includes(saved)) return saved;
  return 'default';
}

function renderThemes(themes) {
  const list = themes || [];
  const forced = (state.data?.clubs || []).find((c) => c.id === state.selectedKlubId)?.club_theme;
  el.themeGrid.innerHTML = list.map((theme) => `
    <button type="button" class="theme-chip${forced ? ' disabled' : ''}" data-theme-id="${escapeAttr(theme.id)}" title="${escapeAttr(theme.label)}"${forced ? ' disabled' : ''}>
      <span class="theme-swatch" style="background:${escapeAttr(theme.accent)}"></span>
      <span>${escapeHtml(theme.label)}</span>
    </button>
  `).join('');

  if (!forced) {
    el.themeGrid.querySelectorAll('[data-theme-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyTheme(btn.dataset.themeId);
        showToast('Тема: ' + btn.textContent.trim());
      });
    });
  }
  applyTheme(effectiveTheme(state.data));
}

async function sendAction(action, extra = {}) {
  if (!tg || !tg.initData) {
    showToast('Открой mini app внутри Telegram, чтобы выполнить действие.');
    return null;
  }

  try {
    const json = await miniappAction(action, extra);
    if (json.stay) {
      showToast(json.message || 'Готово');
      if (json.data) {
        state.data = json.data;
        if (json.selected_game) {
          state.selectedGame = json.data.games?.find((g) => String(g.kod) === String(json.selected_game)) || state.selectedGame;
        }
        render();
      } else if (json.selected_game) {
        await loadState(state.selectedKlubId, true);
      }
      return json;
    }
    showToast(json.message || 'Готово, смотри бот');
    setTimeout(() => tg.close(), 650);
    return json;
  } catch (error) {
    showToast('Не удалось выполнить действие. Попробуй ещё раз.');
    return null;
  }
}

function openCreateGameDialog() {
  const clubs = state.data?.clubs || [];
  if (!clubs.length) {
    showToast('Сначала нужен клуб ведущего.');
    return;
  }
  el.createGameClub.innerHTML = clubs.map((club) =>
    `<option value="${escapeAttr(club.id)}">${escapeHtml(club.nazvaniye || 'Клуб')}</option>`
  ).join('');
  const preferred = state.selectedKlubId || clubs[0]?.id;
  if (preferred) el.createGameClub.value = preferred;
  el.createGameDialog?.showModal();
}

async function confirmCreateGame() {
  const klub_id = el.createGameClub?.value;
  const kolichestvo = parseInt(el.createGameSize?.value, 10);
  if (!klub_id || !Number.isFinite(kolichestvo)) return;
  el.createGameDialog?.close();
  showToast('Создаю игру...');
  await sendAction('create_game', { klub_id, kolichestvo });
}

async function submitRoster() {
  const game = state.selectedGame;
  if (!game?.kod) return;
  const text = el.rosterInput?.value || '';
  showToast('Сохраняю состав...');
  await sendAction('submit_roster', { kod: game.kod, text });
}

async function submitMirnyList() {
  const game = state.selectedGame;
  if (!game?.kod) return;
  await hostAction('intro_mirny', { text: el.mirnyInput?.value || '' });
  if (el.mirnyInput) el.mirnyInput.value = '';
}

function hostClickMode(host) {
  if (host?.intro?.phase === 'roles') return 'intro_assign';
  if (host?.intro?.phase === 'mirny') return 'intro_mirny';
  if (host?.can_pick_first) return 'pick_first';
  if (state.nominateArmed && state.nominateMode === 'to_vote') return 'to_vote';
  if (host?.can_nominate && state.nominateArmed) return 'nominate';
  if (host?.can_foul && state.foulArmed) return 'foul';
  if (host?.night?.guided && !host?.night?.done) return 'night_pick';
  return null;
}

async function hostAction(sub, extra = {}) {
  const game = state.selectedGame;
  if (!game?.kod) return;
  await sendAction('host_action', { kod: game.kod, sub, ...extra });
}

async function loadState(klubId, silent) {
  try {
    const query = klubId ? `?klub_id=${encodeURIComponent(klubId)}` : '';
    const response = await fetch('/api/miniapp/state' + query, {
      headers: {
        'x-telegram-init-data': tg ? tg.initData : '',
      },
    });
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.error || 'load_failed');
    state.data = json.data;
    state.selectedKlubId = json.data.selected_klub_id || json.data.clubs?.[0]?.id || null;
    const prevKod = state.selectedGame?.kod;
    if (prevKod) {
      state.selectedGame = json.data.games?.find((g) => String(g.kod) === String(prevKod)) || json.data.games?.[0] || null;
    } else if (!state.selectedGame) {
      state.selectedGame = json.data.games?.[0] || null;
    }
    syncLocalTimerFromGame(state.selectedGame);
    render();
  } catch (error) {
    if (!silent) renderError(error);
  }
}

function syncLocalTimerFromGame(game) {
  const host = game?.host;
  const kod = game?.kod ? String(game.kod) : null;
  const speaking = host?.speaking_nomer || null;
  const sec = Number(host?.timer_sec) || 0;
  if (!kod || !speaking || sec <= 0) {
    state.localTimerSec = 0;
    state.localTimerKod = null;
    state.localTimerSpeaking = null;
    return;
  }
  const sameSpeaker = state.localTimerKod === kod && state.localTimerSpeaking === speaking;
  // Подтягиваем с сервера при смене говорящего или если локальный таймер сильно отстаёт/опережает
  if (!sameSpeaker || Math.abs(state.localTimerSec - sec) > 2 || state.localTimerSec <= 0) {
    state.localTimerSec = sec;
  }
  state.localTimerKod = kod;
  state.localTimerSpeaking = speaking;
}

function tickLocalTimer() {
  if (state.localTimerSec <= 0) return;
  state.localTimerSec -= 1;
  const game = state.selectedGame;
  if (!game?.host || !el.hostMeta) return;
  if (String(game.kod) !== String(state.localTimerKod)) return;
  if (game.host.speaking_nomer !== state.localTimerSpeaking) return;
  // Обновляем только строку мета, без полной перерисовки кнопок
  const host = { ...game.host, timer_sec: state.localTimerSec };
  const parts = [];
  if (host.can_submit_roster) parts.push(`Состав: ${host.roster_count}/${host.roster_needed}`);
  if (host.intro?.phase === 'roles') {
    parts.push(`Ночь знакомства ${(host.intro.idx ?? 0) + 1}/${host.intro.total}: ${host.intro.label}`);
  } else if (host.intro?.phase === 'mirny') {
    parts.push(`Мирные: осталось ${host.intro.remaining}`);
  }
  if (host.speaking_nomer) {
    parts.push(`Говорит №${host.speaking_nomer}${host.timer_sec > 0 ? ' · ⏱ ' + host.timer_sec + 'с' : ''}`);
  }
  if (host.nominees?.length && (game.faza === 'opravdanie' || game.faza === 'golosovanie')) {
    parts.push(`На голосовании: ${host.nominees.map((n) => '№' + n.nomer).join(', ')}`);
  }
  el.hostMeta.textContent = parts.join(' · ') || 'Управляй игрой здесь — бот не нужен';
  if (state.localTimerSec <= 0) {
    // Сервер уже переключит ход — подтянем состояние
    loadState(state.selectedKlubId, true);
  }
}

function renderMyRating(my) {
  if (!my) {
    el.myRating.innerHTML = '<p class="muted">Пока нет игр в рейтинге. Сыграй вечер в боте.</p>';
    return;
  }
  el.myRating.innerHTML = `
    <div class="rating-stats">
      <div><span>${my.points}</span><p>очков</p></div>
      <div><span>${my.games}</span><p>игр</p></div>
      <div><span>${my.wins}</span><p>побед</p></div>
    </div>
    ${my.recent?.length ? `
      <div class="recent-games">
        ${my.recent.map((g) => `
          <div class="recent-row">
            <span>${g.won ? '✅' : '·'}</span>
            <span>${escapeHtml(g.role)}</span>
            <strong>+${g.points}</strong>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

function renderBestGame(best) {
  el.bestGame.classList.remove('win-celebrate');
  if (!best) {
    el.bestGame.innerHTML = '<p class="muted">Лучшая игра появится после первых результатов.</p>';
    return;
  }
  if (best.won) {
    el.bestGame.classList.add('win-celebrate');
    triggerWinConfetti();
  }
  el.bestGame.innerHTML = `
    <div class="best-game-inner">
      <div class="best-points">+${best.points}</div>
      <div>
        <strong>${escapeHtml(best.role)}</strong>
        <p>${best.won ? '🎉 Победа' : 'Поражение'}${best.club ? ' · ' + escapeHtml(best.club) : ''}</p>
        ${best.best_move ? '<p class="best-move">⭐ Лучший ход</p>' : ''}
      </div>
    </div>
  `;
}

function renderRoleStats(stats) {
  if (!stats?.length) {
    el.roleStats.innerHTML = '<p class="muted">Статистика по ролям появится после игр в рейтинге.</p>';
    return;
  }
  el.roleStats.innerHTML = stats.slice(0, 8).map((row) => `
    <div class="role-stat-row">
      <span class="role-name">${escapeHtml(row.role)}</span>
      <span class="role-meta">${row.games} игр · ${row.wins} побед</span>
      <strong>+${row.points}</strong>
    </div>
  `).join('');
}

function triggerWinConfetti() {
  if (document.querySelector('.win-confetti')) return;
  const layer = document.createElement('div');
  layer.className = 'win-confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 24; i += 1) {
    const piece = document.createElement('span');
    piece.style.setProperty('--i', String(i));
    piece.style.setProperty('--x', `${10 + Math.random() * 80}%`);
    piece.style.setProperty('--delay', `${Math.random() * 0.4}s`);
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3200);
}

function renderGifts(bonuses) {
  const list = bonuses?.active || [];
  if (!list.length) {
    el.giftsList.innerHTML = '<p class="muted">Активных бонусов нет. Ведущий может начислить подарок в панели игры.</p>';
    return;
  }
  el.giftsList.innerHTML = list.map((b) => `
    <div class="gift-row">
      <span>${b.emoji || '🎁'}</span>
      <div>
        <strong>${escapeHtml(b.label)}</strong>
        <p>${escapeHtml(b.opisaniye || b.club || '')}</p>
      </div>
    </div>
  `).join('');
}

const pobeditelLabels = { mirnye: '🟢 Мирные', mafiya: '🔴 Мафия', manyak: '🎯 Маньяк' };

function showCelebration(ev) {
  if (!ev || !el.celebrationOverlay) return;
  renderGameResultCard(ev);
  el.celebrationEmoji.textContent = ev.emoji || (ev.won ? '🎉' : '🏁');
  el.celebrationTitle.textContent = ev.title || (ev.won ? 'Победа!' : ev.is_host ? 'Игра завершена' : 'Игра завершена');
  let sub = ev.phrase || '';
  if (ev.detail) sub += (sub ? '\n\n' : '') + ev.detail;
  if (!sub && ev.pobeditel) {
    sub = (pobeditelLabels[ev.pobeditel] || ev.pobeditel) + (ev.kod ? ' · игра №' + ev.kod : '');
  }
  el.celebrationSub.textContent = sub;
  el.celebrationOverlay.classList.remove('hidden');
  if (ev.won) triggerWinConfetti();
}

function renderGameResultCard(ev) {
  if (!el.lastGameResult || !ev) return;
  el.lastGameResult.classList.remove('hidden');
  const roleLine = ev.role ? `<p class="muted">Твоя роль: ${escapeHtml(ev.role)}</p>` : '';
  const hostLine = ev.is_host ? '<p class="muted">Итог для ведущего</p>' : '';
  el.lastGameResult.innerHTML = `
    <strong>${escapeHtml(ev.emoji || '🏁')} ${escapeHtml(ev.title || 'Итог игры')}</strong>
    ${hostLine}${roleLine}
    <p>${escapeHtml(ev.phrase || '')}</p>
    ${ev.detail ? `<div class="result-detail">${escapeHtml(ev.detail)}</div>` : ''}
  `;
}

function openPosterDialog() {
  const club = (state.data?.clubs || []).find((c) => c.id === state.selectedKlubId);
  el.posterClub.value = club?.nazvaniye || 'Prime Mafia';
  if (!el.posterDate.value) {
    const d = new Date();
    el.posterDate.value = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  }
  renderPosterCanvas();
  el.posterDialog?.showModal();
}

function renderPosterCanvas() {
  const canvas = el.posterCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#d9b46a';
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#12121f');
  grad.addColorStop(1, '#1a1020');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.strokeRect(48, 48, w - 96, h - 96);
  ctx.fillStyle = accent;
  ctx.font = 'bold 42px system-ui, sans-serif';
  ctx.fillText('МАФИЯ', 80, 140);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 72px system-ui, sans-serif';
  wrapText(ctx, el.posterClub.value || 'Клуб', 80, 280, w - 160, 78);
  ctx.font = '48px system-ui, sans-serif';
  ctx.fillStyle = '#e8e8f0';
  ctx.fillText('📅 ' + (el.posterDate.value || ''), 80, 520);
  ctx.fillText('🕐 ' + (el.posterTime.value || '19:00'), 80, 600);
  ctx.fillText('📍 ' + (el.posterPlace.value || ''), 80, 680);
  ctx.fillStyle = accent;
  ctx.font = '36px system-ui, sans-serif';
  ctx.fillText('Запись в Prime Mafia', 80, h - 120);
  if (el.posterDownload) {
    el.posterDownload.href = canvas.toDataURL('image/png');
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(' ');
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line.trim(), x, yy);
      line = word + ' ';
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line.trim(), x, yy);
}

function renderClubTop(top) {
  if (!top?.length) {
    el.clubTop.innerHTML = '<p class="muted">Топ клуба пока пуст.</p>';
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  el.clubTop.innerHTML = top.map((p) => `
    <div class="rank-row">
      <span class="rank-place">${medals[p.place - 1] || p.place + '.'}</span>
      <span class="rank-name">${escapeHtml(p.name)}</span>
      <strong class="rank-pts">${p.pts}</strong>
    </div>
  `).join('');
}

function avatarHeaders() {
  return tg?.initData ? { 'x-telegram-init-data': tg.initData } : {};
}

async function loadAuthImage(url) {
  if (!url || !tg?.initData) return null;
  try {
    const response = await fetch(url, { headers: avatarHeaders() });
    if (!response.ok) return null;
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (_) {
    return null;
  }
}

const loadAvatarImage = loadAuthImage;

function setRoleCardImage(imgEl, wrapEl, url, altText) {
  if (!imgEl) return;
  if (!url) {
    wrapEl?.classList.add('hidden');
    imgEl.removeAttribute('src');
    return;
  }
  wrapEl?.classList.remove('hidden');
  imgEl.alt = altText || 'Карта роли';
  loadAuthImage(url).then((objectUrl) => {
    if (!objectUrl) {
      wrapEl?.classList.add('hidden');
      return;
    }
    imgEl.src = objectUrl;
  });
}

function renderAvatar(container, name, avatarUrl) {
  const label = initials(name);
  container.textContent = label;
  if (!avatarUrl) return;
  loadAvatarImage(avatarUrl).then((objectUrl) => {
    if (!objectUrl) return;
    container.innerHTML = `<img src="${escapeAttr(objectUrl)}" alt="" /><span class="avatar-fallback">${escapeHtml(label)}</span>`;
    const img = container.querySelector('img');
    img.addEventListener('error', () => {
      container.textContent = label;
    });
  });
}

function render() {
  const data = state.data;
  const user = data.user;
  const games = data.games || [];
  const clubs = data.clubs || [];
  const game = state.selectedGame || games[0] || null;
  const selectedClub = clubs.find((c) => c.id === state.selectedKlubId);

  applyTheme(effectiveTheme(data));
  renderThemes(data.themes);

  el.profileName.textContent = user.name;
  const metaParts = [user.registered ? 'Telegram подтверждён' : 'Профиль ещё не зарегистрирован'];
  if (user.birthday) metaParts.push('🎂 ' + user.birthday);
  el.profileMeta.textContent = metaParts.join(' · ');
  renderAvatar(el.avatar, user.name, user.avatar_url);

  if (selectedClub?.logo_url && el.brandMark) {
    el.brandMark.innerHTML = `<img src="${escapeAttr(selectedClub.logo_url)}" alt="" />`;
  } else if (el.brandMark) {
    el.brandMark.textContent = 'PM';
  }

  if (selectedClub?.branded) {
    el.brandEyebrow.textContent = selectedClub.nazvaniye || 'Prime Mafia';
    el.tableBrandTop.textContent = (selectedClub.nazvaniye || 'Prime').split(' ')[0];
    el.tableBrandMain.textContent = (selectedClub.nazvaniye || 'Mafia').split(' ').slice(1).join(' ') || 'Mafia';
  } else {
    el.brandEyebrow.textContent = 'Prime Mafia';
    el.tableBrandTop.textContent = 'Prime';
    el.tableBrandMain.textContent = 'Mafia';
  }

  el.clubsList.innerHTML = clubs.length
    ? clubs.map((club) => `
      <button class="club-card ${club.id === state.selectedKlubId ? 'active' : ''}" type="button" data-klub="${escapeAttr(club.id)}">
        <strong>${escapeHtml(club.nazvaniye || 'Клуб')}</strong>
        <p>${club.branded ? (club.logo_url ? '🎨 бренд клуба' : '🎨 стилизация клуба') : 'Доступ ведущего'}</p>
      </button>
    `).join('')
    : '<p class="muted">Клубы пока не найдены.</p>';

  el.clubsList.querySelectorAll('[data-klub]').forEach((button) => {
    button.addEventListener('click', () => {
      loadState(button.dataset.klub);
    });
  });

  renderMyRating(data.rating_enabled ? data.rating?.my : null);
  renderBestGame(data.rating_enabled ? data.rating?.best_game : null);
  renderRoleStats(data.rating_enabled ? data.rating?.role_stats : null);
  renderGifts(data.bonuses);
  renderClubTop(data.rating_enabled ? data.rating?.top : null);

  const ratingOn = data.rating_enabled !== false;
  el.ratingSection?.classList.toggle('hidden', !ratingOn);
  document.querySelector('.inspector-best')?.classList.toggle('hidden', !ratingOn);
  document.querySelector('.inspector-roles')?.classList.toggle('hidden', !ratingOn);
  document.querySelector('.inspector-top')?.classList.toggle('hidden', !ratingOn);
  const ratingTile = document.querySelector('[data-action="scroll_rating"]');
  if (ratingTile) ratingTile.style.display = ratingOn ? '' : 'none';

  if (data.celebration) {
    showCelebration(data.celebration);
  } else if (el.lastGameResult) {
    el.lastGameResult.classList.add('hidden');
    el.lastGameResult.innerHTML = '';
  }

  if (el.posterTile) {
    el.posterTile.style.display = (user.is_host || user.is_owner) ? '' : 'none';
  }
  const heroActions = document.querySelector('.hero-actions');
  if (heroActions) {
    heroActions.style.display = (user.is_host || user.is_owner) ? '' : 'none';
  }
  if (user.can_manage_evening) state.showEvening = state.showEvening || false;

  el.gamesList.innerHTML = games.length
    ? games.map((item) => `
      <button class="game-card ${state.selectedGame?.kod === item.kod ? 'active' : ''}" type="button" data-game="${escapeAttr(item.kod)}">
        <strong>Игра №${escapeHtml(item.kod)}</strong>
        <p>${statusLabel(item.status)} · ${item.zhivye}/${item.kolichestvo || item.players.length} за столом</p>
      </button>
    `).join('')
    : '<p class="muted">Активных игр пока нет.</p>';

  el.gamesList.querySelectorAll('[data-game]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedGame = games.find((item) => String(item.kod) === button.dataset.game) || null;
      renderGame();
      el.gamesList.querySelectorAll('.game-card').forEach((card) => {
        card.classList.toggle('active', card.dataset.game === String(state.selectedGame?.kod));
      });
    });
  });

  el.gamesCount.textContent = games.length;
  renderEveningPanel(data);
  if (data.user?.can_import_rating) {
    el.importRatingSection?.classList.remove('hidden');
  } else {
    el.importRatingSection?.classList.add('hidden');
  }
  renderGame(game);
}

function renderEveningPanel(data) {
  const ev = data.evening;
  const show = !!(data.user?.can_manage_evening && (state.showEvening || ev));
  if (!el.eveningPanel) return;
  if (!show || !ev) {
    el.eveningPanel.classList.add('hidden');
    return;
  }
  el.eveningPanel.classList.remove('hidden');
  const status = ev.finished ? 'завершён' : 'идёт';
  const gamesInfo = ev.win_stats?.vsego ? ` · ${ev.win_stats.vsego} игр` : '';
  el.eveningMeta.textContent = `${ev.klub || 'Клуб'} · ${ev.date} · ${status} · ${ev.player_count} игроков${gamesInfo}`;
  el.eveningPlayers.innerHTML = ev.players?.length
    ? ev.players.map((p) => `<li>${escapeHtml(p.num)}. ${escapeHtml(p.name)}</li>`).join('')
    : '<li class="muted">Состав ещё не зафиксирован</li>';

  el.eveningActions.innerHTML = '';
  if (el.eveningFooter) {
    el.eveningFooter.innerHTML = '';
    el.eveningFooter.classList.add('hidden');
  }
  const addEvBtn = (label, handler, primary = false) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button' + (primary ? ' primary' : '');
    btn.textContent = label;
    btn.addEventListener('click', handler);
    el.eveningActions.appendChild(btn);
  };
  const addFooterBtn = (label, handler, primary = false, extraClass = '') => {
    if (!el.eveningFooter) return;
    el.eveningFooter.classList.remove('hidden');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button' + (primary ? ' primary' : '') + (extraClass ? ' ' + extraClass : '');
    btn.textContent = label;
    btn.addEventListener('click', handler);
    el.eveningFooter.appendChild(btn);
  };

  if (!ev.finished) {
    const rating = ev.live_rating || ev.evening_rating;
    if (ev.win_stats?.vsego) {
      const ws = ev.win_stats;
      const statsEl = document.createElement('p');
      statsEl.className = 'muted';
      statsEl.textContent = `Побед: 🟢${ws.mirnye} 🔴${ws.mafiya} 🎯${ws.manyak}`;
      el.eveningActions.appendChild(statsEl);
    }
    if (rating?.length) {
      const top = rating.slice(0, 5).map((p, i) =>
        `${i + 1}. ${escapeHtml(p.name)} — ${p.pts} очк.`
      ).join('\n');
      const ratEl = document.createElement('pre');
      ratEl.className = 'evening-rating muted';
      ratEl.textContent = top;
      el.eveningActions.appendChild(ratEl);
    }
    ev.anonsy?.forEach((a) => {
      addEvBtn('📢 Анонс ' + (a.vremya || ''), () => vecherAction('from_anons', { anons_id: a.id }));
    });
    addEvBtn('✍️ Сохранить состав', () => {
      const text = el.eveningRosterInput?.value || '';
      if (!text.trim()) {
        el.eveningRosterLabel?.classList.remove('hidden');
        showToast('Введи ники в поле ниже');
        return;
      }
      vecherAction('set_roster', { text });
    }, true);
    addEvBtn('➕ Добавить игроков', () => {
      const text = el.eveningRosterInput?.value || window.prompt('Ники для добавления (через запятую или с новой строки)') || '';
      if (text.trim()) vecherAction('add', { text });
    });
    if (ev.player_count > 0) {
      addEvBtn('➖ Убрать', () => {
        const text = window.prompt('Номер или ник для удаления') || '';
        if (text.trim()) vecherAction('remove', { text });
      });
      addEvBtn('🎲 Игра на ' + ev.player_count, () => vecherAction('create_game'), true);
    }
    if (ev.can_enter_result) {
      addEvBtn('📋 Внести результат игры', () => {
        const suggested = ev.suggested_game_number || 1;
        const usedHint = ev.used_game_numbers?.length
          ? `\nУже внесены: №${ev.used_game_numbers.join(', №')}`
          : '';
        const raw = window.prompt(`Номер игры за вечер?${usedHint}`, String(suggested)) || '';
        const num = parseInt(raw, 10);
        if (!Number.isFinite(num) || num < 1) {
          showToast('Введи номер игры');
          return;
        }
        vecherAction('enter_result', { game_number: num });
      });
    }
    if (rating?.length) {
      addEvBtn('📊 Полный рейтинг вечера', () => vecherAction('full_rating'));
    }
    addEvBtn('📋 Результаты вечера', () => vecherAction('results'));
    el.eveningRosterLabel?.classList.remove('hidden');
    if (el.eveningRosterInput) {
      el.eveningRosterInput.placeholder = ev.player_count > 0
        ? 'Новые ники — для ➕ Добавить\nИли полный список — для ✍️ Сохранить'
        : 'Аня\nБоря\n...';
    }
    if (ev.can_finish !== false) {
      addFooterBtn('🏁 Завершить игровой вечер', confirmFinishEvening, true, 'finish-evening');
    }
  } else {
    if (ev.win_stats?.vsego) {
      const ws = ev.win_stats;
      const statsEl = document.createElement('p');
      statsEl.className = 'muted';
      statsEl.textContent = `Итоги: 🟢${ws.mirnye} 🔴${ws.mafiya} 🎯${ws.manyak} (${ws.vsego} игр)`;
      el.eveningActions.appendChild(statsEl);
    }
    if (ev.poe_name) {
      const poeEl = document.createElement('p');
      poeEl.innerHTML = `⭐ Игрок вечера: <strong>${escapeHtml(ev.poe_name)}</strong>`;
      el.eveningActions.appendChild(poeEl);
    }
    if (ev.evening_rating?.length) {
      const top = ev.evening_rating.slice(0, 5).map((p, i) =>
        `${i + 1}. ${escapeHtml(p.name)} — ${p.pts} очк.`
      ).join('\n');
      const ratEl = document.createElement('pre');
      ratEl.className = 'evening-rating muted';
      ratEl.textContent = top;
      el.eveningActions.appendChild(ratEl);
      addEvBtn('📊 Полный рейтинг вечера', () => vecherAction('full_rating'));
    }
    addEvBtn('📋 Результаты вечера', () => vecherAction('results'));
    el.eveningRosterLabel?.classList.add('hidden');
    addFooterBtn('↩️ Открыть вечер заново', () => vecherAction('reopen'), true);
  }
}

function renderGame(game = state.selectedGame) {
  if (!game) {
    state.nominateArmed = false;
    el.gameTitle.textContent = 'Стол пока пуст';
    el.gameStatus.textContent = 'ожидание';
    el.playersCount.textContent = '0';
    el.aliveCount.textContent = '0';
    el.hostPanel?.classList.add('hidden');
    renderSeats([]);
    return;
  }

  state.selectedGame = game;
  if (!game.host?.speaking_nomer || !game.host?.can_nominate) state.nominateArmed = false;
  el.gameTitle.textContent = `Игра №${game.kod}${game.klub ? ' · ' + game.klub : ''}`;
  el.gameStatus.textContent = `${statusLabel(game.status)} · ${game.faza || 'ожидание'} · день ${game.den || 1}`;
  el.playersCount.textContent = game.players.length;
  el.aliveCount.textContent = game.zhivye;
  renderHostPanel(game);
  renderMyRolePanel(game);
  renderSeats(game.players, game.host);
}

function renderMyRolePanel(game) {
  if (!el.myRolePanel) return;
  if (game.is_host || !game.my_role) {
    el.myRolePanel.classList.add('hidden');
    return;
  }
  el.myRolePanel.classList.remove('hidden');
  if (el.myRoleName) el.myRoleName.textContent = game.my_role;
  setRoleCardImage(el.myRoleCard, el.myRolePanel.querySelector('.role-card-preview'), game.my_role_card_url, game.my_role);
}

function renderHostPanel(game) {
  const host = game.host;
  const isHost = game.is_host && host;
  if (!el.hostPanel) return;
  if (!isHost) {
    el.hostPanel.classList.add('hidden');
    return;
  }
  el.hostPanel.classList.remove('hidden');

  const parts = [];
  if (host.can_submit_roster) parts.push(`Состав: ${host.roster_count}/${host.roster_needed}`);
  if (host.intro?.phase === 'roles') {
    parts.push(`Ночь знакомства ${(host.intro.idx ?? 0) + 1}/${host.intro.total}: ${host.intro.label}`);
  } else if (host.intro?.phase === 'mirny') {
    parts.push(`Мирные: осталось ${host.intro.remaining}`);
  }
  if (host.speaking_nomer) {
    const sec = (state.localTimerKod === String(game.kod) && state.localTimerSpeaking === host.speaking_nomer)
      ? state.localTimerSec
      : (host.timer_sec || 0);
    parts.push(`Говорит №${host.speaking_nomer}${sec > 0 ? ' · ⏱ ' + sec + 'с' : ''}`);
  }
  if (host.speech_hint && host.speaking_nomer) {
    parts.push(host.speech_hint);
  }
  if (host.nominees?.length && (game.faza === 'opravdanie' || game.faza === 'golosovanie')) {
    parts.push(`На голосовании: ${host.nominees.map((n) => '№' + n.nomer).join(', ')}`);
  }
  el.hostMeta.textContent = parts.join(' · ') || 'Управляй игрой здесь — бот не нужен';

  el.hostActions.innerHTML = '';
  const addBtn = (label, handler, primary = false) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button' + (primary ? ' primary' : '');
    btn.textContent = label;
    btn.addEventListener('click', handler);
    el.hostActions.appendChild(btn);
  };

  el.hostRoster?.classList.toggle('hidden', !host.can_submit_roster);
  el.hostIntro?.classList.toggle('hidden', !host.intro || host.intro.phase === 'mirny');
  el.hostMirny?.classList.toggle('hidden', host.intro?.phase !== 'mirny');
  el.hostSummary?.classList.toggle('hidden', !host.night_summary);
  if (host.night_summary && el.hostSummaryText) el.hostSummaryText.textContent = host.night_summary;

  if (host.intro?.phase === 'roles' && el.hostIntroStep) {
    el.hostIntroStep.textContent = `${host.intro.label} (${host.intro.idx + 1}/${host.intro.total})`;
    if (el.hostIntroHint) el.hostIntroHint.textContent = 'Нажми на место игрока с этой ролью';
    setRoleCardImage(el.hostIntroCard, el.hostIntroCardWrap, host.intro.role_card_url, host.intro.rol);
  } else if (el.hostIntroCardWrap) {
    el.hostIntroCardWrap.classList.add('hidden');
  }

  if (host.can_submit_roster && el.rosterInput && !el.rosterInput.value) {
    el.rosterInput.placeholder = Array.from({ length: host.roster_needed }, (_, i) => 'Игрок ' + (i + 1)).join('\n');
  }
  if (host.can_confirm_vecher_roster) {
    addBtn('📋 Состав из вечера', () => hostAction('confirm_vecher_roster'), true);
  }
  if (host.can_start_znakomstvo) {
    addBtn(host.club_auto_first ? '👋 Представление с №1' : '👋 Начать представление', () => hostAction('start_znakomstvo'), true);
  }
  if (host.can_pick_first && host.pick_first_faza === 'znakomstvo' && !host.can_start_znakomstvo) {
    addBtn('🎲 Кто начинает — случайно', () => hostAction('pick_first_auto', { faza: 'znakomstvo' }));
  }
  if (host.can_go_voting && !host.speaking_nomer) {
    addBtn('💥 На голосование', () => {
      state.nominateArmed = true;
      state.nominateMode = 'to_vote';
      renderGame(game);
      showToast('Нажми на место игрока для выставления');
    });
  }
  if (host.can_start_voting) addBtn('🗳 Голосование', () => hostAction('start_voting'), true);
  if (host.intro?.phase === 'mirny') {
    const cands = host.intro.candidates || [];
    if (el.mirnyCandidates) {
      el.mirnyCandidates.textContent = cands.length
        ? ('Остались без роли:\n' + cands.map((p) => '№' + p.nomer + ' ' + p.name).join('\n') + '\n\nЭто мирные жители?')
        : 'Все роли уже назначены.';
    }
    const canConfirm = !!host.intro.can_confirm_all;
    el.confirmMirnyBtn?.classList.toggle('hidden', !canConfirm);
    el.editMirnyBtn?.classList.toggle('hidden', false);
    if (canConfirm) {
      el.mirnyEditWrap?.classList.add('hidden');
      el.submitMirnyBtn?.classList.add('hidden');
    }
    if (el.mirnyInput && !el.mirnyInput.value) {
      el.mirnyInput.placeholder = Array.from({ length: host.intro.remaining || 0 }, (_, i) => 'Мирный ' + (i + 1)).join('\n');
    }
  } else if (el.mirnyCandidates) {
    el.mirnyCandidates.textContent = '';
  }

  if (host.can_start_intro) addBtn('🌙 Ночь знакомства', () => hostAction('intro_start'), true);
  if (host.can_pick_first) {
    addBtn('🎲 Кто начинает — случайно', () => hostAction('pick_first_auto', { faza: host.pick_first_faza }), true);
  }
  if (host.speaking_nomer) {
    addBtn('⏭ Пас (без выставления)', () => {
      state.nominateArmed = false;
      hostAction('pass');
    });
  }
  if (host.can_nominate) {
    if (state.nominateArmed) {
      addBtn('✕ Отмена выставления', () => {
        state.nominateArmed = false;
        renderGame(game);
        showToast('Режим выставления выключен');
      });
    } else {
      addBtn('💥 Выставить игрока', () => {
        state.nominateArmed = true;
        renderGame(game);
        showToast('Нажми на место игрока — или «Пас» без выставления');
      });
    }
  }
  if (host.can_undo_nominate) addBtn('❌ Отменить выставление', () => hostAction('undo_nominate'));
  if (host.can_edit_nominees) addBtn('✏️ Редактировать список', () => showToast('На панели речи: «✏️ Редактировать список»'));
  if (host.can_foul) addBtn('⚠️ Фол / замечание', () => {
    state.foulArmed = true;
    renderGame(game);
    showToast('Нажми на место игрока для фола');
  });
  if (host.can_view_immunity) addBtn('🛡 Иммунитет', () => hostAction('immunity'));
  if (host.can_skip_krug) addBtn('⏭ ' + (host.skip_krug_label || 'Пропустить круг'), () => hostAction('skip_krug'));
  if (host.can_night) addBtn('🌙 Ночь', () => hostAction('night'), true);
  if (host.can_finish_night) addBtn('🌟 Итоги ночи', () => hostAction('night_finish'), true);

  if (host.night?.guided) {
    el.hostNight?.classList.remove('hidden');
    const step = (host.night.step ?? 0) + 1;
    el.nightStepLabel.textContent = host.night.done
      ? 'Все роли пройдены — нажми «Итоги ночи»'
      : (host.night.step_label ? `Шаг ${step}/${host.night.total}: ${host.night.step_label}` : '');
    el.nightPickActions.innerHTML = '';
    if (!host.night.done) {
      if (host.night.can_skip) {
        const skipBtn = document.createElement('button');
        skipBtn.type = 'button';
        skipBtn.className = 'button';
        skipBtn.textContent = '⏭ Пропустить выстрел';
        skipBtn.addEventListener('click', () => hostAction('night_skip'));
        el.nightPickActions.appendChild(skipBtn);
      }
      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'button';
      prevBtn.textContent = '← Назад';
      prevBtn.addEventListener('click', () => hostAction('night_prev'));
      el.nightPickActions.appendChild(prevBtn);
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'button primary';
      nextBtn.textContent = 'Далее →';
      nextBtn.addEventListener('click', () => hostAction('night_next'));
      el.nightPickActions.appendChild(nextBtn);
    }
  } else {
    el.hostNight?.classList.add('hidden');
  }

  if (host.voting_active && el.hostVoting) {
    el.hostVoting.classList.remove('hidden');
    el.votingNominees.innerHTML = (host.voting_nominees || []).map((n) => `
      <div class="vote-row">
        <span>№${escapeHtml(n.nomer)} ${escapeHtml(n.name)}</span>
        <input type="number" min="0" class="vote-input" data-nomer="${escapeAttr(n.nomer)}" value="${n.votes ?? ''}" />
        <button type="button" class="button vote-save" data-nomer="${escapeAttr(n.nomer)}">OK</button>
      </div>
    `).join('');
    el.votingNominees.querySelectorAll('.vote-save').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nomer = btn.dataset.nomer;
        const input = el.votingNominees.querySelector(`.vote-input[data-nomer="${nomer}"]`);
        hostAction('vote_set', { nomer, count: input?.value ?? 0 });
      });
    });
  } else {
    el.hostVoting?.classList.add('hidden');
  }

  const user = state.data?.user;
  const evEvening = state.data?.evening;
  const evForGame = !evEvening || String(evEvening.klub_id || state.selectedKlubId) === String(game?.klub_id);
  if (game?.klub_id && user?.can_manage_evening && evForGame && (!evEvening || !evEvening.finished)) {
    const finishBtn = document.createElement('button');
    finishBtn.type = 'button';
    finishBtn.className = 'button primary host-finish-evening';
    finishBtn.textContent = '🏁 Завершить игровой вечер';
    finishBtn.addEventListener('click', async () => {
      if (game.klub_id !== state.selectedKlubId) {
        state.selectedKlubId = game.klub_id;
        await loadState(game.klub_id, true);
      }
      state.showEvening = true;
      confirmFinishEvening();
    });
    el.hostActions.appendChild(finishBtn);
  }
}

function renderSeats(players, hostMeta) {
  el.table.querySelectorAll('.seat').forEach((seat) => seat.remove());
  const rectPad = 12;
  const total = Math.max(players.length, 1);
  const clickMode = hostClickMode(hostMeta);
  // На узких экранах (телефон) и при большом столе круговая раскладка сбивается —
  // используем аккуратную сетку мест.
  const listMode = (typeof window !== 'undefined' && window.innerWidth <= 760) || total > 12;
  el.table.classList.toggle('table-list', listMode);

  players.forEach((player, index) => {
    const angle = (Math.PI * 2 * index / total) - Math.PI / 2;
    const x = 50 + Math.cos(angle) * 37;
    const y = 50 + Math.sin(angle) * 39;
    const clickable = clickMode && player.status === 'v_igre' &&
      !(clickMode === 'nominate' && player.speaking) &&
      !(clickMode === 'intro_assign' && player.role);
    const seat = document.createElement('button');
    seat.type = 'button';
    seat.className = `seat ${listMode ? 'seat-flow ' : ''}${player.status === 'v_igre' ? '' : 'dead'}${player.speaking ? ' speaking' : ''}${clickable ? ' host-target' : ''}`;
    if (!listMode) {
      seat.style.left = `clamp(${rectPad}px, ${x}%, calc(100% - 148px))`;
      seat.style.top = `clamp(${rectPad}px, ${y}%, calc(100% - 86px))`;
    }
    const roleLine = player.role ? `<div class="seat-role">${escapeHtml(player.role)}</div>` : '';
    seat.innerHTML = `
      <div class="seat-num">№${escapeHtml(player.nomer || index + 1)}</div>
      <div class="seat-name">${escapeHtml(player.name || 'Игрок')}</div>
      ${roleLine}
      <div class="seat-meta">${player.status === 'v_igre' ? 'в игре' : 'выбыл'} · фолы: ${escapeHtml(player.foly || 0)}</div>
    `;
    if (player.role_card_url) {
      loadAuthImage(player.role_card_url).then((objectUrl) => {
        if (!objectUrl) return;
        const img = document.createElement('img');
        img.className = 'seat-role-card';
        img.src = objectUrl;
        img.alt = player.role || '';
        seat.insertBefore(img, seat.firstChild);
      });
    }
    if (clickable) {
      seat.addEventListener('click', () => {
        if (clickMode === 'pick_first') hostAction('pick_first', { nomer: player.nomer, faza: hostMeta.pick_first_faza });
        else if (clickMode === 'intro_assign') hostAction('intro_assign', { nomer: player.nomer });
        else if (clickMode === 'intro_mirny') hostAction('intro_mirny', { nomer: player.nomer });
        else if (clickMode === 'nominate') {
          state.nominateArmed = false;
          state.nominateMode = null;
          hostAction('nominate', { nomer: player.nomer });
        }
        else if (clickMode === 'to_vote') {
          state.nominateArmed = false;
          state.nominateMode = null;
          hostAction('nominate_to_vote', { nomer: player.nomer });
        }
        else if (clickMode === 'foul') {
          state.foulArmed = false;
          hostAction('give_foul', { nomer: player.nomer });
        }
        else if (clickMode === 'night_pick') hostAction('night_pick', { nomer: player.nomer });
      });
    }
    if (player.avatar_url) {
      loadAvatarImage(player.avatar_url).then((objectUrl) => {
        if (!objectUrl) return;
        const img = document.createElement('img');
        img.className = 'seat-avatar';
        img.src = objectUrl;
        img.alt = '';
        seat.prepend(img);
      });
    }
    el.table.appendChild(seat);
  });
}

function renderError(error) {
  el.profileName.textContent = 'Не удалось открыть панель';
  el.profileMeta.textContent = 'Проверь, что mini app открыт из Telegram';
  el.clubsList.innerHTML = '<p class="muted">Авторизация Telegram не прошла.</p>';
  el.gamesList.innerHTML = `<p class="muted">${escapeHtml(error.message || 'Ошибка загрузки')}</p>`;
  showToast('Mini app ждёт запуск из Telegram.');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

applyTheme(state.theme);
loadState();
setInterval(() => {
  if (tg?.initData) loadState(state.selectedKlubId, true);
}, 12000);
setInterval(tickLocalTimer, 1000);
