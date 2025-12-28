import express from 'express';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const app = express();
const port = 4112;

// OAuth2 Client Configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/oauth2callback`
);

// Scopes required for Gmail and Calendar
const scopes = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly'
];

// Generate the authentication URL
const authorizationUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // Critical for getting a refresh token
  scope: scopes,
  prompt: 'consent' // Forces consent screen to ensure refresh token is returned
});

// Root route to start the flow
app.get('/', (req, res) => {
  res.redirect(authorizationUrl);
});

// Callback route
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;

  if (code && typeof code === 'string') {
    try {
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      console.log('\n✅ AUTHENTICATION SUCCESSFUL!\n');
      console.log('Update your .env file with this REFRESH TOKEN:');
      console.log('--------------------------------------------------');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('--------------------------------------------------');
      
      if (!tokens.refresh_token) {
        console.warn('⚠️ No refresh token returned. Did you already authorize this app?');
        console.warn('Try revoking access for this app in your Google Account Security settings and try again to get a new refresh token.');
      }

      res.send(`
        <h1>Authentication Successful!</h1>
        <p>Check your terminal for the Refresh Token.</p>
        <p>You can close this window.</p>
      `);
      
      // Close server after a slight delay to allow response to send
      setTimeout(() => {
        console.log('Shutting down server...');
        process.exit(0);
      }, 5000);

    } catch (error) {
      console.error('Error getting tokens:', error);
      res.status(500).send('Authentication failed');
    }
  } else {
    res.status(400).send('No code received');
  }
});

app.listen(port, () => {
  console.log(`\n🤖 Google Auth Helper Running!`);
  console.log(`👉 Open this URL in your browser to authenticate:\n`);
  console.log(`   http://localhost:${port}\n`);
});
