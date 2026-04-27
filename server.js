const express = require('express');
const { OpenAI } = require('openai');
const { google } = require('googleapis');

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const SHEET_NAME = 'Voicemails';

function getGoogleAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function addLeadToSheet(lead) {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:K`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [
          new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
          lead.name || 'Unknown',
          lead.phone || 'Unknown',
          lead.skill || 'General inquiry',
          lead.availability || 'Unknown',
          lead.person_type || 'Other / Unsure',
          lead.athlete_name || 'Unknown',
          lead.athlete_age || 'Unknown',
          lead.department || 'Other / Unsure',
          lead.notes || '',
          lead.transcript || '',
        ],
      ],
    },
  });
}

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

    const callerPhone = req.body.From || req.body.Caller || 'Unknown';
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

    const transcript = transcription.text || '';
    console.log('TRANSCRIPT:', transcript);

    const extraction = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `
You extract lead information for Fields Functionality, a gymnastics skill lab for competitive athletes and adults.

Return ONLY valid JSON with these fields:
{
  "name": "",
  "phone": "",
  "skill": "",
  "availability": "",
  "person_type": "",
  "athlete_name": "",
  "athlete_age": "",
  "department": "",
  "notes": ""
}

Allowed person_type values:
Adult
Parent / Guardian
Athlete
Coach
Other / Unsure

Allowed department values:
Tumbling Leads
Strength Skills Leads
Competitive Team Leads
Other / Unsure

Rules:
- If caller phone is available, use it as phone.
- If name is missing, use "Unknown".
- If availability is missing, use "Unknown".
- If athlete name or age is missing, use "Unknown".
- If skill is unclear, use "General inquiry".
- If department is unclear, use "Other / Unsure".
- Tumbling includes back tuck, back handspring, flips, tumbling.
- Strength Skills includes handstands, rings, calisthenics, strength skills.
- Competitive Team includes competitive gymnastics, cheer, acro, dance.
          `.trim(),
        },
        {
          role: 'user',
          content: `
Caller phone: ${callerPhone}

Transcript:
${transcript}
          `.trim(),
        },
      ],
    });

    const lead = JSON.parse(extraction.choices[0].message.content);
    lead.phone = lead.phone || callerPhone;
    lead.transcript = transcript;

    console.log('STRUCTURED LEAD:', lead);

    await addLeadToSheet(lead);

    console.log('Lead added to Google Sheet');

    res.sendStatus(200);
  } catch (error) {
    console.error('Voicemail processing failed:', error);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});