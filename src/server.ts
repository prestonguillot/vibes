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
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true in production with HTTPS
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
app.get('/api/status', (req, res) => {
  res.json({
    spotify: !!req.session.spotifyTokens,
    youtube: !!req.session.youtubeTokens
  });
});

app.listen(PORT, () => {
  console.log(`🎵 Spotify-YouTube Sync server running on http://localhost:${PORT}`);
});
