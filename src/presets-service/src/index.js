import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';

const PORT = Number(process.env.PORT ?? 3000);
const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB ?? 'toneatlas';
const MAX_PEDALS = 8;

const SAMPLE_GEAR = [
  { brand: 'Boss', model: 'Katana MK2', type: 'amp', controls: ['gain', 'volume', 'bass', 'middle', 'treble'] },
  { brand: 'Marshall', model: 'JCM800 2203', type: 'amp', controls: ['preamp', 'master', 'bass', 'middle', 'treble', 'presence'] },
  { brand: 'Fender', model: 'Twin Reverb', type: 'amp', controls: ['volume', 'treble', 'middle', 'bass', 'reverb'] },
  { brand: 'Vox', model: 'AC30', type: 'amp', controls: ['volume', 'treble', 'bass', 'cut'] },
  { brand: 'Boss', model: 'DS-2 Turbo Distortion', type: 'pedal', controls: ['level', 'tone', 'dist'] },
  { brand: 'Electro-Harmonix', model: 'Big Muff Pi', type: 'pedal', controls: ['volume', 'tone', 'sustain'] },
  { brand: 'Ibanez', model: 'TS9 Tube Screamer', type: 'pedal', controls: ['overdrive', 'tone', 'level'] },
  { brand: 'Boss', model: 'CE-2 Chorus', type: 'pedal', controls: ['rate', 'depth'] },
  { brand: 'Boss', model: 'DD-3 Digital Delay', type: 'pedal', controls: ['level', 'feedback', 'time'] },
  { brand: 'MXR', model: 'Phase 90', type: 'pedal', controls: ['speed'] },
];

const client = new MongoClient(MONGO_URL);
await client.connect();
const db = client.db(DB_NAME);
const gear = db.collection('amps');
const presets = db.collection('presets');

const serialize = ({ _id, ...rest }) => ({ id: _id.toString(), ...rest });
const isValidId = (value) => typeof value === 'string' && value.length === 24 && ObjectId.isValid(value);
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const article = (type) => (type === 'amp' ? 'an amp' : `a ${type}`);

async function loadGear(item, type, label) {
  if (!isObject(item)) return { error: `${label} must be an object like {"id": "...", "settings": {...}}` };
  if (!isValidId(item.id)) return { error: `${label}.id is not valid` };
  const found = await gear.findOne({ _id: new ObjectId(item.id) });
  if (!found) return { error: `${label}.id does not exist` };
  if (found.type !== type) return { error: `${label} must be ${article(type)}, but ${found.brand} ${found.model} is ${article(found.type)}` };

  const settings = item.settings ?? {};
  if (!isObject(settings)) return { error: `${label}.settings must be an object like {"gain": 5}` };
  const clean = {};
  for (const control of found.controls) {
    const value = settings[control];
    if (value === undefined) continue;
    if (typeof value !== 'number' || value < 0 || value > 10) {
      return { error: `${label}.settings.${control} must be a number between 0 and 10` };
    }
    clean[control] = value;
  }
  return { item: { id: item.id, name: `${found.brand} ${found.model}`, settings: clean } };
}

async function buildPreset(body) {
  const { song_id, song_title, song_artist = '', amp, pedals = [], notes = '', rating = null } = body ?? {};

  if (!Number.isInteger(song_id) || song_id < 1) return { error: 'song_id must be a positive integer' };
  if (typeof song_title !== 'string' || !song_title.trim()) return { error: 'song_title is required' };

  const ampResult = await loadGear(amp, 'amp', 'amp');
  if (ampResult.error) return ampResult;

  if (!Array.isArray(pedals)) return { error: 'pedals must be a list' };
  if (pedals.length > MAX_PEDALS) return { error: `a preset can have at most ${MAX_PEDALS} pedals` };
  const chain = [];
  for (const [index, pedal] of pedals.entries()) {
    const pedalResult = await loadGear(pedal, 'pedal', `pedals[${index}]`);
    if (pedalResult.error) return pedalResult;
    chain.push(pedalResult.item);
  }

  if (typeof notes !== 'string' || notes.length > 500) return { error: 'notes must be text up to 500 characters' };
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
    return { error: 'rating must be an integer from 1 to 5' };
  }

  return {
    preset: {
      song_id,
      song_title: song_title.trim(),
      song_artist: String(song_artist).trim(),
      pedals: chain,
      amp: ampResult.item,
      notes,
      rating,
    },
  };
}

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'presets' });
});

app.get('/amps', async (req, res) => {
  const filter = {};
  if (req.query.type !== undefined) filter.type = String(req.query.type);
  const list = await gear.find(filter).sort({ type: 1, brand: 1, model: 1 }).toArray();
  res.json(list.map(serialize));
});

app.post('/amps/seed', async (req, res) => {
  let created = 0;
  for (const item of SAMPLE_GEAR) {
    const exists = await gear.findOne({ brand: item.brand, model: item.model });
    if (!exists) {
      await gear.insertOne({ ...item });
      created += 1;
    }
  }
  res.json({ created });
});

app.get('/presets', async (req, res) => {
  const filter = {};
  if (req.query.song_id !== undefined) {
    const songId = Number(req.query.song_id);
    if (!Number.isInteger(songId)) return res.status(400).json({ error: 'song_id must be an integer' });
    filter.song_id = songId;
  }
  const list = await presets.find(filter).sort({ created_at: -1 }).toArray();
  res.json(list.map(serialize));
});

app.get('/presets/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Preset not found' });
  const preset = await presets.findOne({ _id: new ObjectId(req.params.id) });
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json(serialize(preset));
});

app.post('/presets', async (req, res) => {
  const { error, preset } = await buildPreset(req.body);
  if (error) return res.status(400).json({ error });
  const doc = { ...preset, created_at: new Date().toISOString() };
  const { insertedId } = await presets.insertOne(doc);
  res.status(201).json(serialize({ _id: insertedId, ...doc }));
});

app.put('/presets/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Preset not found' });
  const { error, preset } = await buildPreset(req.body);
  if (error) return res.status(400).json({ error });
  const id = new ObjectId(req.params.id);
  const { matchedCount } = await presets.updateOne(
    { _id: id },
    { $set: preset, $unset: { amp_id: '', amp_name: '', settings: '' } },
  );
  if (!matchedCount) return res.status(404).json({ error: 'Preset not found' });
  res.json(serialize(await presets.findOne({ _id: id })));
});

app.delete('/presets/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Preset not found' });
  const { deletedCount } = await presets.deleteOne({ _id: new ObjectId(req.params.id) });
  if (!deletedCount) return res.status(404).json({ error: 'Preset not found' });
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Presets service listening on port ${PORT}`);
});
