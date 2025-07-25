# Spotify to YouTube Playlist Sync

A web application that syncs your Spotify playlists to YouTube playlists with music videos.

## Features

- 🎵 Connect to your Spotify account
- 📺 Connect to your YouTube account  
- 🔄 Sync playlists from Spotify to YouTube
- 🎬 Automatically finds official music videos (with fallbacks to concert footage/fan videos)
- 💻 Modern web interface using HTMX and Hyperscript
- 🚀 Easy local development and deployment

## Tech Stack

- **Backend**: Node.js with TypeScript, Express
- **Frontend**: HTMX, Hyperscript, Bootstrap 5
- **APIs**: Spotify Web API, YouTube Data API v3

## Setup

### Prerequisites

1. **Spotify App**: Create a Spotify app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. **YouTube API**: Enable YouTube Data API v3 in [Google Cloud Console](https://console.cloud.google.com/)

### Installation

1. Clone the repository and install dependencies:
```bash
npm install
```

2. Copy the environment file and fill in your API credentials:
```bash
cp .env.example .env
```

3. Edit `.env` with your API credentials:
```env
# Server Configuration
PORT=3000
NODE_ENV=development
SESSION_SECRET=your-random-session-secret

# Spotify API Configuration
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/auth/spotify/callback

# YouTube API Configuration
YOUTUBE_CLIENT_ID=your-youtube-client-id
YOUTUBE_CLIENT_SECRET=your-youtube-client-secret
YOUTUBE_REDIRECT_URI=http://localhost:3000/auth/youtube/callback
YOUTUBE_API_KEY=your-youtube-api-key
```

### Development

Run the development server:
```bash
npm run dev
```

The app will be available at `http://localhost:3000`

### Production

Build and run for production:
```bash
npm run build
npm start
```

## API Setup Instructions

### Spotify API Setup

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click "Create App"
3. Fill in app details:
   - App name: "Spotify YouTube Sync"
   - App description: "Sync Spotify playlists to YouTube"
   - Redirect URI: `http://127.0.0.1:3000/auth/spotify/callback`
4. Copy the Client ID and Client Secret to your `.env` file

### YouTube API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the YouTube Data API v3
4. Create credentials:
   - Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client IDs"
   - Application type: Web application
   - Authorized redirect URIs: `http://127.0.0.1:3000/auth/youtube/callback`
5. Also create an API Key for YouTube searches
6. Copy the Client ID, Client Secret, and API Key to your `.env` file

## Usage

1. Start the application
2. Connect your Spotify account
3. Connect your YouTube account
4. Load your Spotify playlists
5. Click "Sync to YouTube" on any playlist
6. The app will create a private YouTube playlist with music videos

## Deployment

This app is designed to be easily deployable to platforms like:
- Vercel
- Netlify
- Railway
- Heroku
- DigitalOcean App Platform

Make sure to update the redirect URIs in your Spotify and YouTube app settings to match your production domain.

## License

MIT
