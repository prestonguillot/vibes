/**
 * STEP 3 of sync: search YouTube (via the quota-free scraper) for a video per
 * Spotify track, in order. Pulled out of the sync route so the handler reads as
 * named phases and this loop can be tested in isolation.
 */

import { searchMusicVideo } from '../utils/youtubeScraper';
import { formatErrorDetails } from '../utils/errorFormatter';
import { Logger } from '../utils/logger';
import { ProgressUpdate } from '../routes/progress';

export interface TrackSearchResult {
  track: string;
  artist: string;
  found: boolean;
  videoId?: string;
  spotifyPosition: number;
  spotifyTrackId: string;
}

interface SearchTrackItem {
  track: { id: string; name: string; artists: Array<{ name?: string }>; type?: string } | null;
}

export interface SearchOptions {
  isUpdateMode: boolean;
  /** Number of videos already in the YouTube playlist (update mode position offset). */
  existingVideoCount: number;
  /** Total tracks in the playlist (used for the inter-search rate-limit guard). */
  totalTrackCount: number;
  /** Fraction of overall progress the search phase represents (e.g. 0.7). */
  searchPhaseWeight: number;
  /** Emits a progress/error payload to the SSE channel. */
  emitProgress: (payload: ProgressUpdate) => void;
}

/**
 * Searches for a video for each track that needs one, preserving Spotify order.
 * Returns the found video IDs (in order) and a per-track result record.
 */
export async function searchTracksForVideos(
  tracksToSearch: unknown[],
  opts: SearchOptions
): Promise<{ videoIds: string[]; searchResults: TrackSearchResult[] }> {
  const { isUpdateMode, existingVideoCount, totalTrackCount, searchPhaseWeight, emitProgress } = opts;
  const videoIds: string[] = [];
  const searchResults: TrackSearchResult[] = [];
  let searchCount = 0;

  const searchMessage = isUpdateMode ? 'Checking for playlist updates' : 'Finding music videos';
  Logger.info(`Starting video search: ${searchMessage}`, { tracksToSearch: tracksToSearch.length });

  for (let i = 0; i < tracksToSearch.length; i++) {
    const typedItem = tracksToSearch[i] as SearchTrackItem;
    if (!typedItem.track || typedItem.track.type !== 'track') continue;

    const track = typedItem.track;
    const artist = track.artists[0]?.name || 'Unknown Artist';
    const songName = track.name;
    // Update mode appends after the existing items; create mode starts at 0.
    const spotifyPosition = isUpdateMode ? existingVideoCount + i : i;

    try {
      Logger.debug('Searching for track', { trackNumber: searchCount + 1, totalTracks: tracksToSearch.length, artist, songName });

      const searchProgress = (searchCount / tracksToSearch.length) * searchPhaseWeight;
      emitProgress({
        type: 'progress',
        message: isUpdateMode ? 'Checking for playlist updates' : 'Finding music videos',
        details: isUpdateMode
          ? `Analyzing "${songName}" by ${artist}... (${searchCount + 1}/${tracksToSearch.length})`
          : `Searching for "${songName}" by ${artist}... (${searchCount + 1}/${tracksToSearch.length})`,
        currentTrack: searchCount + 1,
        totalTracks: tracksToSearch.length,
        currentSong: songName,
        currentArtist: artist,
        percentage: Math.round(searchProgress * 100)
      });

      const videoId = await searchMusicVideo(artist, songName);
      searchCount++;

      if (videoId) {
        videoIds.push(videoId);
        searchResults.push({ track: songName, artist, found: true, videoId, spotifyPosition, spotifyTrackId: track.id });
        Logger.info('Found video for track', { songName, artist, videoId, spotifyPosition });
      } else {
        searchResults.push({ track: songName, artist, found: false, spotifyPosition, spotifyTrackId: track.id });
        Logger.warn('No video found for track', { songName, artist, spotifyPosition });
      }

      // Rate limiting: small delay between searches to be respectful.
      if (searchCount < totalTrackCount) {
        Logger.debug('Rate limiting delay', { delayMs: 100 });
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      searchCount++;
      Logger.error('Error searching for track', { artist, songName }, error);
      emitProgress({ type: 'error', message: 'Error searching for video', details: formatErrorDetails(error) });
      searchResults.push({ track: songName, artist, found: false, spotifyPosition, spotifyTrackId: track.id });
    }
  }

  Logger.info('Scraping completed', { searchesMade: searchCount, videosFound: videoIds.length, quotaSaved: searchCount * 100 });
  return { videoIds, searchResults };
}
