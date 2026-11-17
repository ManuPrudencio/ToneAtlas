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
const settingsSummary = (settings) => Object.entries(settings).map(([k, v]) => `${k} ${v}`).join(' · ');
const quote = (text) => `"${text.trim().replace(/"/g, '\\"')}"`;

function musicBrainzQuery(title, artist) {
  return [
    title.trim() && `recording:${quote(title)}`,
    artist.trim() && `artist:${quote(artist)}`,
  ].filter(Boolean).join(' AND ');
}

async function viewSearch() {
  const input = h('input', { type: 'search', placeholder: 'Search by title or artist...', 'aria-label': 'Search songs' });
  const list = h('div', { class: 'list' });

  async function load() {
    const songs = await api(`/songs?q=${encodeURIComponent(input.value)}`);
    if (!songs.length) {
      list.replaceChildren(h('p', { class: 'muted' }, 'No songs found. Load the sample data or import songs from MusicBrainz below.'));
      return;
    }
    list.replaceChildren(...songs.map((song) =>
      h('div', { class: 'card' },
        h('div', {},
          h('a', { href: `#/song/${song.id}` }, song.title),
          h('div', { class: 'muted' }, songInfo(song))),
        h('a', { class: 'button', href: `#/song/${song.id}` }, 'Presets'))));
  }

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load().catch((error) => notify(error.message, true)), 250);
  });

  const titleInput = h('input', { type: 'text', placeholder: 'Song title', 'aria-label': 'Song title' });
  const artistInput = h('input', { type: 'text', placeholder: 'Artist', 'aria-label': 'Artist' });
  const importForm = h('form', {
    class: 'row',
    onsubmit: async (event) => {
      event.preventDefault();
      const query = musicBrainzQuery(titleInput.value, artistInput.value);
      if (!query) return notify('Write a title, an artist or both', true);
      try {
        const result = await api(`/songs/import?query=${encodeURIComponent(query)}`, { method: 'POST' });
        notify(`MusicBrainz: ${result.found} found, ${result.created} new`);
        input.value = titleInput.value || artistInput.value;
        await load();
      } catch (error) {
        notify(error.message, true);
      }
    },
  }, titleInput, artistInput, h('button', { type: 'submit' }, 'Import'));

  app.replaceChildren(
    h('h1', {}, 'Search songs'), input, list,
    h('h2', {}, 'Import from MusicBrainz'), importForm);
  await load();
}

function presetCard(preset, { onEdit, onDelete, showSong = false }) {
  return h('div', { class: 'card' },
    h('div', {},
      showSong
        ? h('a', { href: `#/song/${preset.song_id}` }, [preset.song_title, preset.song_artist].filter(Boolean).join(' - '))
        : h('strong', {}, preset.amp_name),
      h('div', { class: 'muted' }, [showSong && preset.amp_name, settingsSummary(preset.settings)].filter(Boolean).join(' · ')),
      preset.notes ? h('div', { class: 'muted' }, preset.notes) : '',
      preset.rating ? h('div', {}, '★'.repeat(preset.rating)) : ''),
    h('div', { class: 'actions' },
      onEdit ? h('button', { type: 'button', class: 'secondary', onclick: onEdit }, 'Edit') : '',
      h('button', {
        type: 'button',
        class: 'danger',
        onclick: () => {
          if (confirm('Delete this preset?')) onDelete().catch((error) => notify(error.message, true));
        },
      }, 'Delete')));
}

