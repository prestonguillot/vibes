import { scrapeYouTubeSearch, parseViewCount, SearchResult } from '../youtube/scraper';
import { Logger } from '../lib/logger';
import { calculateMatchScore, SimplifiedTrack, SimplifiedVideo } from './trackMatching';

/** A candidate as the picker modal shows it: the video, its score, and how the score was reached. */
export interface PickerVideo extends SimplifiedVideo {
  thumbnail: string;
  url: string;
  matchScore: ReturnType<typeof calculateMatchScore>['breakdown'];
  /** The score itself, kept alongside the breakdown so the template can sort and label by it. */
  matchScore_score: number;
}

/**
 * What to search YouTube for.
 *
 * A manual re-search sends its own query; the initial open has none and falls back to the track and
 * artist. A query of only spaces is not a query - it would search for nothing and return nothing.
 */
export const pickerQuery = (trackName: string, artistName: string, searchQuery?: string): string =>
  searchQuery?.trim() || `${trackName} ${artistName}`;

/**
 * Score the candidates against the track, best first.
 *
 * viewCount is parsed here because calculateMatchScore only applies its popularity bonus when
 * viewCount is a number. Leaving it out does not fail - it silently drops the bonus, and the picker
 * then ranks candidates differently from the sync that chose the video in the first place.
 */
export function scoreCandidates(track: SimplifiedTrack, results: SearchResult[]): PickerVideo[] {
  return results
    .map((result) => {
      const video: SimplifiedVideo = {
        id: result.videoId,
        title: result.title,
        description: `Duration: ${result.duration} • Views: ${result.views}`,
        channelTitle: result.channel,
        viewCount: parseViewCount(result.views),
      };
      const { score, breakdown } = calculateMatchScore(track, video);
      return {
        ...video,
        thumbnail: `https://img.youtube.com/vi/${result.videoId}/mqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${result.videoId}`,
        matchScore: breakdown,
        matchScore_score: score,
      };
    })
    .sort((a, b) => b.matchScore_score - a.matchScore_score);
}

/** Search YouTube for videos for this track and score them, best first. */
export async function searchCandidates(
  track: SimplifiedTrack,
  searchQuery: string | undefined,
  maxResults = 10,
): Promise<{ query: string; videos: PickerVideo[] }> {
  const query = pickerQuery(track.name, track.artist, searchQuery);
  Logger.external('YouTube', 'Searching for videos', { query });

  const results = await scrapeYouTubeSearch(query, maxResults);
  const videos = scoreCandidates(track, results);

  Logger.info('Found alternative videos', { count: videos.length });
  return { query, videos };
}
