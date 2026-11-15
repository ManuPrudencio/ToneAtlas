const app = document.querySelector('#app');
const message = document.querySelector('#message');

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (value !== false && value != null) el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    el.append(child instanceof Node ? child : document.createTextNode(child ?? ''));
  }
  return el;
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail ?? data?.error ?? `Error ${response.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return data;
}

function notify(text, isError = false) {
  message.textContent = text;
  message.className = isError ? 'error' : '';
  message.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { message.hidden = true; }, 4000);
}

const songInfo = (song) => [song.artist, song.album, song.year].filter(Boolean).join(' · ');

async function viewSearch() {
  const input = h('input', { type: 'search', placeholder: 'Search by title or artist...', 'aria-label': 'Search songs' });
  const list = h('div', { class: 'list' });

  async function load() {
    const songs = await api(`/songs?q=${encodeURIComponent(input.value)}`);
    if (!songs.length) {
      list.replaceChildren(h('p', { class: 'muted' }, 'No songs found.'));
      return;
    }
    list.replaceChildren(...songs.map((song) =>
      h('div', { class: 'card' },
        h('a', { href: `#/song/${song.id}` }, song.title),
        h('div', { class: 'muted' }, songInfo(song)))));
  }

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load().catch((error) => notify(error.message, true)), 250);
  });

  app.replaceChildren(h('h1', {}, 'Search songs'), input, list);
  await load();
}

async function route() {
  const hash = location.hash || '#/';
  app.replaceChildren(h('p', { class: 'muted' }, 'Loading...'));
  try {
    if (hash === '#/' || hash === '') await viewSearch();
    else app.replaceChildren(h('p', { class: 'muted' }, 'This page is not ready yet.'));
  } catch (error) {
    app.replaceChildren(h('p', { class: 'error' }, error.message));
  }
}

window.addEventListener('hashchange', route);
route();