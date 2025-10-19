import { Logger } from './logger';

// Types for track matching
export interface SimplifiedTrack {
  id: string;
  name: string;
  artist: string;
}

export interface SimplifiedVideo {
  id: string;
  title: string;
  description: string;
  playlistItemId?: string;
}

/**
 * Calculate how well a Spotify track matches a YouTube video
 */
function calculateMatchScore(spotifyTrack: SimplifiedTrack, youtubeVideo: SimplifiedVideo): number {
  // Extract core titles by removing metadata
  const coreTrackName = extractCoreTitle(spotifyTrack.name);
  const coreArtistName = normalizeText(spotifyTrack.artist);
  const coreVideoTitle = extractCoreTitle(youtubeVideo.title);

  let score = 0;

  // Strategy 1: Core track title exact match (highest priority)
  if (coreVideoTitle.includes(coreTrackName) || coreTrackName.includes(coreVideoTitle)) {
    score += 0.8;

    // Bonus if artist is also mentioned
    if (coreVideoTitle.includes(coreArtistName) || youtubeVideo.title.toLowerCase().includes(coreArtistName)) {
      score += 0.2;
    }
    return Math.min(score, 1.0);
  }

  // Strategy 2: Core title similarity (for slight variations)
  const titleSimilarity = calculateStringSimilarity(coreTrackName, coreVideoTitle);
  if (titleSimilarity > 0.8) {
    score += 0.7 * titleSimilarity;

    // Bonus if artist matches
    if (coreVideoTitle.includes(coreArtistName) || youtubeVideo.title.toLowerCase().includes(coreArtistName)) {
      score += 0.2;
    }
  }

  // Strategy 3: Word-by-word core matching
  const trackCoreWords = coreTrackName.split(' ').filter(w => w.length > 2);
  const videoCoreWords = coreVideoTitle.split(' ').filter(w => w.length > 2);

  if (trackCoreWords.length > 0) {
    const coreWordMatches = trackCoreWords.filter(word =>
      videoCoreWords.some(vw =>
        vw === word || vw.includes(word) || word.includes(vw) ||
        calculateStringSimilarity(word, vw) > 0.85
      )
    ).length;

    const coreMatchRatio = coreWordMatches / trackCoreWords.length;
    if (coreMatchRatio > 0.5) {
      score += 0.5 * coreMatchRatio;
    }
  }

  // Strategy 4: Artist name matching (secondary)
  const videoTitle = normalizeText(youtubeVideo.title);
  if (videoTitle.includes(coreArtistName)) {
    score += 0.2;
  }

  return Math.min(score, 1.0);
}

function extractCoreTitle(title: string): string {
  let coreTitle = normalizeText(title);

  // Remove everything after common metadata indicators
  const metadataPatterns = [
    /\s*-\s*(remaster|live|acoustic|demo|radio|edit|mix|version|instrumental).*$/i,
    /\s*\(\s*(remaster|live|acoustic|demo|radio|edit|mix|version|instrumental).*\).*$/i,
    /\s*\[\s*(remaster|live|acoustic|demo|radio|edit|mix|version|instrumental).*\].*$/i,
    /\s*-\s*\d{4}.*$/i, // Remove "- 2016 Remaster" etc.
    /\s*\(\s*\d{4}.*\).*$/i, // Remove "(2016 Remaster)" etc.
    /\s*\[\s*\d{4}.*\].*$/i, // Remove "[2016 Remaster]" etc.
    /\s*\(\s*with\s+.*?\).*$/i, // Remove "(with Artist)"
    /\s*\(\s*feat\.?\s+.*?\).*$/i, // Remove "(feat. Artist)"
    /\s*-\s*live\s+at.*$/i, // Remove "- Live at Venue"
    /\s*\(\s*live\s+at.*\).*$/i, // Remove "(Live at Venue)"
    /\s*,\s*pt\.?\s*\d+.*$/i, // Keep "Pt. 2" but remove metadata after it
  ];

  for (const pattern of metadataPatterns) {
    coreTitle = coreTitle.replace(pattern, '').trim();
  }

  // Special handling for "Pt." - keep it but remove what comes after
  coreTitle = coreTitle.replace(/(\s*,?\s*pt\.?\s*\d+).*$/i, '$1');

  // Clean up any remaining artifacts
  coreTitle = coreTitle
    .replace(/\s*-\s*$/, '') // Remove trailing dashes
    .replace(/\s*,\s*$/, '') // Remove trailing commas
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();

  return coreTitle;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .replace(/\b(official|video|audio|live|remix|version|ft|feat|featuring)\b/g, '') // Remove common extra words
    .trim();
}

function calculateStringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1.0;

  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const editDistance = calculateLevenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function calculateLevenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Optimal track-to-video matching algorithm
 *
 * Resolves conflicts by assigning videos to tracks based on match quality,
 * not processing order. If multiple tracks want the same video, the video
 * goes to the track with the highest match score.
 *
 * Algorithm:
 * 1. Calculate all match scores for all track-video pairs
 * 2. Sort pairs by score (highest first)
 * 3. Greedily assign: give each video to the track with the best match
 * 4. Skip tracks/videos that are already assigned
 *
 * @param tracks Array of Spotify tracks to match
 * @param videos Array of YouTube videos to match against
 * @returns Map of track ID -> matched video (only includes successful matches)
 */
export function optimalTrackMatching(
  tracks: SimplifiedTrack[],
  videos: SimplifiedVideo[]
): Map<string, SimplifiedVideo> {
  const minScore = 0.4; // Minimum similarity threshold

  // Step 1: Calculate all match scores
  interface MatchCandidate {
    track: SimplifiedTrack;
    video: SimplifiedVideo;
    score: number;
  }

  const candidates: MatchCandidate[] = [];

  for (const track of tracks) {
    for (const video of videos) {
      const score = calculateMatchScore(track, video);
      if (score >= minScore) {
        candidates.push({ track, video, score });
      }
    }
  }

  // Step 2: Sort by score (highest first)
  candidates.sort((a, b) => b.score - a.score);

  // Step 3: Greedy assignment - assign best matches first
  const assignedTracks = new Set<string>();
  const assignedVideos = new Set<string>();
  const matches = new Map<string, SimplifiedVideo>();

  for (const candidate of candidates) {
    // Skip if this track or video is already assigned
    if (assignedTracks.has(candidate.track.id) || assignedVideos.has(candidate.video.id)) {
      continue;
    }

    // Assign this match
    matches.set(candidate.track.id, candidate.video);
    assignedTracks.add(candidate.track.id);
    assignedVideos.add(candidate.video.id);
  }

  Logger.debug('Optimal matching results', {
    totalTracks: tracks.length,
    totalVideos: videos.length,
    candidatesEvaluated: candidates.length,
    successfulMatches: matches.size,
    unmatchedTracks: tracks.length - matches.size
  });

  return matches;
}