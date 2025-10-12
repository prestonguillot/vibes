import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

interface SearchResult {
  videoId: string;
  title: string;
  duration: string;
  views: string;
  channel: string;
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
  console.log(`🕷️ Scraping YouTube search for: "${query}"`);
  
  try {
    // Construct YouTube search URL
    const searchQuery = encodeURIComponent(query);
    const url = `https://www.youtube.com/results?search_query=${searchQuery}`;
    
    console.log(`📡 Fetching: ${url}`);
    
    // Fetch the search results page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    console.log(`📄 Received HTML page (${html.length} chars)`);
    
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
    
    console.log(`🔍 Found ${videoData.length} potential video items`);
    
    // Extract video information
    for (const item of videoData) {
      if (item.videoRenderer && results.length < maxResults) {
        const video = item.videoRenderer;
        
        const videoId = video.videoId;
        const title = video.title?.runs?.[0]?.text || video.title?.simpleText || 'Unknown Title';
        const duration = video.lengthText?.simpleText || 'Unknown Duration';
        const views = video.viewCountText?.simpleText || 'Unknown Views';
        const channel = video.ownerText?.runs?.[0]?.text || video.longBylineText?.runs?.[0]?.text || 'Unknown Channel';
        
        if (videoId) {
          results.push({
            videoId,
            title,
            duration,
            views,
            channel
          });
          
          console.log(`✅ Found video: ${title} (${videoId}) by ${channel}`);
        }
      }
    }
    
    console.log(`🕷️ Scraping completed in ${Date.now() - startTime}ms, found ${results.length} videos`);
    return results;
    
  } catch (error) {
    console.error(`❌ YouTube scraping failed:`, error);
    throw new Error(`Failed to scrape YouTube search: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Search for a music video specifically 
 * Prioritizes official music videos and high-quality results
 */
// Simple fuzzy string matching function
function calculateStringSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

// Score a video result for how well it matches the requested song
function scoreVideoMatch(result: SearchResult, songName: string, artist: string): number {
  let score = 0;
  
  const normalizedSongName = songName.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const normalizedVideoTitle = result.title.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const normalizedArtist = artist.toLowerCase().replace(/[^\w\s]/g, '').trim();
  
  // 1. Official video bonus (highest priority)
  if (result.title.toLowerCase().includes('official') || 
      result.channel.toLowerCase().includes(normalizedArtist) ||
      result.channel.toLowerCase().includes('official')) {
    score += 0.4;
  }
  
  // 2. Title matching (fuzzy)
  const titleSimilarity = calculateStringSimilarity(normalizedSongName, normalizedVideoTitle);
  if (titleSimilarity > 0.6) {
    score += 0.3 * titleSimilarity;
  }
  
  // 3. Exact title substring match
  if (normalizedVideoTitle.includes(normalizedSongName) || 
      normalizedSongName.includes(normalizedVideoTitle)) {
    score += 0.2;
  }
  
  // 4. Artist name in title
  if (normalizedVideoTitle.includes(normalizedArtist)) {
    score += 0.1;
  }
  
  // 5. Word-by-word matching
  const songWords = normalizedSongName.split(' ').filter(w => w.length > 2);
  const titleWords = normalizedVideoTitle.split(' ').filter(w => w.length > 2);
  
  if (songWords.length > 0) {
    const wordMatches = songWords.filter(word => 
      titleWords.some(tw => 
        tw === word || tw.includes(word) || word.includes(tw) ||
        calculateStringSimilarity(word, tw) > 0.8
      )
    ).length;
    
    const wordMatchRatio = wordMatches / songWords.length;
    if (wordMatchRatio > 0.3) {
      score += 0.1 * wordMatchRatio;
    }
  }
  
  return Math.min(score, 1.0);
}

export async function searchMusicVideo(artist: string, songName: string): Promise<string | null> {
  // Try different search query variations to find the best match
  const queries = [
    `"${artist}" "${songName}" official music video`,
    `"${artist}" "${songName}" official video`,
    `"${artist}" "${songName}" music video`,
    `${artist} ${songName} official`,
    `${artist} ${songName}`
  ];
  
  let bestMatch: { result: SearchResult; score: number } | null = null;
  const minScore = 0.3; // Minimum score threshold
  
  for (const query of queries) {
    try {
      console.log(`🎵 Searching for music video: ${query}`);
      const results = await scrapeYouTubeSearch(query, 5); // Get more results for better selection
      
      if (results.length > 0) {
        // Score all results and find the best match
        for (const result of results) {
          const score = scoreVideoMatch(result, songName, artist);
          
          console.log(`📊 Video "${result.title}" by ${result.channel} scored ${score.toFixed(3)}`);
          
          if (score >= minScore && (!bestMatch || score > bestMatch.score)) {
            bestMatch = { result, score };
          }
        }
        
        // If we found a good match, return it
        if (bestMatch && bestMatch.score > 0.6) {
          console.log(`🎯 Found high-quality match: "${bestMatch.result.title}" by ${bestMatch.result.channel} (score: ${bestMatch.score.toFixed(3)})`);
          return bestMatch.result.videoId;
        }
      }
    } catch (error) {
      console.warn(`⚠️ Search failed for query "${query}":`, error);
      continue;
    }
    
    // Add a small delay between searches to be respectful
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Return best match if we found one above minimum threshold
  if (bestMatch) {
    console.log(`🎯 Found acceptable match: "${bestMatch.result.title}" by ${bestMatch.result.channel} (score: ${bestMatch.score.toFixed(3)})`);
    return bestMatch.result.videoId;
  }
  
  console.log(`❌ No suitable video found for ${artist} - ${songName}`);
  return null;
}
