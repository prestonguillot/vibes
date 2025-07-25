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
  console.log(` Spotify-YouTube Sync server running on http://localhost:${PORT}`);
});
