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
const gearName = (item) => `${item.brand} ${item.model}`;
const quote = (text) => `"${text.trim().replace(/"/g, '\\"')}"`;

function musicBrainzQuery(title, artist) {
  return [
    title.trim() && `recording:${quote(title)}`,
    artist.trim() && `artist:${quote(artist)}`,
  ].filter(Boolean).join(' AND ');
}

/* ---------- Rotary knob ---------- */

const KNOB_MIN = 0;
const KNOB_MAX = 10;
const KNOB_STEP = 0.5;
const PIXELS_PER_STEP = 6;

function createKnob(name, initial = 5) {
  let value = initial;
  const valueLabel = h('span', { class: 'knob-value' });
  const dial = h('div', {
    class: 'dial',
    role: 'slider',
    tabindex: 0,
    'aria-label': name,
    'aria-valuemin': KNOB_MIN,
    'aria-valuemax': KNOB_MAX,
    'data-name': name,
    title: 'Drag up or down, use the mouse wheel or the arrow keys. Double click resets to 5.',
  }, h('div', { class: 'cap' }));

  function set(next) {
    const stepped = Math.round(next / KNOB_STEP) * KNOB_STEP;
    value = Math.min(KNOB_MAX, Math.max(KNOB_MIN, stepped));
    dial.style.setProperty('--p', String((value - KNOB_MIN) / (KNOB_MAX - KNOB_MIN)));
    dial.dataset.value = String(value);
    dial.setAttribute('aria-valuenow', String(value));
    valueLabel.textContent = String(value);
  }

  let dragStartY = null;
  let dragStartValue = value;
  dial.addEventListener('pointerdown', (event) => {
    dial.setPointerCapture(event.pointerId);
    dragStartY = event.clientY;
    dragStartValue = value;
    dial.focus();
  });
  dial.addEventListener('pointermove', (event) => {
    if (dragStartY === null) return;
    set(dragStartValue + ((dragStartY - event.clientY) / PIXELS_PER_STEP) * KNOB_STEP);
  });
  const endDrag = () => { dragStartY = null; };
  dial.addEventListener('pointerup', endDrag);
  dial.addEventListener('pointercancel', endDrag);
  dial.addEventListener('wheel', (event) => {
    event.preventDefault();
    set(value + (event.deltaY < 0 ? KNOB_STEP : -KNOB_STEP));
  }, { passive: false });
  dial.addEventListener('keydown', (event) => {
    const moves = { ArrowUp: KNOB_STEP, ArrowRight: KNOB_STEP, ArrowDown: -KNOB_STEP, ArrowLeft: -KNOB_STEP, PageUp: 1, PageDown: -1 };
    if (event.key in moves) set(value + moves[event.key]);
    else if (event.key === 'Home') set(KNOB_MIN);
    else if (event.key === 'End') set(KNOB_MAX);
    else return;
    event.preventDefault();
  });
  dial.addEventListener('dblclick', () => set(5));

  set(initial);
  return h('div', { class: 'knob' }, dial, valueLabel, h('span', { class: 'knob-name' }, name));
}

function knobPanel(item, values = {}) {
  return h('div', { class: 'knobs' }, item.controls.map((control) => createKnob(control, values[control] ?? 5)));
}

const readKnobs = (container) =>
  Object.fromEntries([...container.querySelectorAll('.dial')].map((dial) => [dial.dataset.name, Number(dial.dataset.value)]));

/* ---------- Presets ---------- */

function normalizePreset(preset) {
  return {
    ...preset,
    amp: preset.amp ?? { id: preset.amp_id, name: preset.amp_name ?? 'Unknown amp', settings: preset.settings ?? {} },
    pedals: preset.pedals ?? [],
  };
}

function presetCard(rawPreset, { onEdit, onDelete, showSong = false }) {
  const preset = normalizePreset(rawPreset);
  const chain = [...preset.pedals, preset.amp];
  return h('div', { class: 'card' },
    h('div', {},
      showSong
        ? h('a', { href: `#/song/${preset.song_id}` }, [preset.song_title, preset.song_artist].filter(Boolean).join(' - '))
        : '',
      h('div', {}, h('strong', {}, chain.map((item) => item.name).join(' → '))),
      chain.map((item) => h('div', { class: 'muted' }, `${item.name}: ${settingsSummary(item.settings) || 'no settings'}`)),
      preset.notes ? h('div', { class: 'muted' }, preset.notes) : '',
      preset.rating ? h('div', {}, '★'.repeat(preset.rating)) : ''),
    h('div', { class: 'actions' },
      onEdit ? h('button', { type: 'button', class: 'secondary', onclick: () => onEdit(preset) }, 'Edit') : '',
      h('button', {
        type: 'button',
        class: 'danger',
        onclick: () => {
          if (confirm('Delete this preset?')) onDelete().catch((error) => notify(error.message, true));
        },
      }, 'Delete')));
}

/* ---------- Views ---------- */

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

