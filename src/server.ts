import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import cors from 'cors';
import path from 'path';
import { spotifyRouter } from './routes/spotify';
import { youtubeRouter } from './routes/youtube';
import { syncRouter } from './routes/sync';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  // Skip logging for static assets and favicon to reduce noise
  if (req.originalUrl.includes('.css') || req.originalUrl.includes('.js') || 
      req.originalUrl.includes('.png') || req.originalUrl.includes('.ico') ||
      req.originalUrl.includes('/favicon')) {
    return next();
  }
  
  console.log(`\n [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  console.log(` Full URL: ${req.protocol}://${req.get('host')}${req.originalUrl}`);
  console.log(` User-Agent: ${req.get('User-Agent')?.slice(0, 100) || 'none'}...`);
  console.log(` Session ID: ${req.sessionID || 'none'}`);
  
  if (Object.keys(req.query).length > 0) {
    console.log(` Query: ${JSON.stringify(req.query)}`);
  }
  if (Object.keys(req.body).length > 0) {
    console.log(` Body: ${JSON.stringify(req.body)}`);
  }
  
  // Log response when it finishes
  const originalSend = res.send;
  res.send = function(data) {
    console.log(` Response: ${res.statusCode} ${res.statusMessage} (${data?.length || 0} bytes)`);
    return originalSend.call(this, data);
  };
  
  next();
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true in production with HTTPS
    httpOnly: true, // Prevent XSS attacks
    maxAge: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    sameSite: 'lax' // CSRF protection while allowing OAuth redirects
  },
  name: 'spotify-youtube-session', // Custom session name
  rolling: true // Reset expiration on each request
}));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// View engine setup (for serving HTML templates)
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'html');
app.engine('html', (filePath, options, callback) => {
  const fs = require('fs');
  fs.readFile(filePath, (err: any, content: Buffer) => {
    if (err) return callback(err);
    const rendered = content.toString();
    return callback(null, rendered);
  });
});

// Routes
app.use('/auth/spotify', spotifyRouter);
app.use('/auth/youtube', youtubeRouter);
app.use('/api/sync', syncRouter);

// Main page
app.get('/', (req, res) => {
  res.render('index');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Connection status check
app.get('/api/status', async (req, res) => {
  let spotifyConnected = false;
  let youtubeConnected = false;

  // Test Spotify connection
  if (req.session.spotifyTokens) {
    try {
      const spotifyApi = new (require('spotify-web-api-node'))({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI
      });
      
      spotifyApi.setAccessToken(req.session.spotifyTokens.accessToken);
      spotifyApi.setRefreshToken(req.session.spotifyTokens.refreshToken);
      
      // Test with a lightweight API call
      await spotifyApi.getMe();
      spotifyConnected = true;
      console.log(`✅ Spotify connection validated for session ${req.sessionID}`);
    } catch (error: any) {
      console.log(`❌ Spotify connection invalid for session ${req.sessionID}:`, error.message);
      // Try to refresh the token
      if (error.statusCode === 401 && req.session.spotifyTokens.refreshToken) {
        try {
          const spotifyApi = new (require('spotify-web-api-node'))({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
            redirectUri: process.env.SPOTIFY_REDIRECT_URI
          });
          
          spotifyApi.setAccessToken(req.session.spotifyTokens.accessToken);
          spotifyApi.setRefreshToken(req.session.spotifyTokens.refreshToken);
          
          const data = await spotifyApi.refreshAccessToken();
          const { access_token } = data.body;
          
          // Update session with new token
          req.session.spotifyTokens.accessToken = access_token;
          spotifyConnected = true;
          console.log(`🔄 Spotify token refreshed for session ${req.sessionID}`);
        } catch (refreshError) {
          console.log(`❌ Failed to refresh Spotify token for session ${req.sessionID}`);
          // Clear invalid tokens
          delete req.session.spotifyTokens;
        }
      } else {
        // Clear invalid tokens
        delete req.session.spotifyTokens;
      }
    }
  }

  // Test YouTube connection
  if (req.session.youtubeTokens) {
    try {
      const { google } = require('googleapis');
      const oauth2Client = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        process.env.YOUTUBE_REDIRECT_URI
      );
      
      oauth2Client.setCredentials(req.session.youtubeTokens);
      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
      
      // Test with a lightweight API call
      await youtube.channels.list({ part: ['id'], mine: true, maxResults: 1 });
      youtubeConnected = true;
      console.log(`✅ YouTube connection validated for session ${req.sessionID}`);
    } catch (error: any) {
      console.log(`❌ YouTube connection invalid for session ${req.sessionID}:`, error.message);
      // Try to refresh the token
      if (error.code === 401 && req.session.youtubeTokens.refresh_token) {
        try {
          const { google } = require('googleapis');
          const oauth2Client = new google.auth.OAuth2(
            process.env.YOUTUBE_CLIENT_ID,
            process.env.YOUTUBE_CLIENT_SECRET,
            process.env.YOUTUBE_REDIRECT_URI
          );
          
          oauth2Client.setCredentials(req.session.youtubeTokens);
          const { credentials } = await oauth2Client.refreshAccessToken();
          
          // Update session with new tokens
          req.session.youtubeTokens = {
            ...req.session.youtubeTokens,
            ...credentials
          };
          youtubeConnected = true;
          console.log(`🔄 YouTube token refreshed for session ${req.sessionID}`);
        } catch (refreshError) {
          console.log(`❌ Failed to refresh YouTube token for session ${req.sessionID}`);
          // Clear invalid tokens
          delete req.session.youtubeTokens;
        }
      } else {
        // Clear invalid tokens
        delete req.session.youtubeTokens;
      }
    }
  }

  res.json({
    spotify: spotifyConnected,
    youtube: youtubeConnected
  });
});

app.listen(PORT, () => {
  console.log(` Spotify-YouTube Sync server running on http://localhost:${PORT}`);
});
