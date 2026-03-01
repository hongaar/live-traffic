#!/usr/bin/env node
// Production startup script - runs all services

const { spawn } = require('child_process');
const path = require('path');

// Set production environment variables
process.env.NODE_ENV = 'production';
process.env.DB_KIND = process.env.DB_KIND || 'postgres';

// In production, use Railway's DATABASE_URL for PostgreSQL
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable not set');
  process.exit(1);
}

// Start both services
const apiProcess = spawn('bun', ['apps/api/dist/index.js'], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
});

const collectorProcess = spawn('bun', ['apps/collector/dist/index.js'], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
});

// Handle graceful shutdown
const shutdown = () => {
  console.log('\n📴 Shutting down services...');
  apiProcess.kill('SIGTERM');
  collectorProcess.kill('SIGTERM');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
