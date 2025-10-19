import dotenv from 'dotenv';

// Load environment-specific .env file based on NODE_ENV
// NODE_ENV should be set by the npm script or deployment environment
const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

// Validate environment variables before starting server
import { validateEnvironment } from './utils/envValidation';
validateEnvironment();

import { createApp } from './app';
import { Logger } from './utils/logger';

const app = createApp();
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  Logger.info('Server started', { port: PORT, url: `http://localhost:${PORT}`, env: process.env.NODE_ENV || 'development' });
});
