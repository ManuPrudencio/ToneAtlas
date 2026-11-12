import express from 'express';
import { MongoClient } from 'mongodb';

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

const serialize = ({ _id, ...rest }) => ({ id: _id.toString(), ...rest });

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

app.listen(PORT, () => {
  console.log(`Presets service listening on port ${PORT}`);
});