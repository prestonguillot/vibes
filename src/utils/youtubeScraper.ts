import * as cheerio from 'cheerio';
import { Logger } from './logger';
import { calculateMatchScore } from './trackMatching';

interface SearchResult {
  videoId: string;
  title: string;
  duration: string;
  views: string;
  channel: string;
  description?: string;
  matchScore?: {
    score: number;
    breakdown: ReturnType<typeof calculateMatchScore>['breakdown'];
  };
}

/**
 * Parse a scraped YouTube view-count string ("1.5M views", "500K views",
 * "1,234,567 views") into a number. Returns 0 for unknown/unparseable values.
 */
export function parseViewCount(views: string | undefined): number {
  if (!views) return 0;
  const match = views.replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return 0;
  const unit = (match[2] || '').toUpperCase();
  const multiplier = unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1;
  return Math.round(num * multiplier);
}

/**
 * YouTube's scraped video data structure (partial)
 * Note: This is an incomplete type definition - YouTube's actual structure is much larger
 */
interface YouTubeScrapedVideoData {
  videoRenderer?: {
    videoId?: string;
    title?: {
      runs?: Array<{ text?: string }>;
      simpleText?: string;
    };
    lengthText?: { simpleText?: string };
    viewCountText?: { simpleText?: string };
    ownerText?: { runs?: Array<{ text?: string }> };
    longBylineText?: { runs?: Array<{ text?: string }> };
  };
}

/**
 * ⚠️ **LEGAL DISCLAIMER** ⚠️
 *
 * This module scrapes YouTube search results to avoid the expensive YouTube Data API search endpoint,
 * which costs 100 quota units per search (10,000 daily quota = only 100 searches per day).
 *
 * **IMPORTANT CONSIDERATIONS:**
 *
 * 1. **Terms of Service**: This scraping approach may violate YouTube's Terms of Service.
 *    Use at your own risk and consider the legal implications for your jurisdiction.
 *
 * 2. **Rate Limiting**: YouTube may detect and block scraping attempts. This implementation includes:
 *    - Realistic browser user-agent headers
 *    - Delays between requests (1 second)
 *    - Limited number of results per query
 *
 * 3. **Fragility**: YouTube's HTML structure may change at any time, breaking this scraper.
 *    Regular maintenance may be required.
 *
 * 4. **Alternative**: For production use or commercial applications, use the official YouTube Data API
 *    despite the quota costs, or apply for quota increases at:
 *    https://support.google.com/youtube/contact/yt_api_form
 *
 * 5. **Recommended Use Cases**:
 *    - Personal/hobby projects with low traffic
 *    - Development/testing environments
 *    - Proof-of-concept implementations
 *
 * For production deployments, strongly consider either:
 * - Purchasing additional YouTube API quota
 * - Implementing a caching layer to reduce API calls
 * - Using the official API search with selective caching
 * - Implementing user-driven search (users manually select videos)
 */

/**
 * Scrape YouTube search results for a given query
 * This avoids the expensive YouTube API search which costs 100 quota units per search
 *
 * @param query - Search query string
 * @param maxResults - Maximum number of results to return (default: 3)
 * @returns Array of search results with video IDs, titles, durations, views, and channels
 * @throws Error if scraping fails or is blocked by YouTube
 */
