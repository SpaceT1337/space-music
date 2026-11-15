// ============ Telegram ============
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// ============ Хранилище (CloudStorage Telegram + localStorage как страховка) ============
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

// ============ ИСТОЧНИК 1: Audius (полные треки) ============
let audiusHost = null;

async function getAudiusHost() {
  if (audiusHost) return audiusHost;
  try {
    const res = await fetch('https://api.audius.co');
    const j = await res.json();
    if (j.data && j.data.length) { audiusHost = j.data[0]; return audiusHost; }
  } catch (e) { /* ниже запасной вариант */ }
  audiusHost = 'https://discoveryprovider.audius.co';
  return audiusHost;
}

async function searchAudius(query) {
  const host = await getAudiusHost();
  const url = host + '/v1/tracks/search?query=' + encodeURIComponent(query) + '&app_name=SpaceMusic';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Audius: ' + res.status);
  const j = await res.json();
  return (j.data || [])
    .filter(t => t && t.is_streamable !== false && !t.is_delete)
    .map(t => ({
      id: 'au_' + t.id,
      title: t.title,
      artist: (t.user && t.user.name) || 'Audius',
      album: 'Audius',
      cover: (t.artwork && (t.artwork['480x480.jpg'] || t.artwork['150x150.jpg'])) || '',
      url: host + '/v1/tracks/' + t.id + '/stream?app_name=SpaceMusic',
      full: true
    }));
}

// ============ ИСТОЧНИК 2: iTunes (обложки, метаданные, превью 30 сек) ============
// JSONP вместо fetch — работает в любом браузере без ограничений CORS
function itunesSearch(query) {
  return new Promise((resolve, reject) => {
    const cb = 'smCb_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 10000);
    function cleanup() {
      clearTimeout(timer);
      try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      script.remove();
    }
    window[cb] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error('network')); };
    script.src = 'https://itunes.apple.com/search?term=' + encodeURIComponent(query)
      + '&media=music&entity=song&limit=25&country=ru&callback=' + cb;
    document.head.appendChild(script);
  });
}

async function searchItunes(query) {
  const data = await itunesSearch(query);
  return (data.results || [])
    .map(r => ({
      id: 'it_' + r.trackId,
      title: r.trackName,
      artist: r.artistName,
      album: r.collectionName || '',
      cover: (r.artworkUrl100 || '').replace('100x100', '600x600'),
      url: r.previewUrl,
      full: false
    }))
    .filter(t => t.url);
}

// ============ Поиск ============
async function doSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;
  const box = $('search-results');
  box.innerHTML = '<p class="hint">Ищу в космосе... 🛰️</p>';

  let fullTracks = [];
  let previews = [];
  try { fullTracks = await searchAudius(q); } catch (e) {}
  try { previews = await searchItunes(q); } catch (e) {}

  queue = [...fullTracks, ...previews];

  if (!queue.length) {
    box.innerHTML = '<p class="hint">Ничего не нашлось 🤷</p>';
    return;
  }
  renderList('search-results', queue);
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
      <div class="t-artist">${t.artist} <span class="badge ${t.full ? 'b-full' : 'b-preview'}">${t.full ? 'FULL' : '30 сек'}</span></div>
    </div>
    <button class="fav-btn">${isFav ? '❤️' : '🤍'}</button>`;
  el.querySelector('.fav-btn').onclick = (e) => {
    e.stopPropagation();
    toggleFavorite(t);
    e.target.textContent = favorites.some(f => f.id === t.id) ? '❤️' : '🤍';
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
  $('mp-artist').textContent = t.artist + (t.full ? ' · FULL' : ' · превью 30 сек');
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
audio.addEventListener('error', () => {
  // Если трек не загрузился — тихо переключаемся на следующий (если их несколько)
  if (queue.length > 1) changeTrack(1);
});
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
