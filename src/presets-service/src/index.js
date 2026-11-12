import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';

const PORT = Number(process.env.PORT ?? 3000);
const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB ?? 'toneatlas';

const SAMPLE_AMPS = [
  { brand: 'Boss', model: 'Katana MK2', type: 'amp', controls: ['gain', 'volume', 'bass', 'middle', 'treble'] },
  { brand: 'Marshall', model: 'JCM800 2203', type: 'amp', controls: ['preamp', 'master', 'bass', 'middle', 'treble', 'presence'] },
  { brand: 'Fender', model: 'Twin Reverb', type: 'amp', controls: ['volume', 'treble', 'middle', 'bass', 'reverb'] },
  { brand: 'Vox', model: 'AC30', type: 'amp', controls: ['volume', 'treble', 'bass', 'cut'] },
  { brand: 'Boss', model: 'DS-2 Turbo Distortion', type: 'pedal', controls: ['level', 'tone', 'dist'] },
];

const client = new MongoClient(MONGO_URL);
await client.connect();
const db = client.db(DB_NAME);
const amps = db.collection('amps');
const presets = db.collection('presets');

const serialize = ({ _id, ...rest }) => ({ id: _id.toString(), ...rest });
const isValidId = (value) => typeof value === 'string' && value.length === 24 && ObjectId.isValid(value);

async function buildPreset(body) {
  const { song_id, song_title, song_artist = '', amp_id, settings, notes = '', rating = null } = body ?? {};

  if (!Number.isInteger(song_id) || song_id < 1) return { error: 'song_id must be a positive integer' };
  if (typeof song_title !== 'string' || !song_title.trim()) return { error: 'song_title is required' };
  if (!isValidId(amp_id)) return { error: 'amp_id is not valid' };

  const amp = await amps.findOne({ _id: new ObjectId(amp_id) });
  if (!amp) return { error: 'amp_id does not exist' };

  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    return { error: 'settings must be an object like {"gain": 5}' };
  }
  const cleanSettings = {};
  for (const control of amp.controls) {
    const value = settings[control];
    if (value === undefined) continue;
    if (typeof value !== 'number' || value < 0 || value > 10) {
      return { error: `settings.${control} must be a number between 0 and 10` };
    }
    cleanSettings[control] = value;
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
      amp_id,
      amp_name: `${amp.brand} ${amp.model}`,
      settings: cleanSettings,
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
  const list = await amps.find({}).sort({ brand: 1, model: 1 }).toArray();
  res.json(list.map(serialize));
});

app.post('/amps/seed', async (req, res) => {
  let created = 0;
  for (const amp of SAMPLE_AMPS) {
    const exists = await amps.findOne({ brand: amp.brand, model: amp.model });
    if (!exists) {
      await amps.insertOne({ ...amp });
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
  const { matchedCount } = await presets.updateOne({ _id: id }, { $set: preset });
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