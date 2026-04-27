const express = require('express');
const { OpenAI } = require('openai');
const { google } = require('googleapis');
const twilio = require('twilio');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const VOICEMAILS_SHEET_NAME = 'Voicemails';
const LEADS_SHEET_NAME = 'Leads';

function getGoogleAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function appendToSheet(sheetName, values) {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${sheetName}!A:K`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [values],
    },
  });
}

function timestampNow() { 
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
  });
}

async function sendAutoText(toPhone) {
  try {
    if (!toPhone || toPhone === 'Unknown') return;

    await twilioClient.messages.create({
      body:
        "Hey, this is Fields Functionality, Thank you for reach out! We got your message and follow up with the right next step soon. Have an awesome Day in the meantime!",
      from: '+15613003523',
      to: toPhone,
    });

    console.log('Auto text sent to:', toPhone);
  } catch (error) {
    console.error('Auto text failed:', error.message);
  }
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

const transcription = await openai.audio.transcriptions.create({
  model: 'gpt-4o-mini-transcribe',
  file: Buffer.from(audioBuffer),
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
  "category": "",
  "specific_interest": "",
  "skill": "",
  "availability": "",
  "preferred_times": "",
  "person_type": "",
  "athlete_name": "",
  "athlete_age": "",
  "department": "",
  "urgency": "",
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
- If the caller says a different callback number, use the number they said in the voicemail.
- If name is missing, use "Unknown".
- If availability or preferred times are missing, use "Unknown".
- If athlete name or age is missing, use "Unknown".
- If skill is unclear, use "General inquiry".
- If category is unclear, use "General inquiry".
- If specific_interest is unclear, use the best short summary of what they asked for.
- If department is unclear, use "Other / Unsure".
- If urgency is not obvious, use "Normal".
- Tumbling includes back tuck, back handspring, flips, tumbling, aerials, handsprings, roundoffs.
- Strength Skills includes handstands, rings, calisthenics, strength skills, bodyweight strength.
- Competitive Team includes competitive gymnastics, cheer, acro, dance, team athlete, meet season, routines.
- Notes should be a short useful summary for a coach.
          `.trim(),
        },
        {
          role: 'user',
          content: `
Caller phone from Twilio: ${callerPhone}

Transcript:
${transcript}
          `.trim(),
        },
      ],
    });

    const lead = JSON.parse(extraction.choices[0].message.content);

    const finalLead = {
      name: lead.name || 'Unknown',
      phone: lead.phone || callerPhone || 'Unknown',
      category: lead.category || lead.skill || 'General inquiry',
      specific_interest:
        lead.specific_interest || lead.skill || 'General inquiry',
      skill: lead.skill || lead.specific_interest || 'General inquiry',
      availability:
        lead.availability || lead.preferred_times || 'Unknown',
      preferred_times:
        lead.preferred_times || lead.availability || 'Unknown',
      person_type: lead.person_type || 'Other / Unsure',
      athlete_name: lead.athlete_name || 'Unknown',
      athlete_age: lead.athlete_age || 'Unknown',
      department: lead.department || 'Other / Unsure',
      urgency: lead.urgency || 'Normal',
      notes: lead.notes || '',
      transcript,
    };

    console.log('STRUCTURED LEAD:', finalLead);

    const time = timestampNow();

    // Voicemails tab: raw intake archive
    await appendToSheet(VOICEMAILS_SHEET_NAME, [
      time,
      finalLead.name,
      finalLead.phone,
      finalLead.skill,
      finalLead.availability,
      finalLead.person_type,
      finalLead.athlete_name,
      finalLead.athlete_age,
      finalLead.department,
      finalLead.notes,
      finalLead.transcript,
    ]);

    console.log('Lead added to Voicemails sheet');

    // Leads tab: clean coach-facing board
    await appendToSheet(LEADS_SHEET_NAME, [
      time,
      finalLead.name,
      finalLead.phone,
      finalLead.category,
      finalLead.specific_interest,
      finalLead.person_type,
      finalLead.preferred_times,
      finalLead.notes,
      finalLead.urgency,
      finalLead.department,
      'New',
    ]);

    console.log('Lead added to Leads sheet');
    await sendAutoText(finalLead.phone);

    res.sendStatus(200);
  } catch (error) {
    console.error('Voicemail processing failed:', error);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});