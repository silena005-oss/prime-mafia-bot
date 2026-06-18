const tg = window.Telegram && window.Telegram.WebApp;
const THEME_KEY = 'pm_miniapp_theme';
const USER_THEMES = ['default', 'red', 'black_gold', 'blue', 'ellada'];

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
  clubTop: document.getElementById('clubTop'),
  toast: document.getElementById('toast'),
};

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => sendAction(button.dataset.action));
});

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
  return state.theme;
}

function renderThemes(themes) {
  const list = (themes || []).filter((t) => USER_THEMES.includes(t.id));
  el.themeGrid.innerHTML = list.map((theme) => `
    <button type="button" class="theme-chip" data-theme-id="${escapeAttr(theme.id)}" title="${escapeAttr(theme.label)}">
      <span class="theme-swatch" style="background:${escapeAttr(theme.accent)}"></span>
      <span>${escapeHtml(theme.label)}</span>
    </button>
  `).join('');

  el.themeGrid.querySelectorAll('[data-theme-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.themeId);
      showToast('Тема: ' + btn.textContent.trim());
    });
  });
  applyTheme(state.theme);
}

async function sendAction(action, extra = {}) {
  if (!tg || !tg.initData) {
    showToast('Открой mini app внутри Telegram, чтобы выполнить действие.');
    return;
  }

  showToast('Отправляю действие в бот...');
  try {
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
    showToast(json.message || 'Готово, смотри бот');
    setTimeout(() => tg.close(), 650);
  } catch (error) {
    showToast('Не удалось отправить действие. Попробуй ещё раз.');
  }
}

async function loadState(klubId) {
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
    state.selectedGame = json.data.games?.[0] || null;
    render();
  } catch (error) {
    renderError(error);
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
  if (!best) {
    el.bestGame.innerHTML = '<p class="muted">Лучшая игра появится после первых результатов.</p>';
    return;
  }
  el.bestGame.innerHTML = `
    <div class="best-game-inner">
      <div class="best-points">+${best.points}</div>
      <div>
        <strong>${escapeHtml(best.role)}</strong>
        <p>${best.won ? 'Победа' : 'Поражение'}${best.club ? ' · ' + escapeHtml(best.club) : ''}</p>
        ${best.best_move ? '<p class="best-move">⭐ Лучший ход</p>' : ''}
      </div>
    </div>
  `;
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
        <p>${club.branded ? '🎨 стилизация клуба' : 'Доступ ведущего'}</p>
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
  renderClubTop(data.rating?.top);

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
