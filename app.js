// ============ Telegram ============
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// ============ Хранилище (CloudStorage Telegram + страховка localStorage) ============
const store = {
  get(key) {
    return new Promise((resolve) => {
      try {
        tg.CloudStorage.getItem(key, (err, value) => {
          resolve(!err && value !== null ? value : localStorage.getItem(key));
        });
      } catch { resolve(localStorage.getItem(key)); }
    });
  },
  set(key, value) {
    return new Promise((resolve) => {
      try { tg.CloudStorage.setItem(key, value, () => resolve()); } catch {}
      try { localStorage.setItem(key, value); } catch {}
      resolve();
    });
  }
};

// ============ Состояние ============
let queue = [];
let currentIndex = -1;
let favorites = [];
let recent = [];

const $ = (id) => document.getElementById(id);
const audio = $('audio');

// Загружаем сохраненные лайки и историю
(async () => {
  favorites = JSON.parse((await store.get('sm_favorites')) || '[]');
  recent = JSON.parse((await store.get('sm_recent')) || '[]');
  renderList('fav-list', favorites);
  renderList('recent-list', recent);
})();

// ============ Вкладки ============
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    $('tab-' + btn.dataset.tab).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  };
});

// ============ Поиск (iTunes API) ============
async function doSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;
  const box = $('search-results');
  box.innerHTML = '<p class="hint">Ищу в космосе... 🛰️</p>';
  try {
    const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(q)
      + '&media=music&entity=song&limit=25&country=ru';
    const res = await fetch(url);
    const data = await res.json();
    if (!data.results || !data.results.length) {
      box.innerHTML = '<p class="hint">Ничего не нашлось 🤷</p>';
      return;
    }
    queue = data.results.map(r => ({
      id: 'it_' + r.trackId,
      title: r.trackName,
      artist: r.artistName,
      album: r.collectionName || '',
      cover: (r.artworkUrl100 || '').replace('100x100', '600x600'),
      url: r.previewUrl
    }));
    renderList('search-results', queue);
  } catch {
    box.innerHTML = '<p class="hint">Ошибка сети. Попробуй ещё раз</p>';
  }
}
$('search-btn').onclick = doSearch;
$('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

// ============ Карточки треков ============
function trackCard(t, index, listRef) {
  const el = document.createElement('div');
  el.className = 'track';
  const isFav = favorites.some(f => f.id === t.id);
  el.innerHTML = `
    <img src="${t.cover}" alt="">
    <div class="t-info">
      <div class="t-title">${t.title}</div>
      <div class="t-artist">${t.artist}</div>
    </div>
    <button class="fav-btn">${isFav ? '❤️' : '🤍'}</button>`;
  el.querySelector('.fav-btn').onclick = (e) => {
    e.stopPropagation();
    toggleFavorite(t);
    const now = favorites.some(f => f.id === t.id);
    e.target.textContent = now ? '❤️' : '🤍';
  };
  el.onclick = () => playFrom(listRef, index);
  return el;
}

function renderList(containerId, list) {
  const box = $(containerId);
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<p class="hint">Пока пусто</p>';
    return;
  }
  list.forEach((t, i) => box.appendChild(trackCard(t, i, list)));
}

// ============ Избранное и недавние ============
async function toggleFavorite(t) {
  const i = favorites.findIndex(f => f.id === t.id);
  if (i >= 0) favorites.splice(i, 1); else favorites.push(t);
  await store.set('sm_favorites', JSON.stringify(favorites));
  renderList('fav-list', favorites);
}

async function pushRecent(t) {
  recent = recent.filter(x => x.id !== t.id);
  recent.unshift(t);
  recent = recent.slice(0, 20);
  await store.set('sm_recent', JSON.stringify(recent));
  renderList('recent-list', recent);
}

// ============ Плеер ============
function playFrom(list, index) {
  queue = list;
  currentIndex = index;
  playCurrent();
  pushRecent(queue[currentIndex]);
}

function playCurrent() {
  const t = queue[currentIndex];
  if (!t) return;
  audio.src = t.url;
  audio.play();
  updatePlayerUI(t);
}

function changeTrack(dir) {
  if (!queue.length) return;
  currentIndex = (currentIndex + dir + queue.length) % queue.length;
  playCurrent();
}

function updatePlayerUI(t) {
  $('mini-player').classList.remove('hidden');
  $('mp-cover').src = t.cover;
  $('mp-title').textContent = t.title;
  $('mp-artist').textContent = t.artist;
  $('fp-cover').src = t.cover;
  $('fp-title').textContent = t.title;
  $('fp-artist').textContent = t.artist;
  $('fp-fav').textContent = favorites.some(f => f.id === t.id) ? '❤️' : '🤍';
}

// ============ MediaSession: музыка на заблокированном экране ============
function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork: [{ src: t.cover, sizes: '600x600', type: 'image/jpeg' }]
  });
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => changeTrack(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => changeTrack(1));
}

audio.addEventListener('play', () => {
  $('mp-play').textContent = '⏸';
  $('fp-play').textContent = '⏸';
  if (queue[currentIndex]) updateMediaSession(queue[currentIndex]);
});
audio.addEventListener('pause', () => {
  $('mp-play').textContent = '▶';
  $('fp-play').textContent = '▶';
});
audio.addEventListener('ended', () => changeTrack(1));
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  $('fp-progress').value = (audio.currentTime / audio.duration) * 100;
  $('fp-time').textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
});

function fmt(sec) {
  return Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');
}

// ============ Кнопки ============
function togglePlay() {
  if (!audio.src) return;
  audio.paused ? audio.play() : audio.pause();
}
$('mp-play').onclick = togglePlay;
$('fp-play').onclick = togglePlay;
$('mp-expand').onclick = () => $('full-player').classList.remove('hidden');
$('mp-info').onclick = () => $('full-player').classList.remove('hidden');
$('fp-close').onclick = () => $('full-player').classList.add('hidden');
$('fp-prev').onclick = () => changeTrack(-1);
$('fp-next').onclick = () => changeTrack(1);
$('fp-fav').onclick = () => {
  const t = queue[currentIndex];
  if (!t) return;
  toggleFavorite(t);
  updatePlayerUI(t);
};
$('fp-progress').oninput = () => {
  if (audio.duration) audio.currentTime = ($('fp-progress').value / 100) * audio.duration;
};
