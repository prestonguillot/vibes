import 'express-session';
import { Credentials } from 'google-auth-library';

declare module 'express-session' {
  interface SessionData {
    spotifyTokens?: {
      accessToken: string;
      refreshToken: string;
    };
    youtubeTokens?: Credentials;
  }
}
