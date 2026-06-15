const tg = window.Telegram && window.Telegram.WebApp;
const state = {
  data: null,
  selectedGame: null,
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
  clubsList: document.getElementById('clubsList'),
  gamesList: document.getElementById('gamesList'),
  gameTitle: document.getElementById('gameTitle'),
  gameStatus: document.getElementById('gameStatus'),
  table: document.getElementById('table'),
  gamesCount: document.getElementById('gamesCount'),
  playersCount: document.getElementById('playersCount'),
  aliveCount: document.getElementById('aliveCount'),
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

async function loadState() {
  try {
    const response = await fetch('/api/miniapp/state', {
      headers: {
        'x-telegram-init-data': tg ? tg.initData : '',
      },
    });
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.error || 'load_failed');
    state.data = json.data;
    state.selectedGame = json.data.games[0] || null;
    render();
  } catch (error) {
    renderError(error);
  }
}

function render() {
  const data = state.data;
  const user = data.user;
  const games = data.games || [];
  const clubs = data.clubs || [];
  const game = state.selectedGame || games[0] || null;

  el.profileName.textContent = user.name;
  el.profileMeta.textContent = user.registered ? 'Telegram подтверждён' : 'Профиль ещё не зарегистрирован';
  el.avatar.textContent = initials(user.name);

  el.clubsList.innerHTML = clubs.length
    ? clubs.map((club) => `
      <button class="club-card" type="button">
        <strong>${escapeHtml(club.nazvaniye || 'Клуб')}</strong>
        <p>Доступ ведущего</p>
      </button>
    `).join('')
    : '<p>Клубы пока не найдены.</p>';

  el.gamesList.innerHTML = games.length
    ? games.map((item) => `
      <button class="game-card" type="button" data-game="${escapeAttr(item.kod)}">
        <strong>Игра №${escapeHtml(item.kod)}</strong>
        <p>${statusLabel(item.status)} · ${item.zhivye}/${item.kolichestvo || item.players.length} за столом</p>
      </button>
    `).join('')
    : '<p>Активных игр пока нет. Создай игру в боте или начни игровой вечер.</p>';

  document.querySelectorAll('[data-game]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedGame = games.find((item) => String(item.kod) === button.dataset.game) || null;
      renderGame();
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
    seat.addEventListener('click', () => {
      showToast(`${player.name || 'Игрок'} · управление игроком добавим следующим шагом`);
    });
    el.table.appendChild(seat);
  });
}

function renderError(error) {
  el.profileName.textContent = 'Не удалось открыть панель';
  el.profileMeta.textContent = 'Проверь, что mini app открыт из Telegram';
  el.clubsList.innerHTML = '<p>Авторизация Telegram не прошла.</p>';
  el.gamesList.innerHTML = `<p>${escapeHtml(error.message || 'Ошибка загрузки')}</p>`;
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

loadState();