export async function scrapeYouTubeSearch(query: string, maxResults: number = 3): Promise<SearchResult[]> {
  const startTime = Date.now();
  Logger.debug(`🕷️ Scraping YouTube search for: "${query}"`);
  
  try {
    // Construct YouTube search URL
    const searchQuery = encodeURIComponent(query);
    const url = `https://www.youtube.com/results?search_query=${searchQuery}`;
    
    Logger.debug(`📡 Fetching: ${url}`);
    
    // Fetch the search results page. A timeout is essential: when YouTube throttles
    // the scraper it can hold the connection open, which would otherwise hang the
    // whole sync on one track. On timeout the abort surfaces as a caught error and
    // the track is skipped (searchTracksForVideos), so the sync keeps going.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        }
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    Logger.debug(`📄 Received HTML page (${html.length} chars)`);
    
    // Parse HTML with Cheerio
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    
    // Look for video data in script tags (YouTube embeds data in JSON)
    let videoData: YouTubeScrapedVideoData[] = [];
    
    $('script').each((i, elem) => {
      const scriptContent = $(elem).html();
      if (scriptContent && scriptContent.includes('var ytInitialData')) {
        try {
          // Extract the JSON data from the script tag
          const match = scriptContent.match(/var ytInitialData = ({.*?});/);
          if (match) {
            const data = JSON.parse(match[1]);
            const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
            
            if (contents && contents[0]?.itemSectionRenderer?.contents) {
              videoData = contents[0].itemSectionRenderer.contents;
            }
          }
        } catch (parseError) {
          // Continue if we can't parse this script tag
        }
      }
    });
    
    Logger.debug(`🔍 Found ${videoData.length} potential video items`);
    
    // Extract video information
    for (const item of videoData) {
      if (item.videoRenderer && results.length < maxResults) {
        const video = item.videoRenderer;

        const videoId = video.videoId;
        const title = video.title?.runs?.[0]?.text || video.title?.simpleText || 'Unknown Title';
        const duration = video.lengthText?.simpleText || 'Unknown Duration';
        const views = video.viewCountText?.simpleText || 'Unknown Views';
        // Get channel name - try multiple sources to ensure we get the actual channel name
        let channel = 'Unknown Channel';
        if (video.longBylineText?.runs?.[0]?.text) {
          channel = video.longBylineText.runs[0].text;
        } else if (video.ownerText?.runs?.[0]?.text) {
          channel = video.ownerText.runs[0].text;
        }
        
        if (videoId) {
          results.push({
            videoId,
            title,
            duration,
            views,
            channel
          });
          
          Logger.debug(`✅ Found video: ${title} (${videoId}) by ${channel}`);
        }
      }
    }
    
    Logger.debug(`🕷️ Scraping completed in ${Date.now() - startTime}ms, found ${results.length} videos`);
    return results;
    
  } catch (error) {
    Logger.error('YouTube scraping failed', {}, error);
    throw new Error(`Failed to scrape YouTube search: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Search and score YouTube videos for a track
 * Uses the same calculateMatchScore function as the modal for consistent scoring
 * Returns all results with scores so both modal and sync can use it
 */
export async function searchAndScoreVideos(
  artist: string,
  songName: string,
  maxResults: number = 5
): Promise<Array<SearchResult>> {
  const queries = [
    `"${artist}" "${songName}" official music video`,
    `"${artist}" "${songName}" official video`,
    `"${artist}" "${songName}" music video`,
    `${artist} ${songName} official`,
    `${artist} ${songName}`
  ];

  const scoredResults: Array<SearchResult> = [];

  for (const query of queries) {
    try {
      Logger.debug(`🎵 Searching for music video: ${query}`);
      const results = await scrapeYouTubeSearch(query, maxResults);

      if (results.length > 0) {
        // Score all results using the same calculateMatchScore function as the modal
        for (const result of results) {
          const spotifyTrack = {
            id: '',
            name: songName,
            artist: artist
          };

          const youtubeVideo = {
            id: result.videoId,
            title: result.title,
            description: '',
            channelTitle: result.channel,
            viewCount: parseViewCount(result.views)
          };

          const { score, breakdown } = calculateMatchScore(spotifyTrack, youtubeVideo);

          Logger.debug(`📊 Video "${result.title}" by ${result.channel} scored ${(score * 100).toFixed(0)}%`);

          if (score >= 0.4) {
            scoredResults.push({
              ...result,
              matchScore: { score, breakdown }
            });
          }
        }

        // If we found good matches, return them (sorted by score)
        if (scoredResults.length > 0) {
          Logger.debug(`🎯 Found ${scoredResults.length} videos matching ${artist} - ${songName}`);
          return scoredResults;
        }
      }
    } catch (error) {
      Logger.warn('Search failed for query', { query }, error);
      continue;
    }

    // Add a small delay between searches to be respectful
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  Logger.debug(`❌ No suitable videos found for ${artist} - ${songName}`);
  return [];
}

/**
 * Search for a music video and return the best match
 * Uses searchAndScoreVideos internally for consistent scoring
 */
export async function searchMusicVideo(artist: string, songName: string): Promise<string | null> {
  const results = await searchAndScoreVideos(artist, songName, 5);

  if (results.length === 0) {
    return null;
  }

  // Find the best match (highest normalized score from the algorithm)
  let bestMatch = results[0];
  if (!bestMatch.matchScore) {
    return null;
  }

  for (const result of results) {
    if (!result.matchScore) continue;

    // Use the actual normalized score from calculateMatchScore, not a reconstruction
    if (result.matchScore.score > bestMatch.matchScore!.score) {
      bestMatch = result;
    }
  }

  Logger.debug(`🎯 Selected best match: "${bestMatch.title}" by ${bestMatch.channel} (${(bestMatch.matchScore!.score * 100).toFixed(0)}%)`);
  return bestMatch.videoId;
}
