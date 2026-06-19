const tg = window.Telegram && window.Telegram.WebApp;
const THEME_KEY = 'pm_miniapp_theme';

const state = {
  data: null,
  selectedGame: null,
  selectedKlubId: null,
  theme: localStorage.getItem(THEME_KEY) || 'default',
};

if (tg) {
  tg.ready();
  tg.expand();
  tg.MainButton.setText('Открыть меню бота');
  tg.MainButton.onClick(() => sendAction('open_menu'));
  tg.MainButton.show();
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
    sendAction(action);
  });
});

if (el.celebrationClose) {
  el.celebrationClose.addEventListener('click', () => {
    el.celebrationOverlay?.classList.add('hidden');
    sendAction('ack_celebration');
  });
}

if (el.posterRender) el.posterRender.addEventListener('click', renderPosterCanvas);

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
    return;
  }

  showToast('Отправляю действие в бот...');
  try {
    const json = await miniappAction(action, extra);
    showToast(json.message || 'Готово, смотри бот');
    setTimeout(() => tg.close(), 650);
  } catch (error) {
    showToast('Не удалось отправить действие. Попробуй ещё раз.');
  }
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
    if (!state.selectedGame) state.selectedGame = json.data.games?.[0] || null;
    render();
  } catch (error) {
    if (!silent) renderError(error);
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

async function loadAvatarImage(url) {
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

  renderMyRating(data.rating?.my);
  renderBestGame(data.rating?.best_game);
  renderRoleStats(data.rating?.role_stats);
  renderGifts(data.bonuses);
  renderClubTop(data.rating?.top);

  if (data.celebration) {
    showCelebration(data.celebration);
  } else if (el.lastGameResult) {
    el.lastGameResult.classList.add('hidden');
    el.lastGameResult.innerHTML = '';
  }

  if (el.posterTile) {
    el.posterTile.style.display = (user.is_host || user.is_owner) ? '' : 'none';
  }

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
  renderGame(game);
}

function renderGame(game = state.selectedGame) {
  if (!game) {
    el.gameTitle.textContent = 'Стол пока пуст';
    el.gameStatus.textContent = 'ожидание';
    el.playersCount.textContent = '0';
    el.aliveCount.textContent = '0';
    renderSeats([]);
    return;
  }

  state.selectedGame = game;
  el.gameTitle.textContent = `Игра №${game.kod}`;
  el.gameStatus.textContent = `${statusLabel(game.status)} · день ${game.den || 1}`;
  el.playersCount.textContent = game.players.length;
  el.aliveCount.textContent = game.zhivye;
  renderSeats(game.players);
}

function renderSeats(players) {
  el.table.querySelectorAll('.seat').forEach((seat) => seat.remove());
  const rectPad = 12;
  const total = Math.max(players.length, 1);

  players.forEach((player, index) => {
    const angle = (Math.PI * 2 * index / total) - Math.PI / 2;
    const x = 50 + Math.cos(angle) * 37;
    const y = 50 + Math.sin(angle) * 39;
    const seat = document.createElement('button');
    seat.type = 'button';
    seat.className = `seat ${player.status === 'v_igre' ? '' : 'dead'}`;
    seat.style.left = `clamp(${rectPad}px, ${x}%, calc(100% - 148px))`;
    seat.style.top = `clamp(${rectPad}px, ${y}%, calc(100% - 86px))`;
    seat.innerHTML = `
      <div class="seat-num">№${escapeHtml(player.nomer || index + 1)}</div>
      <div class="seat-name">${escapeHtml(player.name || 'Игрок')}</div>
      <div class="seat-meta">${player.status === 'v_igre' ? 'в игре' : 'выбыл'} · фолы: ${escapeHtml(player.foly || 0)}</div>
    `;
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
