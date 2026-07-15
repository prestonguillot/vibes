import { Logger } from '../lib/logger';

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
  channelTitle?: string;
  /** Optional view count. Only set on search-result candidates (the scraper
   *  provides it); the playlist-matching path leaves it unset so that path stays
   *  deterministic. See the popularity nudge in calculateMatchScore. */
  viewCount?: number;
}

/**
 * Detect if a video is an official music video from an artist/label account.
 * Uses only stable signals (title + channel name) so matching stays deterministic.
 */
function isOfficialVideo(youtubeVideo: SimplifiedVideo, spotifyArtist: string): boolean {
  const channel = (youtubeVideo.channelTitle || '').toLowerCase();
  const normalizedArtist = spotifyArtist.toLowerCase();

  // Check for official video indicators in title. Allows up to two qualifier words between
  // "official" and the media word so common variants match too (official music video, official
  // HD video, official lyric video, official visualizer, official video clip, official audio).
  const officialIndicators =
    /\bofficial\s+(?:\w+\s+){0,2}(?:video|audio|visuali[sz]er|lyrics?|clip|mv)\b/i;
  if (officialIndicators.test(youtubeVideo.title)) {
    // Additional check: channel should contain artist name or be a known label
    if (channel.includes(normalizedArtist) || isKnownLabel(channel)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if channel is a known record label or official music source
 */
function isKnownLabel(channel: string): boolean {
  const knownLabels = [
    'vevo',
    'universal',
    'sony',
    'warner',
    'republic',
    'geffen',
    'atlantic',
    'island',
    'capitol',
    'elektra',
    'mercy',
    'roadrunner',
    'nuclear blast',
    'metal blade',
    'earache',
    'century media',
    'prosthetic',
    'relapse',
  ];
  return knownLabels.some((label) => channel.includes(label));
}

/**
 * Score breakdown details for a match
 */
export interface ScoreBreakdown {
  totalScore: number;
  stars: number; // 0-5 star rating
  color: string; // hex color based on score
  components: {
    coreMatch?: number;
    artistBonus?: number;
    fuzzySimilarity?: number;
    wordMatching?: number;
    officialVideo?: number;
    viewCountBonus?: number;
  };
}

/**
 * Calculate how well a Spotify track matches a YouTube video, prioritizing official videos
 * @returns { score: number, breakdown: ScoreBreakdown }
 */
export function calculateMatchScore(
  spotifyTrack: SimplifiedTrack,
  youtubeVideo: SimplifiedVideo,
): { score: number; breakdown: ScoreBreakdown } {
  // Extract core titles by removing metadata
  const coreTrackName = extractCoreTitle(spotifyTrack.name);
  const coreArtistName = normalizeText(spotifyTrack.artist);
  const coreVideoTitle = extractCoreTitle(youtubeVideo.title);

  let score = 0;
  const components: ScoreBreakdown['components'] = {};

  // Strategy 1: Core track title exact match (highest priority)
  //
  // Both sides must be non-empty. extractCoreTitle/normalizeText can reduce a name to '' (a title
  // that is nothing but metadata, an artist that is only punctuation), and `x.includes('')` is
  // always true in JS - so an empty core would award this 0.6 (plus the artist bonus) against
  // EVERY video, sail past the 0.4 threshold, and let a meaningless match outrank and steal the
  // video that belongs to a real track.
  if (
    coreTrackName &&
    coreVideoTitle &&
    (coreVideoTitle.includes(coreTrackName) || coreTrackName.includes(coreVideoTitle))
  ) {
    score += 0.6;
    components.coreMatch = 0.6;

    // Bonus if artist is also mentioned
    if (
      coreArtistName &&
      (coreVideoTitle.includes(coreArtistName) ||
        youtubeVideo.title.toLowerCase().includes(coreArtistName))
    ) {
      score += 0.15;
      components.artistBonus = 0.15;
    }
  } else {
    // Strategy 2: Core title similarity (for slight variations)
    const titleSimilarity = calculateStringSimilarity(coreTrackName, coreVideoTitle);
    if (titleSimilarity > 0.8) {
      const fuzzySimilarityScore = 0.5 * titleSimilarity;
      score += fuzzySimilarityScore;
      components.fuzzySimilarity = fuzzySimilarityScore;

      // Bonus if artist matches
      if (
        coreArtistName &&
        (coreVideoTitle.includes(coreArtistName) ||
          youtubeVideo.title.toLowerCase().includes(coreArtistName))
      ) {
        score += 0.15;
        components.artistBonus = 0.15;
      }
    } else {
      // Strategy 3: Word-by-word core matching
      const trackCoreWords = coreTrackName.split(' ').filter((w) => w.length > 2);
      const videoCoreWords = coreVideoTitle.split(' ').filter((w) => w.length > 2);

      if (trackCoreWords.length > 0) {
        const coreWordMatches = trackCoreWords.filter((word) =>
          videoCoreWords.some(
            (vw) =>
              vw === word ||
              vw.includes(word) ||
              word.includes(vw) ||
              calculateStringSimilarity(word, vw) > 0.85,
          ),
        ).length;

        const coreMatchRatio = coreWordMatches / trackCoreWords.length;
        if (coreMatchRatio > 0.5) {
          const wordMatchScore = 0.4 * coreMatchRatio;
          score += wordMatchScore;
          components.wordMatching = wordMatchScore;
        }
      }
    }
  }

  // Strategy 4: Artist name matching (secondary)
  const videoTitle = normalizeText(youtubeVideo.title);
  if (coreArtistName && videoTitle.includes(coreArtistName) && !components.artistBonus) {
    score += 0.1;
    components.artistBonus = 0.1;
  }

  // The quality bonuses below are TIEBREAKERS between candidates that already resemble the track -
  // they are not evidence of a match on their own. Without any title/artist signal there is nothing
  // to break a tie between, and officialVideo (0.3) + viewCountBonus (0.1) alone would reach the
  // 0.4 threshold, letting a track whose title we cannot read match a popular official video.
  const hasTextSignal =
    !!components.coreMatch ||
    !!components.fuzzySimilarity ||
    !!components.wordMatching ||
    !!components.artistBonus;

  // QUALITY BONUS: prefer an official music video from the artist's / a label's
  // channel. Uses only stable signals (title + channel).
  if (hasTextSignal && isOfficialVideo(youtubeVideo, spotifyTrack.artist)) {
    score += 0.3;
    components.officialVideo = 0.3;
  }

  // POPULARITY NUDGE: when a view count is available (search-result candidates
  // carry one; the playlist-matching path does not), add a small, log-scaled,
  // capped bonus so near-ties resolve toward the canonical/popular upload without
  // overriding the text and artist signals. Only applied when a count is present,
  // so the no-view-count path is unchanged and deterministic.
  if (hasTextSignal && typeof youtubeVideo.viewCount === 'number' && youtubeVideo.viewCount > 0) {
    const viewBonus = Math.min(0.1, Math.log10(youtubeVideo.viewCount) / 100);
    score += viewBonus;
    components.viewCountBonus = viewBonus;
  }

  const finalScore = Math.min(score, 1.0);
  const stars = Math.round(finalScore * 5 * 10) / 10; // Round to 1 decimal place
  const color = scoreToColor(finalScore);

  return {
    score: finalScore,
    breakdown: {
      totalScore: finalScore,
      stars,
      color,
      components,
    },
  };
}

/**
 * Convert a score (0-1) to a gradient color from red to green
 */
function scoreToColor(score: number): string {
  // 0.0-0.4: Red (#FF0000 to #FF8800)
  // 0.4-0.6: Orange/Yellow (#FF8800 to #FFFF00)
  // 0.6-0.8: Yellow-Green (#FFFF00 to #88FF00)
  // 0.8-1.0: Green (#88FF00 to #00FF00)

  if (score < 0.4) {
    // Red to Orange: 0.0 -> 1.0
    const t = score / 0.4;
    const r = 255;
    const g = Math.round(136 * t); // 0 to 136
    const b = 0;
    return `rgb(${r}, ${g}, ${b})`;
  } else if (score < 0.6) {
    // Orange to Yellow: 0.0 -> 1.0
    const t = (score - 0.4) / 0.2;
    const r = 255;
    const g = Math.round(136 + 119 * t); // 136 to 255
    const b = 0;
    return `rgb(${r}, ${g}, ${b})`;
  } else if (score < 0.8) {
    // Yellow to Yellow-Green: 0.0 -> 1.0
    const t = (score - 0.6) / 0.2;
    const r = Math.round(255 - 167 * t); // 255 to 88
    const g = 255;
    const b = 0;
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Yellow-Green to Green: 0.0 -> 1.0
    const t = (score - 0.8) / 0.2;
    const r = Math.round(88 - 88 * t); // 88 to 0
    const g = 255;
    const b = 0;
    return `rgb(${r}, ${g}, ${b})`;
  }
}

function extractCoreTitle(title: string): string {
  let coreTitle = title;

  // FIRST: Remove metadata in parentheses/brackets BEFORE normalization
  // This ensures we catch patterns like (Official Video), (Official Audio), etc.
  coreTitle = coreTitle
    .replace(
      /\s*\(\s*(official|remaster|live|acoustic|demo|radio|edit|mix|version|instrumental|audio|video)\s*\).*$/i,
      '',
    )
    .trim();
  coreTitle = coreTitle
    .replace(
      /\s*\[\s*(official|remaster|live|acoustic|demo|radio|edit|mix|version|instrumental|audio|video)\s*\].*$/i,
      '',
    )
    .trim();

  // Remove other metadata patterns before normalization
  const metadataPatterns = [
    /\s*-\s*(remaster|live|acoustic|demo|radio|edit|mix|version|instrumental).*$/i,
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

  // THEN: Normalize after removing the obvious metadata
  coreTitle = normalizeText(coreTitle);

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
    .replace(/\b(ft|feat|featuring)\b/g, '') // Only remove collaboration markers
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
  const matrix = Array(str2.length + 1)
    .fill(null)
    .map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) matrix[0]![i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j]![0] = j;

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j]![i] = Math.min(
        matrix[j]![i - 1] + 1, // deletion
        matrix[j - 1]![i] + 1, // insertion
        matrix[j - 1]![i - 1] + indicator, // substitution
      );
    }
  }

  return matrix[str2.length]![str1.length]!;
}