async function viewSong(id) {
  const [song, allGear, presets] = await Promise.all([
    api(`/songs/${id}`),
    api('/amps'),
    api(`/presets?song_id=${id}`),
  ]);
  const amps = allGear.filter((item) => item.type === 'amp');
  const pedals = allGear.filter((item) => item.type === 'pedal');

  if (!amps.length) {
    app.replaceChildren(h('h1', {}, song.title), h('p', { class: 'muted' }, 'There are no amps yet. Click "Load sample data" first.'));
    return;
  }

  let editing = null;

  const ampSelect = h('select', { 'aria-label': 'Amp' },
    amps.map((amp) => h('option', { value: amp.id }, gearName(amp))));
  let ampKnobs = h('div', {});
  const ampBlock = h('div', { class: 'gear' }, h('div', { class: 'gear-head' }, ampSelect), ampKnobs);

  function drawAmp(values = {}) {
    const amp = amps.find((item) => item.id === ampSelect.value);
    const next = knobPanel(amp, values);
    ampKnobs.replaceWith(next);
    ampKnobs = next;
  }
  ampSelect.addEventListener('change', () => drawAmp(readKnobs(ampKnobs)));

  const chain = h('div', { class: 'chain' });
  let pedalBlocks = [];

  function renderChain() {
    chain.replaceChildren(...(pedalBlocks.length
      ? pedalBlocks.map((block) => block.el)
      : [h('p', { class: 'muted' }, 'No pedals. The guitar goes straight into the amp.')]));
  }

  function addPedal(pedalId, values = {}) {
    const pedal = pedals.find((item) => item.id === pedalId);
    if (!pedal) return;
    const knobs = knobPanel(pedal, values);
    const block = { id: pedal.id, knobs };
    block.el = h('div', { class: 'gear' },
      h('div', { class: 'gear-head' },
        h('strong', {}, gearName(pedal)),
        h('button', {
          type: 'button',
          class: 'secondary icon',
          title: 'Remove pedal',
          'aria-label': `Remove ${gearName(pedal)}`,
          onclick: () => {
            pedalBlocks = pedalBlocks.filter((other) => other !== block);
            renderChain();
          },
        }, '✕')),
      knobs);
    pedalBlocks.push(block);
    renderChain();
  }

  const pedalSelect = h('select', { 'aria-label': 'Pedal to add' },
    pedals.map((pedal) => h('option', { value: pedal.id }, gearName(pedal))));
  const addPedalRow = pedals.length
    ? h('div', { class: 'gear-head' },
      pedalSelect,
      h('button', { type: 'button', class: 'secondary', onclick: () => addPedal(pedalSelect.value) }, '+ Add pedal'))
    : '';

  const notes = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Notes (guitar, pickup, tricks...)' });
  const rating = h('select', { 'aria-label': 'Rating' },
    h('option', { value: '' }, 'No rating'),
    [1, 2, 3, 4, 5].map((n) => h('option', { value: n }, '★'.repeat(n))));
  const formTitle = h('h2', {}, 'New preset');
  const cancelButton = h('button', { type: 'button', class: 'secondary', hidden: true, onclick: () => resetForm() }, 'Cancel edit');

  function resetForm() {
    editing = null;
    pedalBlocks = [];
    renderChain();
    ampSelect.value = amps[0].id;
    drawAmp();
    notes.value = '';
    rating.value = '';
    formTitle.textContent = 'New preset';
    cancelButton.hidden = true;
  }

  const form = h('form', {
    class: 'panel',
    onsubmit: async (event) => {
      event.preventDefault();
      const body = {
        song_id: song.id,
        song_title: song.title,
        song_artist: song.artist,
        pedals: pedalBlocks.map((block) => ({ id: block.id, settings: readKnobs(block.knobs) })),
        amp: { id: ampSelect.value, settings: readKnobs(ampKnobs) },
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
  },
  formTitle,
  h('p', { class: 'muted' }, 'Signal chain: guitar → pedals (in order) → amp.'),
  h('h3', { class: 'gear-title' }, 'Pedals'),
  chain,
  addPedalRow,
  h('h3', { class: 'gear-title' }, 'Amp'),
  ampBlock,
  notes,
  rating,
  h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Save preset'), cancelButton));

  const list = h('div', { class: 'list' },
    presets.length
      ? presets.map((preset) => presetCard(preset, {
        onEdit: (normalized) => {
          editing = normalized;
          pedalBlocks = [];
          normalized.pedals.forEach((pedal) => addPedal(pedal.id, pedal.settings));
          renderChain();
          if (amps.some((amp) => amp.id === normalized.amp.id)) ampSelect.value = normalized.amp.id;
          drawAmp(normalized.amp.settings);
          notes.value = normalized.notes ?? '';
          rating.value = normalized.rating ?? '';
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

  drawAmp();
  renderChain();
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
    notify(`Sample data loaded: ${result.songs.created} songs, ${result.amps.created} amps and pedals`);
    await route();
  } catch (error) {
    notify(error.message, true);
  }
});

window.addEventListener('hashchange', route);
route();
