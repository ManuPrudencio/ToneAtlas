import express from 'express';

const PORT = Number(process.env.PORT ?? 3000);

const AMPS = [
  { id: 'katana', brand: 'Boss', model: 'Katana MK2', type: 'amp', controls: ['gain', 'volume', 'bass', 'middle', 'treble'] },
  { id: 'jcm800', brand: 'Marshall', model: 'JCM800 2203', type: 'amp', controls: ['preamp', 'master', 'bass', 'middle', 'treble', 'presence'] },
  { id: 'twin', brand: 'Fender', model: 'Twin Reverb', type: 'amp', controls: ['volume', 'treble', 'middle', 'bass', 'reverb'] },
];

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'presets' });
});

app.get('/amps', (req, res) => {
  res.json(AMPS);
});

app.listen(PORT, () => {
  console.log(`Presets service listening on port ${PORT}`);
});