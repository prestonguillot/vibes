// A sync progress update, rendered to HTML and streamed to the client.
export interface ProgressUpdate {
  type: 'progress' | 'complete' | 'error';
  message: string;
  details?: string;
  currentTrack?: number;
  totalTracks?: number;
  currentSong?: string;
  currentArtist?: string;
  percentage?: number;
  timestamp?: string;
}
