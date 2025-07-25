import { Router } from 'express';
import SpotifyWebApi from 'spotify-web-api-node';
import { google } from 'googleapis';

const router = Router();

// Create Spotify API instance with current env vars
const getSpotifyApi = () => new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI
});

router.post('/playlist/:playlistId', async (req, res) => {
  const startTime = Date.now();
  const playlistId = req.params.playlistId;
  
  console.log(`\n🚀 === SYNC REQUEST STARTED ===`);
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
  console.log(`🎵 Playlist ID: ${playlistId}`);
  console.log(`👤 Session ID: ${req.sessionID}`);
  console.log(`🔗 Request URL: ${req.originalUrl}`);
  console.log(`📊 Request method: ${req.method}`);

  try {
    // Check authentication
    if (!req.session.spotifyTokens) {
      console.log('❌ No Spotify tokens in session');
      return res.status(401).send('<div class="alert alert-danger">Please connect to Spotify first</div>');
    }
    
    if (!req.session.youtubeTokens) {
      console.log('❌ No YouTube tokens in session');
      return res.status(401).send('<div class="alert alert-danger">Please connect to YouTube first</div>');
    }

    console.log('✅ Authentication check passed');

    // Initialize APIs
    console.log('🔧 Initializing API clients...');
    const spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI
    });
    spotifyApi.setAccessToken(req.session.spotifyTokens.accessToken);

    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      process.env.YOUTUBE_REDIRECT_URI
    );
    oauth2Client.setCredentials(req.session.youtubeTokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    console.log('✅ API clients initialized');

    // Get playlist details
    console.log('📋 Fetching Spotify playlist details...');
    const playlistResponse = await spotifyApi.getPlaylist(playlistId);
    const playlist = playlistResponse.body;
    console.log(`📋 Playlist: "${playlist.name}" (${playlist.tracks.total} tracks)`);

    // Get tracks with limit
    const trackLimit = 1; // Conservative limit for testing
    console.log(`🎵 Fetching tracks (limit: ${trackLimit})...`);
    const tracksResponse = await spotifyApi.getPlaylistTracks(playlistId, { limit: trackLimit });
    const tracks = tracksResponse.body.items.filter(item => item.track && item.track.type === 'track');
    console.log(`🎵 Found ${tracks.length} valid tracks to sync`);

    if (tracks.length === 0) {
      console.log('⚠️ No tracks to sync');
      return res.send('<div class="alert alert-warning">No tracks found to sync</div>');
    }

    // Search for YouTube videos for each track
    const videoIds: string[] = [];
    const searchResults: Array<{track: string, artist: string, found: boolean, videoId?: string}> = [];
    let apiCallCount = 0;
    
    for (const item of tracks) {
      if (item.track && item.track.type === 'track') {
        const track = item.track;
        const artist = track.artists[0]?.name || 'Unknown Artist';
        const songName = track.name;
        
        try {
          // OPTIMIZATION: More targeted search query
          const searchQuery = `"${artist}" "${songName}"`;
          console.log(`🔍 Searching for: ${searchQuery}`);
          
          const searchResponse = await youtube.search.list({
            part: ['id', 'snippet'],
            q: searchQuery,
            type: ['video'],
            maxResults: 1, // Reduced from 3 to 1
            videoCategoryId: '10', // Music category
            order: 'relevance'
          });
          
          apiCallCount++;
          console.log(`API call #${apiCallCount} - Quota used: ${apiCallCount * 100} units`);
          
          if (searchResponse.data.items && searchResponse.data.items.length > 0) {
            const videoId = searchResponse.data.items[0].id?.videoId;
            if (videoId) {
              videoIds.push(videoId);
              searchResults.push({
                track: songName,
                artist: artist,
                found: true,
                videoId: videoId
              });
            }
          } else {
            searchResults.push({
              track: songName,
              artist: artist,
              found: false
            });
          }
          
          // OPTIMIZATION: Add delay between requests to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          console.error(`Error searching for ${artist} - ${songName}:`, error);
          searchResults.push({
            track: songName,
            artist: artist,
            found: false
          });
        }
      }
    }
    
    console.log(`Total API calls made: ${apiCallCount}, Total quota used: ${apiCallCount * 100} units`);
    
    // Check if a YouTube playlist already exists for this Spotify playlist
    const playlistTitle = `${playlist.name} (from Spotify)`;
    let youtubePlaylistId: string | null = null;
    let existingPlaylist = false;
    
    try {
      // Search for existing playlists with the same title
      const existingPlaylists = await youtube.playlists.list({
        part: ['snippet'],
        mine: true,
        maxResults: 50
      });
      
      apiCallCount++;
      console.log(`API call #${apiCallCount} (playlist search) - Quota used: ${apiCallCount * 100} units`);
      
      if (existingPlaylists.data.items) {
        const matchingPlaylist = existingPlaylists.data.items.find(
          pl => pl.snippet?.title === playlistTitle
        );
        
        if (matchingPlaylist && matchingPlaylist.id) {
          youtubePlaylistId = matchingPlaylist.id;
          existingPlaylist = true;
          console.log(`Found existing playlist: ${youtubePlaylistId}`);
        }
      }
    } catch (error) {
      console.error('Error searching for existing playlists:', error);
      // Continue with creating new playlist if search fails
    }
    
    // Only create playlist if we found some videos
    if (videoIds.length === 0) {
      console.log('⚠️ No videos found');
      return res.send(`
        <div class="alert alert-warning">
          <h5>No videos found</h5>
          <p>Could not find any YouTube videos for the tracks in this playlist.</p>
          <p>API calls made: ${apiCallCount} (${apiCallCount * 100} quota units)</p>
        </div>
      `);
    }

    // Create YouTube playlist if one doesn't exist, otherwise do smart sync
    if (!youtubePlaylistId) {
      const playlistResponse = await youtube.playlists.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: playlistTitle,
            description: `Synced from Spotify playlist: ${playlist.name}\nOriginal playlist by: ${playlist.owner.display_name}\nSpotify ID: ${playlistId}`
          },
          status: {
            privacyStatus: 'private'
          }
        }
      });
      
      apiCallCount++;
      console.log(`API call #${apiCallCount} (playlist creation) - Quota used: ${apiCallCount * 100} units`);
      
      youtubePlaylistId = playlistResponse.data.id!;
      console.log(`Created new playlist: ${youtubePlaylistId}`);
      
      // Add all found videos to new playlist
      for (const videoId of videoIds) {
        try {
          await youtube.playlistItems.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                playlistId: youtubePlaylistId,
                resourceId: {
                  kind: 'youtube#video',
                  videoId: videoId
                }
              }
            }
          });
          apiCallCount++;
          console.log(`Added video to new playlist: ${videoId}`);
        } catch (error) {
          console.error(`Error adding video ${videoId} to playlist:`, error);
        }
      }
    } else {
      // Smart sync: compare existing playlist with current Spotify tracks
      console.log(`Updating existing playlist: ${youtubePlaylistId}`);
      
      // Get existing playlist items with video details
      const existingItems = await youtube.playlistItems.list({
        part: ['id', 'snippet'],
        playlistId: youtubePlaylistId,
        maxResults: 50
      });
      
      apiCallCount++;
      console.log(`API call #${apiCallCount} (get existing items) - Quota used: ${apiCallCount * 100} units`);
      
      const existingVideos = existingItems.data.items || [];
      console.log(`Found ${existingVideos.length} existing videos in playlist`);
      
      // Check accessibility of existing videos
      const videoIds = existingVideos.map(item => item.snippet?.resourceId?.videoId).filter(Boolean) as string[];
      let inaccessibleVideos: string[] = [];
      
      if (videoIds.length > 0) {
        try {
          const videoDetails = await youtube.videos.list({
            part: ['id', 'status'],
            id: videoIds
          });
          
          apiCallCount++;
          console.log(`API call #${apiCallCount} (check video accessibility) - Quota used: ${apiCallCount * 100} units`);
          
          const accessibleVideoIds = new Set(videoDetails.data.items?.map(v => v.id) || []);
          inaccessibleVideos = videoIds.filter(id => !accessibleVideoIds.has(id));
          
          if (inaccessibleVideos.length > 0) {
            console.log(`Found ${inaccessibleVideos.length} inaccessible videos:`, inaccessibleVideos);
          }
        } catch (error) {
          console.error('Error checking video accessibility:', error);
        }
      }
      
      // Create a map of existing videos by video ID for exact matching
      const existingVideoMap = new Map<string, any>();
      const existingVideosByTitle = new Map<string, any>();
      
      for (const item of existingVideos) {
        if (item.snippet?.resourceId?.videoId) {
          const videoId = item.snippet.resourceId.videoId;
          const title = item.snippet.title || '';
          
          // Map by video ID for exact matching
          existingVideoMap.set(videoId, {
            playlistItemId: item.id,
            videoId: videoId,
            title: title,
            isInaccessible: inaccessibleVideos.includes(videoId)
          });
          
          // Also map by title for fuzzy matching (as fallback)
          existingVideosByTitle.set(title.toLowerCase(), {
            playlistItemId: item.id,
            videoId: videoId,
            title: title,
            isInaccessible: inaccessibleVideos.includes(videoId)
          });
        }
      }
      
      // Determine what needs to be added/removed/replaced
      const toAdd: string[] = [];
      const toRemove: string[] = [];
      const toReplace: Array<{playlistItemId: string, newVideoId: string, reason: string}> = [];
      
      // Check each current Spotify track
      for (const result of searchResults) {
        if (result.found && result.videoId) {
          // First check: Does this exact video ID already exist in the playlist?
          const existingVideo = existingVideoMap.get(result.videoId);
          
          if (existingVideo) {
            // Video already exists
            if (existingVideo.isInaccessible) {
              // This shouldn't happen since we're checking the same video, but handle it
              console.log(`Warning: Found same video ID but marked as inaccessible: ${result.videoId}`);
            } else {
              // Video exists and is accessible - do nothing
              console.log(`Video already exists and is accessible: ${result.artist} - ${result.track}`);
            }
          } else {
            // Video doesn't exist, check if there's a different video for the same track
            let foundSimilarTrack = false;
            
            for (const [existingTitle, existingVideoData] of existingVideosByTitle.entries()) {
              // Fuzzy matching: check if existing video title contains both artist and track name
              const artistLower = result.artist.toLowerCase();
              const trackLower = result.track.toLowerCase();
              
              if (existingTitle.includes(artistLower) && existingTitle.includes(trackLower)) {
                foundSimilarTrack = true;
                
                if (existingVideoData.isInaccessible) {
                  // Replace inaccessible video with new one
                  toReplace.push({
                    playlistItemId: existingVideoData.playlistItemId,
                    newVideoId: result.videoId,
                    reason: 'inaccessible'
                  });
                  console.log(`Will replace inaccessible video for: ${result.artist} - ${result.track}`);
                } else {
                  // Replace with potentially better video
                  toReplace.push({
                    playlistItemId: existingVideoData.playlistItemId,
                    newVideoId: result.videoId,
                    reason: 'better_match'
                  });
                  console.log(`Will replace with better match for: ${result.artist} - ${result.track}`);
                }
                break;
              }
            }
            
            if (!foundSimilarTrack) {
              // Completely new track, add it
              toAdd.push(result.videoId);
              console.log(`Will add new video for: ${result.artist} - ${result.track}`);
            }
          }
        }
      }
      
      // Remove videos for tracks no longer in Spotify (simplified approach)
      // This is tricky without storing metadata, so for now we'll be conservative
      // and only remove videos we're sure are inaccessible
      for (const [videoId, video] of existingVideoMap.entries()) {
        if (video.isInaccessible && !toReplace.some(r => r.playlistItemId === video.playlistItemId)) {
          toRemove.push(video.playlistItemId);
          console.log(`Will remove inaccessible video: ${video.title}`);
        }
      }
      
      console.log(`Smart sync plan: Add ${toAdd.length}, Remove ${toRemove.length}, Replace ${toReplace.length}`);
      
      // Execute the sync plan
      let changesCount = 0;
      
      // Remove videos
      for (const playlistItemId of toRemove) {
        try {
          await youtube.playlistItems.delete({
            id: playlistItemId
          });
          apiCallCount++;
          changesCount++;
          console.log(`Removed inaccessible video: ${playlistItemId}`);
        } catch (error) {
          console.error(`Error removing video ${playlistItemId}:`, error);
        }
      }
      
      // Replace videos
      for (const replacement of toReplace) {
        try {
          // Remove old video
          await youtube.playlistItems.delete({
            id: replacement.playlistItemId
          });
          apiCallCount++;
          
          // Add new video
          await youtube.playlistItems.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                playlistId: youtubePlaylistId,
                resourceId: {
                  kind: 'youtube#video',
                  videoId: replacement.newVideoId
                }
              }
            }
          });
          apiCallCount++;
          changesCount++;
          console.log(`Replaced video (${replacement.reason}): ${replacement.playlistItemId} -> ${replacement.newVideoId}`);
        } catch (error) {
          console.error(`Error replacing video ${replacement.playlistItemId}:`, error);
        }
      }
      
      // Add new videos
      for (const videoId of toAdd) {
        try {
          await youtube.playlistItems.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                playlistId: youtubePlaylistId,
                resourceId: {
                  kind: 'youtube#video',
                  videoId: videoId
                }
              }
            }
          });
          apiCallCount++;
          changesCount++;
          console.log(`Added new video: ${videoId}`);
        } catch (error) {
          console.error(`Error adding video ${videoId}:`, error);
        }
      }
      
      console.log(`Smart sync completed: ${changesCount} changes made`);
      
      // Generate success response with details
      const foundCount = searchResults.filter(r => r.found).length;
      const totalCount = searchResults.length;
      
      const resultHtml = `
        <div class="alert alert-success">
          <h5>✅ Playlist ${existingPlaylist ? 'updated' : 'created'} successfully!</h5>
          <p>Found ${foundCount} out of ${totalCount} tracks (limited from ${tracks.length} total tracks)</p>
          <p><strong>YouTube Playlist:</strong> ${playlist.name} (from Spotify) ${existingPlaylist ? '(updated existing)' : '(newly created)'}</p>
          <p><strong>API Usage:</strong> ${apiCallCount} calls (${apiCallCount * 100} quota units)</p>
        </div>
        <div class="sync-details mt-3">
          <h6>Sync Results:</h6>
          <div class="track-results">
            ${searchResults.map(result => `
              <div class="track-result ${result.found ? 'found' : 'not-found'}">
                <span class="track-info">${result.artist} - ${result.track}</span>
                <span class="result-status">
                  ${result.found ? '✅ Found' : '❌ Not found'}
                </span>
              </div>
            `).join('')}
            ${tracks.length > trackLimit ? `
              <div class="alert alert-info mt-2">
                <small>Note: Only processed first ${trackLimit} tracks to conserve YouTube API quota. 
                ${tracks.length - trackLimit} tracks were skipped.</small>
              </div>
            ` : ''}
          </div>
        </div>
      `;
      
      console.log(`🕒 Request processing time: ${Date.now() - startTime}ms`);
      res.send(resultHtml);
      
    }
  } catch (error) {
    console.error('Error syncing playlist:', error);
    console.log(`🕒 Request processing time: ${Date.now() - startTime}ms`);
    res.status(500).send(`
      <div class="alert alert-danger">
        <h5>❌ Error syncing playlist</h5>
        <p>${error instanceof Error ? error.message : 'Unknown error occurred'}</p>
      </div>
    `);
  }
});

export { router as syncRouter };
