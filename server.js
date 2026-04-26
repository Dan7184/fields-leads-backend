const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Health check route
app.get('/health', (req, res) => {
  res.send('Backend is live');
});

// Twilio voicemail webhook test route
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

app.post('/twilio/voicemail-recording', (req, res) => {
  console.log('Twilio recording webhook hit');
  console.log('Recording body:', req.body);

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});