require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { EdgeTTS } = require('@andresaya/edge-tts');

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ── VOICE MAP — 4 genuinely distinct Microsoft neural voices ──
const VOICE_MAP = {
  Aryan: 'en-US-GuyNeural',      // Deep, calm, authoritative male
  Max:   'en-US-TonyNeural',     // Energetic, younger male
  Priya: 'en-IN-NeerjaNeural',   // Warm Indian female
  Zara:  'en-US-JennyNeural'     // Bright, expressive female
};

// ── TTS ENDPOINT — converts text to audio, streams back to browser ──
app.post('/tts', async (req, res) => {
  const { text, voice } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });

  const voiceName = VOICE_MAP[voice] || 'en-US-JennyNeural';
  // Strip emojis before sending to TTS
  const clean = text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  try {
    const tts = new EdgeTTS();
    await tts.synthesize(clean, voiceName, { rate: '0%', volume: '100%', pitch: '0Hz' });
    const audioBuffer = await tts.toBuffer();
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-cache');
    res.send(audioBuffer);
    console.log('TTS OK —', voice, '→', voiceName, '—', clean.length, 'chars');
  } catch (error) {
    console.error('TTS error:', error.message);
    res.status(500).json({ error: 'TTS failed: ' + error.message });
  }
});

// ── CHAT ENDPOINT ──
app.post('/chat', async (req, res) => {
  console.log('Chat — mood:', req.body.mood, '| voice:', req.body.voiceName);
  try {
    const messages      = req.body.messages      || [];
    const mood          = req.body.mood          || 'Okay';
    const voiceName     = req.body.voiceName     || 'Companion';
    const duration      = req.body.duration      || 20;
    const userName      = req.body.userName      || 'friend';
    const gender        = req.body.gender        || 'male';
    const bmi           = req.body.bmi           || null;
    const bmiCat        = req.body.bmiCat        || '';
    const walkStarted   = req.body.walkStarted   || false;
    const chatExchanges = req.body.chatExchanges || 0;

    const moodGuides = {
      Happy:   'Mood: HAPPY. Be warm, upbeat, gently playful.',
      Okay:    'Mood: NEUTRAL. Be warm, steady, genuinely interested.',
      Tired:   'Mood: TIRED. Speak softly and gently. No exclamation marks. No hype words. No jokes about tiredness. Acknowledge their effort and ask one soft caring question.',
      Stressed:'Mood: STRESSED. Be calm and grounding. Ask if they want to talk or be distracted.',
      Sad:     'Mood: SAD. Be quietly present. No rushing to fix. Just warm company.'
    };
    const moodGuide = moodGuides[mood] || moodGuides['Okay'];
    const genderCtx = gender === 'female'
      ? 'User is female. Use warm, sisterly tone.'
      : 'User is male. Use grounded, encouraging tone.';
    const bmiCtx = bmi
      ? `User BMI: ${bmi} (${bmiCat}). Encourage their walking as progress toward health goals.`
      : '';
    const walkCtx = walkStarted
      ? 'User is walking. Keep them engaged and motivated. Check in on how they feel every few exchanges.'
      : `User has not started walking yet. Have a brief warm chat. After ${chatExchanges >= 2 ? 'this exchange' : '2-3 exchanges'}, naturally suggest starting the walk.`;

    const systemPrompt = `You are ${voiceName}, a warm emotionally intelligent walking companion.
User name: "${userName}" — always spell exactly as given.
${genderCtx}
${moodGuide}
${bmiCtx}
${walkCtx}
RULES: Maximum 2 short sentences. Always end with one natural question. No more than one emoji or none. Sound like a genuine caring friend.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 160,
      system: systemPrompt,
      messages: messages
    });

    console.log('Claude OK');
    res.json({ reply: response.content[0].text });
  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({ error: 'Something went wrong: ' + error.message });
  }
});

app.listen(3000, () => console.log('WalkTalk AI running at http://localhost:3000'));
