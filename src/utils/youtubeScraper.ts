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
 * Scrape YouTube search results for a given query
 * This avoids the expensive YouTube API search which costs 100 quota units per search
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
    let videoData: any[] = [];
    
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
export async function searchMusicVideo(artist: string, songName: string): Promise<string | null> {
  // Try different search query variations to find the best match
  const queries = [
    `"${artist}" "${songName}" official music video`,
    `"${artist}" "${songName}" official video`,
    `"${artist}" "${songName}" music video`,
    `${artist} ${songName} official`,
    `${artist} ${songName}`
  ];
  
  for (const query of queries) {
    try {
      console.log(`🎵 Searching for music video: ${query}`);
      const results = await scrapeYouTubeSearch(query, 1);
      
      if (results.length > 0) {
        const result = results[0];
        console.log(`🎯 Found match: "${result.title}" by ${result.channel}`);
        return result.videoId;
      }
    } catch (error) {
      console.warn(`⚠️ Search failed for query "${query}":`, error);
      continue;
    }
    
    // Add a small delay between searches to be respectful
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`❌ No video found for ${artist} - ${songName}`);
  return null;
}