async function viewSong(id) {
  const [song, amps, presets] = await Promise.all([
    api(`/songs/${id}`),
    api('/amps'),
    api(`/presets?song_id=${id}`),
  ]);

  if (!amps.length) {
    app.replaceChildren(h('h1', {}, song.title), h('p', { class: 'muted' }, 'There are no amps yet. Click "Load sample data" first.'));
    return;
  }

  let editing = null;

  const groups = [['amp', 'Amps'], ['pedal', 'Pedals']]
    .map(([type, label]) => [label, amps.filter((amp) => amp.type === type)])
    .filter(([, list]) => list.length);
  const ampSelect = h('select', { 'aria-label': 'Amp or pedal' },
    groups.map(([label, list]) =>
      h('optgroup', { label },
        list.map((amp) => h('option', { value: amp.id }, `${amp.brand} ${amp.model}`)))));
  const knobs = h('div', {});
  const notes = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Notes (guitar, pickup, tricks...)' });
  const rating = h('select', { 'aria-label': 'Rating' },
    h('option', { value: '' }, 'No rating'),
    [1, 2, 3, 4, 5].map((n) => h('option', { value: n }, '★'.repeat(n))));
  const formTitle = h('h2', {}, 'New preset');
  const cancelButton = h('button', { type: 'button', class: 'secondary', hidden: true, onclick: () => resetForm() }, 'Cancel edit');

  function drawKnobs(values = {}) {
    const amp = amps.find((a) => a.id === ampSelect.value);
    knobs.replaceChildren(...amp.controls.map((control) => {
      const start = values[control] ?? 5;
      const output = h('span', {}, String(start));
      const slider = h('input', {
        type: 'range', min: 0, max: 10, step: 0.5, value: start, name: control, 'aria-label': control,
        oninput: () => { output.textContent = slider.value; },
      });
      return h('div', { class: 'knob' }, h('label', {}, control), slider, output);
    }));
  }

  const currentSettings = () =>
    Object.fromEntries([...knobs.querySelectorAll('input')].map((el) => [el.name, Number(el.value)]));

  function resetForm() {
    editing = null;
    notes.value = '';
    rating.value = '';
    formTitle.textContent = 'New preset';
    cancelButton.hidden = true;
    drawKnobs();
  }

  ampSelect.addEventListener('change', () => drawKnobs(currentSettings()));

  const form = h('form', {
    class: 'panel',
    onsubmit: async (event) => {
      event.preventDefault();
      const body = {
        song_id: song.id,
        song_title: song.title,
        song_artist: song.artist,
        amp_id: ampSelect.value,
        settings: currentSettings(),
        notes: notes.value,
        rating: rating.value ? Number(rating.value) : null,
      };
      try {
        await api(editing ? `/presets/${editing.id}` : '/presets', {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify(body),
        });
        notify(editing ? 'Preset updated' : 'Preset saved');
        await viewSong(id);
      } catch (error) {
        notify(error.message, true);
      }
    },
  }, formTitle, ampSelect, knobs, notes, rating,
    h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Save preset'), cancelButton));

  const list = h('div', { class: 'list' },
    presets.length
      ? presets.map((preset) => presetCard(preset, {
        onEdit: () => {
          editing = preset;
          ampSelect.value = preset.amp_id;
          drawKnobs(preset.settings);
          notes.value = preset.notes ?? '';
          rating.value = preset.rating ?? '';
          formTitle.textContent = 'Edit preset';
          cancelButton.hidden = false;
          form.scrollIntoView({ behavior: 'smooth' });
        },
        onDelete: async () => {
          await api(`/presets/${preset.id}`, { method: 'DELETE' });
          notify('Preset deleted');
          await viewSong(id);
        },
      }))
      : h('p', { class: 'muted' }, 'No presets for this song yet. Create the first one below.'));

  drawKnobs();
  app.replaceChildren(
    h('a', { class: 'back', href: '#/' }, '← Back to search'),
    h('h1', {}, song.title),
    h('p', { class: 'muted' }, songInfo(song)),
    h('h2', {}, 'Presets for this song'),
    list,
    form);
}

async function viewPresets() {
  const presets = await api('/presets');
  app.replaceChildren(
    h('h1', {}, 'My presets'),
    h('div', { class: 'list' },
      presets.length
        ? presets.map((preset) => presetCard(preset, {
          showSong: true,
          onDelete: async () => {
            await api(`/presets/${preset.id}`, { method: 'DELETE' });
            notify('Preset deleted');
            await viewPresets();
          },
        }))
        : h('p', { class: 'muted' }, 'You have no presets yet. Search a song and save the first one.')));
}

const routes = [
  [/^#\/song\/(\d+)$/, viewSong],
  [/^#\/presets$/, viewPresets],
  [/^#\/?$/, viewSearch],
];

async function route() {
  const hash = location.hash || '#/';
  app.replaceChildren(h('p', { class: 'muted' }, 'Loading...'));
  try {
    for (const [pattern, view] of routes) {
      const match = hash.match(pattern);
      if (match) {
        await view(...match.slice(1));
        return;
      }
    }
    app.replaceChildren(h('p', { class: 'muted' }, 'Page not found.'));
  } catch (error) {
    app.replaceChildren(h('p', { class: 'error' }, error.message));
  }
}

document.querySelector('#seed').addEventListener('click', async () => {
  try {
    const result = await api('/seed', { method: 'POST' });
    notify(`Sample data loaded: ${result.songs.created} songs, ${result.amps.created} amps`);
    await route();
  } catch (error) {
    notify(error.message, true);
  }
});

window.addEventListener('hashchange', route);
route();
