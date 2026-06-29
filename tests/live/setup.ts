/**
 * Setup for the live Spotify harness: load real credentials from .env (the normal
 * runtime env file), NOT .env.test. Does not set NODE_ENV=test and does not mock
 * anything - these tests talk to the real API.
 */
import dotenv from 'dotenv';

dotenv.config();
