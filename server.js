require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const Groq = require('groq-sdk');

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const VOICE_MAP = {
  Aryan: 'onyx',
  Max:   'echo',
  Priya: 'nova',
  Zara:  'shimmer'
};

// ── TTS ENDPOINT ──
app.post('/tts', async (req, res) => {
  const { text, voice } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });
  const clean = text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ').trim();
  const openaiVoice = VOICE_MAP[voice] || 'nova';
  try {
    // tts-1 is faster than tts-1-hd — fixes the 3-5 second delay
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: openaiVoice,
      input: clean,
      response_format: 'mp3'
    });
    const buffer = Buffer.from(await mp3.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-cache');
    res.send(buffer);
    console.log('TTS OK', voice, openaiVoice, clean.length + 'chars');
  } catch (error) {
    console.error('TTS error:', error.message);
    res.status(500).json({ error: 'TTS failed: ' + error.message });
  }
});

// ── TRANSCRIBE ENDPOINT (Groq Whisper) ──
app.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio provided' });
  try {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    // Detect format from uploaded file name — mp4 for Safari, webm for Chrome/Android
    const origName = req.file.originalname || 'speech.webm';
    const ext = origName.endsWith('.mp4') ? '.mp4' : '.webm';
    const tmpPath = path.join(os.tmpdir(), 'walktalk_' + Date.now() + ext);
    fs.writeFileSync(tmpPath, req.file.buffer);

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-large-v3-turbo',
      language: 'en',
      response_format: 'json'
    });

    fs.unlinkSync(tmpPath);
    console.log('Transcribe OK:', transcription.text);
    res.json({ text: transcription.text || '' });
  } catch (error) {
    console.error('Transcribe error:', error.message);
    res.status(500).json({ error: 'Transcription failed: ' + error.message });
  }
});

// ── CHAT ENDPOINT ──
app.post('/chat', async (req, res) => {
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
    const why           = req.body.why           || [];
    const energy        = req.body.energy        || [];
    const isEndOfWalk   = req.body.isEndOfWalk   || false;

    const moodGuides = {
      Happy:   'Mood: HAPPY. Be warm, upbeat, gently playful.',
      Okay:    'Mood: NEUTRAL. Be warm, steady, genuinely interested.',
      Tired:   'Mood: TIRED. Speak softly. No exclamation marks. No hype. Acknowledge their effort with one gentle question.',
      Stressed:'Mood: STRESSED. Be calm and grounding. Ask if they want to talk or be distracted.',
      Sad:     'Mood: SAD. Be quietly present. No rushing to fix. Just warm steady company.'
    };

    const moodGuide = moodGuides[mood] || moodGuides['Okay'];
    const genderCtx = gender === 'female'
      ? 'User is female. Use warm sisterly tone.'
      : 'User is male. Use grounded encouraging tone.';
    const bmiCtx = bmi
      ? `User BMI: ${bmi} (${bmiCat}). Occasionally encourage their walking as progress toward health goals, never judgmental.`
      : '';
    const whyCtx = why.length
      ? `User walks because: ${why.join(', ')}. Weave these motivations naturally into conversation — reference them when encouraging or checking in.`
      : '';
    const energyCtx = energy.length
      ? `User enjoys: ${energy.join(', ')}. Shape your conversation style and topics around these interests throughout the session.`
      : '';

    let walkCtx = '';
    let rulesCtx = '';

    if (isEndOfWalk) {
      walkCtx = `The walk has just finished. Give a warm personal summary of how well they did today. Mention their specific walking motivations (${why.join(', ')}). End with one genuinely motivating farewell. Do NOT ask any questions — this is the final goodbye.`;
      rulesCtx = `RULES: 3-4 sentences maximum. Warm summary then motivating goodbye. No questions at the end.`;
    } else if (walkStarted) {
      walkCtx = `User is currently walking. Keep them engaged based on their interests. Check in on how they feel every few exchanges.`;
      rulesCtx = `RULES: Maximum 2 short sentences. Always end with one natural question. One emoji max or none. Sound like a genuine caring friend.`;
    } else {
      walkCtx = `User has not started walking yet. Have a brief warm friendly chat. After ${chatExchanges >= 2 ? 'this exchange' : '2-3 exchanges'}, naturally suggest starting the walk.`;
      rulesCtx = `RULES: Maximum 2 short sentences. Always end with one natural question. One emoji max or none. Sound like a genuine caring friend.`;
    }

    const systemPrompt = `You are ${voiceName}, a warm emotionally intelligent walking companion. You speak exactly like a real human friend having a natural conversation out loud — not like a chatbot writing text.

SPEECH STYLE — this is critical:
- Start replies naturally with expressions like "Oh wow", "Ah that's interesting", "Hmm", "Yeah", "Aw", "Oh nice", "Ha", "Right", "Oh absolutely", "Mmm" — whichever fits the moment naturally. Vary them, never repeat the same one twice in a row.
- Speak in flowing conversational sentences the way a real person talks, not bullet points or formal language.
- Use natural contractions always: "you're", "I'm", "that's", "it's", "don't", "can't", "we'll".
- Occasional light emphasis is fine: "That's really lovely" or "Oh I love that".
- Never sound scripted, formal, or like written text being read aloud.

User name: "${userName}" - use occasionally, not every message.
${genderCtx}
${moodGuide}
${bmiCtx}
${whyCtx}
${energyCtx}
${walkCtx}
${rulesCtx}
Never use: champion, warrior, superhero, crush it, conquer.`;

    const response = await anthropic.messages.create({
      model: isEndOfWalk ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
      max_tokens: isEndOfWalk ? 200 : 80,
      system: systemPrompt,
      messages: messages
    });

    console.log('Claude OK | endOfWalk:', isEndOfWalk);
    res.json({ reply: response.content[0].text });
  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({ error: 'Something went wrong: ' + error.message });
  }
});

app.listen(3000, () => console.log('WalkTalk AI running at http://localhost:3000'));
