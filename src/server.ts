// IMPORTANT: Load dotenv FIRST before any other imports
// This ensures environment variables are available when modules are evaluated
import dotenv from 'dotenv';
import path from 'path';

const env = process.env.NODE_ENV || 'development';
const envPath = path.join(process.cwd(), `.env.${env}`);

// Load environment-specific .env file (with override to take precedence)
dotenv.config({ path: envPath, override: true });

// Also load .env as fallback for any missing variables
dotenv.config({ path: path.join(process.cwd(), '.env'), override: false });

// NOW import everything else after dotenv is loaded
import { validateEnvironment } from './utils/envValidation';
validateEnvironment();

import { createApp } from './app';
import { Logger } from './utils/logger';

const app = createApp();
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  Logger.info('Server started', {
    port: PORT,
    url: `http://localhost:${PORT}`,
    env: process.env.NODE_ENV || 'development',
  });
});
