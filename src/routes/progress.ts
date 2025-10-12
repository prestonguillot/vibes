import { Router, Request, Response } from 'express';
import { Logger } from '../utils/logger';
import { validate, schemas } from '../utils/validation';
import { z } from 'zod';
import ejs from 'ejs';
import path from 'path';

const router = Router();

// Store active SSE connections for each playlist
const progressConnections = new Map<string, Response[]>();

// SSE endpoint for real-time progress updates
router.get('/playlist/:playlistId',
  validate({
    params: z.object({
      playlistId: schemas.spotifyPlaylistId
    })
  }),
  (req: Request, res: Response) => {
  const playlistId = req.params.playlistId;
  
  Logger.info('SSE connection established', { playlistId });
  
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
    // Note: No CORS headers - SSE connections should be same-origin only
  });

  // Add this connection to the playlist's connection list
  if (!progressConnections.has(playlistId)) {
    progressConnections.set(playlistId, []);
  }
  progressConnections.get(playlistId)!.push(res);

  // Send initial keepalive comment (prevents connection timeout)
  res.write(`: SSE connection established\n\n`);

  // Handle client disconnect
  req.on('close', () => {
    Logger.info('SSE connection closed', { playlistId });
    const connections = progressConnections.get(playlistId);
    if (connections) {
      const index = connections.indexOf(res);
      if (index !== -1) {
        connections.splice(index, 1);
      }
      if (connections.length === 0) {
        progressConnections.delete(playlistId);
      }
    }
  });
});

// Function to send progress update to all connected clients for a playlist
export async function sendProgressUpdate(playlistId: string, update: {
  type: 'progress' | 'complete' | 'error';
  message: string;
  details?: string;
  currentTrack?: number;
  totalTracks?: number;
  currentSong?: string;
  currentArtist?: string;
  percentage?: number;
  timestamp?: string;
}) {
  const connections = progressConnections.get(playlistId);
  if (!connections || connections.length === 0) {
    return;
  }

  // Generate HTML for the progress update using EJS
  const viewsPath = path.join(__dirname, '../../views');
  const html = await ejs.renderFile(path.join(viewsPath, 'partials/progress-update.ejs'), {
    message: update.message,
    details: update.details,
    percentage: update.percentage || 0,
    type: update.type
  });

  // Minify HTML to single line for SSE format compliance
  // SSE requires data to be on a single line or each line prefixed with "data: "
  const minifiedHtml = html.replace(/\s+/g, ' ').trim();

  Logger.debug('Sending progress update', { playlistId, clientCount: connections.length, message: update.message });

  // Send to all connected clients for this playlist
  // Use 'message' event type for HTMX SSE extension
  connections.forEach((res, index) => {
    try {
      res.write(`event: message\ndata: ${minifiedHtml}\n\n`);
    } catch (error) {
      Logger.warn('Failed to send progress update to client', { playlistId, clientIndex: index }, error);
      // Remove failed connection
      connections.splice(index, 1);
    }
  });

  // Clean up empty connection arrays
  if (connections.length === 0) {
    progressConnections.delete(playlistId);
  }
}

// Function to close all connections for a playlist (when sync completes)
export function closeProgressConnections(playlistId: string) {
  const connections = progressConnections.get(playlistId);
  if (connections) {
    Logger.info('Closing SSE connections', { playlistId, connectionCount: connections.length });
    connections.forEach(res => {
      try {
        // Just end the connection cleanly without sending data
        res.end();
      } catch (error) {
        Logger.warn('Error closing SSE connection', { playlistId }, error);
      }
    });
    progressConnections.delete(playlistId);
  }
}

export { router as progressRouter };
