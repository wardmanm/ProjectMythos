// Where content lives (04-content-schemas §2). The repository's folders are found from this
// file's own location, never the working directory, so the server can start from anywhere.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentSources } from './types';

/** The repository root: this file is `apps/server/src/modules/content/sources.ts`. */
const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

/**
 * The default content folders for a data directory: the repository's packs, then the data
 * directory's, which win a clash (owner decision); the user library; the built-in library;
 * and the engine's templates.
 */
export function defaultSources(dataDir: string): ContentSources {
  const builtInLibrary = path.join(repositoryRoot, 'content-library');
  return {
    packFolders: [path.join(repositoryRoot, 'content-packs'), path.join(dataDir, 'content-packs')],
    userLibrary: path.join(dataDir, 'library'),
    builtInLibrary,
    engineTemplates: path.join(builtInLibrary, 'templates'),
  };
}
