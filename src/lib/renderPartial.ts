import ejs from 'ejs';
import path from 'path';

// Resolved from the compiled location (dist/lib), which is the same depth below the root as this
// file is below src - so the path holds for both.
const viewsPath = path.join(__dirname, '../../views');

/**
 * Render a partial from views/partials.
 *
 * Shared so that the sync engine and the route that streams it name partials the same way.
 * routes/playlistDetails.ts and routes/spotify.ts still build these paths by hand at 21 call sites
 * between them; they should move onto this too.
 */
export function renderPartial(partial: string, data: Record<string, unknown>): Promise<string> {
  return ejs.renderFile(path.join(viewsPath, 'partials', partial), data);
}
