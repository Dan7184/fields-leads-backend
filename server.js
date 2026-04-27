const express = require('express');
const { OpenAI } = require('openai');

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.send('Backend is live');
});

app.post('/twilio/voicemail', (req, res) => {
  console.log('Twilio voicemail webhook hit');
  console.log('Twilio body:', req.body);

  res.type('text/xml');
  res.send(`
<Response>
  <Say voice="alice">
    Hey, this is Fields Functionality, a gymnastics skill lab for competitive athletes and adults.
    We focus on skill development, breakdowns, and structured progressions across tumbling, handstands, rings, and strength work.
    We missed your call. Please leave your name, what skill you're working on, and the best time to reach you.
    We'll review your message and follow up with the right next step.
  </Say>
  <Record
    maxLength="120"
    playBeep="true"
    recordingStatusCallback="/twilio/voicemail-recording"
    recordingStatusCallbackMethod="POST"
  />
  <Say voice="alice">Thank you. We got your message.</Say>
</Response>
  `.trim());
});

app.post('/twilio/voicemail-recording', async (req, res) => {
  try {
    console.log('Twilio recording webhook hit');
    console.log('Recording body:', req.body);

    const recordingUrl = req.body.RecordingUrl;
    const recordingMp3Url = `${recordingUrl}.mp3`;

    console.log('Downloading recording:', recordingMp3Url);

    const audioResponse = await fetch(recordingMp3Url, {
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(
            `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
          ).toString('base64'),
      },
    });

    if (!audioResponse.ok) {
      throw new Error(`Failed to download recording: ${audioResponse.status}`);
    }

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

    const audioFile = new File([audioBuffer], 'voicemail.mp3', {
      type: 'audio/mpeg',
    });

    const transcription = await openai.audio.transcriptions.create({
      model: 'gpt-4o-mini-transcribe',
      file: audioFile,
    });

    console.log('TRANSCRIPT:', transcription.text);

    res.sendStatus(200);
  } catch (error) {
    console.error('Voicemail transcription failed:', error);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});