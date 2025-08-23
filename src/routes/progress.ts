import { Router, Request, Response } from 'express';
import { Logger } from '../utils/logger';

const router = Router();

// Store active SSE connections for each playlist
const progressConnections = new Map<string, Response[]>();

// SSE endpoint for real-time progress updates
router.get('/playlist/:playlistId', (req: Request, res: Response) => {
  const playlistId = req.params.playlistId;
  
  Logger.info('SSE connection established', { playlistId });
  
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Add this connection to the playlist's connection list
  if (!progressConnections.has(playlistId)) {
    progressConnections.set(playlistId, []);
  }
  progressConnections.get(playlistId)!.push(res);

  // Send initial connection confirmation
  res.write(`data: ${JSON.stringify({
    type: 'connected',
    message: 'Progress updates connected',
    timestamp: new Date().toISOString()
  })}\n\n`);

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
export function sendProgressUpdate(playlistId: string, update: {
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

  const data = JSON.stringify({
    ...update,
    timestamp: update.timestamp || new Date().toISOString()
  });

  Logger.debug('Sending progress update', { playlistId, clientCount: connections.length, message: update.message });

  // Send to all connected clients for this playlist
  connections.forEach((res, index) => {
    try {
      res.write(`data: ${data}\n\n`);
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
        res.write(`data: ${JSON.stringify({ type: 'close' })}\n\n`);
        res.end();
      } catch (error) {
        Logger.warn('Error closing SSE connection', { playlistId }, error);
      }
    });
    progressConnections.delete(playlistId);
  }
}

export { router as progressRouter };
