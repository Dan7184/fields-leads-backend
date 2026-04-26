const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

// Health check route
app.get('/health', (req, res) => {
  res.send('Backend is live');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});