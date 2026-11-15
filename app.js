// ============ Telegram ============
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

function notify(msg) {
  try { tg.showAlert(msg); } catch (e) { alert(msg); }
}

// ============ Хранилище (CloudStorage + localStorage) ============
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

// ============ Универсальный JSONP (работает без CORS) ============
function jsonp(url) {
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
    const sep = url.includes('?') ? '&' : '?';
    script.src = url + sep + 'callback=' + cb;
    document.head.appendChild(script);
  });
}

// ============ Состояние ============
let queue = [];
let currentIndex = -1;
let favorites = [];
let recent = [];
let lastfmKey = '';

const $ = (id) => document.getElementById(id);
const audio = $('audio');

(async () => {
  favorites = JSON.parse((await store.get('sm_favorites')) || '[]');
  recent = JSON.parse((await store.get('sm_recent')) || '[]');
  lastfmKey = (await store.get('sm_lastfm_key')) || '';
  $('lastfm-key-input').value = lastfmKey;
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
    if (btn.dataset.tab === 'events') loadEventsTab();
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
  } catch (e) {}
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

// ============ ИСТОЧНИК 2: iTunes (метаданные + превью 30 сек) ============
async function searchItunes(query) {
  const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(query)
    + '&media=music&entity=song&limit=25&country=ru';
  const data = await jsonp(url);
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

// ============ Last.fm (карточки артистов) ============
async function lastfm(method, params) {
  if (!lastfmKey) throw new Error('no-key');
  const qs = new URLSearchParams(params).toString();
  const url = 'https://ws.audioscrobbler.com/2.0/?method=' + method
    + '&api_key=' + lastfmKey + '&format=json&' + qs;
  return await jsonp(url);
}

function cleanBio(html) {
  if (!html) return '';
  return html.replace(/<a[\s\S]*?<\/a>/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ============ Bandsintown (концерты) ============
async function bitEvents(artist) {
  const name = encodeURIComponent(artist);
  const base = 'https://rest.bandsintown.com/artists/' + name + '/events?app_id=spacemusic_personal';
  try {
    const res = await fetch(base);
    if (res.ok) {
      const j = await res.json();
      return Array.isArray(j) ? j : [];
    }
  } catch (e) { /* пробуем JSONP */ }
  const j = await jsonp(base);
  return Array.isArray(j) ? j : [];
}

// ============ Поиск ============
async function doSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;
  const box = $('search-results');
  box.innerHTML = '<p class="hint">Ищу в космосе... 🛰️</p>';
  let fullTracks = [], previews = [];
  try { fullTracks = await searchAudius(q); } catch (e) {}
  try { previews = await searchItunes(q); } catch (e) {}
  queue = [...fullTracks, ...previews];
  if (!queue.length) { box.innerHTML = '<p class="hint">Ничего не нашлось 🤷</p>'; return; }
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
  // Клик по имени артиста → карточка артиста
  el.querySelector('.t-artist').onclick = (e) => {
    e.stopPropagation();
    openArtist(t.artist);
  };
  el.onclick = () => playFrom(listRef, index);
  return el;
}

function renderList(containerId, list) {
  const box = $(containerId);
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p class="hint">Пока пусто</p>'; return; }
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

// ============ Карточка артиста ============
async function openArtist(name) {
  $('artist-view').classList.remove('hidden');
  $('av-loading').classList.remove('hidden');
  $('av-photo').classList.add('hidden');
  $('av-name').textContent = name;
  $('av-listeners').textContent = '';
  $('av-bio').textContent = '';
  $('av-top').innerHTML = '';
  $('av-events').innerHTML = '<p class="hint">Загружаю афишу... 🛰️</p>';
  $('artist-view').scrollTop = 0;

  // Фото, био, статистика
  try {
    const info = await lastfm('artist.getinfo', { artist: name });
    const imgs = (info.artist && info.artist.image) || [];
    const ph = (imgs.find(i => i.size === 'mega') || imgs.find(i => i.size === 'extralarge') || {})['#text'];
    if (ph) { $('av-photo').src = ph; $('av-photo').classList.remove('hidden'); }
    $('av-bio').textContent = cleanBio(info.artist && info.artist.bio && info.artist.bio.summary);
    const st = (info.artist && info.artist.stats) || {};
    $('av-listeners').textContent = '👥 ' + Number(st.listeners || 0).toLocaleString('ru-RU')
      + ' слушателей · ' + Number(st.playcount || 0).toLocaleString('ru-RU') + ' прослушиваний';
  } catch (e) {
    $('av-bio').textContent = lastfmKey
      ? 'Не удалось загрузить информацию об артисте'
      : 'Добавь ключ Last.fm в ⚙️ Настройках («Моя музыка»), чтобы видеть фото, био и топ-треки.';
  }

  // Топ-треки
  try {
    const tt = await lastfm('artist.gettoptracks', { artist: name, limit: 5 });
    const tracks = (tt.toptracks && tt.toptracks.track) || [];
    const box = $('av-top');
    box.innerHTML = '';
    if (Array.isArray(tracks) && tracks.length) {
      tracks.forEach((tr, i) => {
        const row = document.createElement('div');
        row.className = 'top-row';
        row.innerHTML = '<span class="n">' + (i + 1) + '</span><span>' + tr.name + '</span>';
        row.onclick = () => playTopTrack(name, tr.name);
        box.appendChild(row);
      });
    } else {
      box.innerHTML = '<p class="hint">Не найдено</p>';
    }
  } catch (e) {
    $('av-top').innerHTML = '<p class="hint">Нужен ключ Last.fm в настройках ⚙️</p>';
  }

  $('av-loading').classList.add('hidden');

  // Концерты
  try {
    const events = await bitEvents(name);
    renderEvents('av-events', events, name);
  } catch (e) {
    $('av-events').innerHTML = '<p class="hint">Не удалось загрузить афишу 😔</p>';
  }
}

async function playTopTrack(artist, title) {
  notify('Ищу: ' + title);
  let full = [], prev = [];
  try { full = await searchAudius(title + ' ' + artist); } catch (e) {}
  try { prev = await searchItunes(title + ' ' + artist); } catch (e) {}
  const q = [...full, ...prev];
  if (!q.length) { notify('Ничего не нашлось 🤷'); return; }
  queue = q;
  currentIndex = 0;
  playCurrent();
  pushRecent(queue[0]);
  $('artist-view').classList.add('hidden');
}

// ============ Концерты ============
function renderEvents(containerId, events, fallbackArtist) {
  const box = $(containerId);
  box.innerHTML = '';
  const list = (events || [])
    .slice()
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
    .slice(0, 30);
  if (!list.length) { box.innerHTML = '<p class="hint">Концертов не запланировано 🌌</p>'; return; }
  list.forEach(ev => {
    const v = ev.venue || {};
    const d = new Date(ev.datetime);
    const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      + ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const head = (ev.lineup && ev.lineup[0]) || ev._artist || fallbackArtist || '';
    const ticket = (ev.offers && ev.offers[0] && ev.offers[0].url) || ev.url || '';
    const card = document.createElement('div');
    card.className = 'ev-card';
    card.innerHTML =
      '<div class="ev-date">' + dateStr + '</div>' +
      '<div class="ev-artist">' + head + '</div>' +
      '<div class="ev-place">' + (v.name || '') + (v.city ? ' · ' + v.city : '') + (v.country ? ', ' + v.country : '') + '</div>';
    if (ticket) {
      const btn = document.createElement('button');
      btn.className = 'ev-ticket';
      btn.textContent = 'Билеты';
      btn.onclick = () => { try { tg.openLink(ticket); } catch (e) { window.open(ticket, '_blank'); } };
      card.appendChild(btn);
    }
    box.appendChild(card);
  });
}

let eventsLoading = false;
async function loadEventsTab() {
  if (eventsLoading) return;
  eventsLoading = true;
  const typed = $('events-input').value.trim();
  let artists = [];
  if (typed) {
    artists = [typed];
  } else {
    const seen = new Set();
    [...favorites, ...recent].forEach(t => {
      const a = (t.artist || '').trim();
      const key = a.toLowerCase();
      if (a && !seen.has(key)) { seen.add(key); artists.push(a); }
    });
    artists = artists.slice(0, 8);
  }
  if (!artists.length) {
    $('events-list').innerHTML = '<p class="hint">Добавь треки в «Мою музыку» или найди артиста по имени 🔎</p>';
    eventsLoading = false;
    return;
  }
  $('events-list').innerHTML = '<p class="hint">Загружаю афишу... 🛰️</p>';
  const results = await Promise.allSettled(artists.map(a => bitEvents(a).then(ev => ({ artist: a, ev }))));
  let all = [], okCount = 0;
  results.forEach(r => {
    if (r.status === 'fulfilled') {
      okCount++;
      all = all.concat((r.value.ev || []).map(e => Object.assign({}, e, { _artist: r.value.artist })));
    }
  });
  if (okCount === 0) {
    $('events-list').innerHTML = '<p class="hint">Не удалось загрузить афишу 😔 Попробуй позже</p>';
    eventsLoading = false;
    return;
  }
  renderEvents('events-list', all, null);
  eventsLoading = false;
}
$('events-btn').onclick = loadEventsTab;
$('events-input').addEventListener('keydown', e => { if (e.key === 'Enter') loadEventsTab(); });

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
// Клик по имени артиста в полноэкранном плеере
$('fp-artist').onclick = () => {
  const t = queue[currentIndex];
  if (t) openArtist(t.artist);
};
// Карточка артиста — назад
$('av-back').onclick = () => $('artist-view').classList.add('hidden');

// ============ Настройки (ключ Last.fm) ============
$('save-lastfm').onclick = async () => {
  lastfmKey = $('lastfm-key-input').value.trim();
  await store.set('sm_lastfm_key', lastfmKey);
  notify(lastfmKey ? 'Ключ сохранён ✅' : 'Ключ очищен');
};
$('lastfm-help').onclick = (e) => {
  e.preventDefault();
  try { tg.openLink('https://www.last.fm/api/account/create'); }
  catch (err) { window.open('https://www.last.fm/api/account/create', '_blank'); }
};