/**
 * Result of optimal track matching including scores
 */
export interface MatchingResult {
  matches: Map<string, SimplifiedVideo>;
  scores: Map<string, ScoreBreakdown>; // Track ID -> Score breakdown
  /**
   * Tracks that lost a video to a DIFFERENT Spotify track for the same song.
   *
   * The playlist holds the song twice under two track ids; the matcher awards the one video to
   * one of them, and sync's one-video-one-slot rule means the loser can never link - a search just
   * returns that same video and sync drops it as a duplicate. Callers need this to tell drift a
   * sync could fix from drift it provably cannot.
   *
   * Deliberately not "lost any viable candidate": a weak fuzzy near-miss (e.g. "Song B" scoring
   * 0.42 against a "Song A" video) is not the same song, and a search can still find it its own
   * video - treating that as unresolvable would silence legitimate drift.
   */
  contested: Set<string>;
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
 * @returns MatchingResult with matches map and scores map
 */
export function optimalTrackMatching(
  tracks: SimplifiedTrack[],
  videos: SimplifiedVideo[],
): MatchingResult {
  const minScore = 0.4; // Minimum similarity threshold

  // Step 1: Calculate all match scores
  interface MatchCandidate {
    track: SimplifiedTrack;
    video: SimplifiedVideo;
    score: number;
    breakdown: ScoreBreakdown;
  }

  const candidates: MatchCandidate[] = [];

  for (const track of tracks) {
    for (const video of videos) {
      const { score, breakdown } = calculateMatchScore(track, video);
      if (score >= minScore) {
        candidates.push({ track, video, score, breakdown });
      }
    }
  }

  // Step 2: Sort by score (highest first)
  candidates.sort((a, b) => b.score - a.score);

  // Step 3: Greedy assignment - assign best matches first
  const assignedTracks = new Set<string>();
  const assignedVideos = new Set<string>();
  const matches = new Map<string, SimplifiedVideo>();
  const scores = new Map<string, ScoreBreakdown>();

  for (const candidate of candidates) {
    // Skip if this track or video is already assigned
    if (assignedTracks.has(candidate.track.id) || assignedVideos.has(candidate.video.id)) {
      continue;
    }

    // Assign this match
    matches.set(candidate.track.id, candidate.video);
    scores.set(candidate.track.id, candidate.breakdown);
    assignedTracks.add(candidate.track.id);
    assignedVideos.add(candidate.video.id);
  }

  // Which track actually won each video.
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const winnerByVideoId = new Map<string, SimplifiedTrack>();
  for (const [trackId, video] of matches) {
    const winner = trackById.get(trackId);
    if (winner) winnerByVideoId.set(video.id, winner);
  }

  const isSameSong = (a: SimplifiedTrack, b: SimplifiedTrack) =>
    normalizeText(a.name) === normalizeText(b.name) &&
    normalizeText(a.artist) === normalizeText(b.artist);

  // An unmatched track is unresolvable only if a video it wanted went to another track that is the
  // same song - i.e. the playlist genuinely contains the song twice.
  const contested = new Set<string>();
  for (const candidate of candidates) {
    if (matches.has(candidate.track.id)) continue;
    const winner = winnerByVideoId.get(candidate.video.id);
    if (winner && isSameSong(winner, candidate.track)) contested.add(candidate.track.id);
  }

  Logger.debug('Optimal matching results', {
    totalTracks: tracks.length,
    totalVideos: videos.length,
    candidatesEvaluated: candidates.length,
    successfulMatches: matches.size,
    unmatchedTracks: tracks.length - matches.size,
    contestedTracks: contested.size,
  });

  return { matches, scores, contested };
}
