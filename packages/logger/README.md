# Logging System

The `@live-traffic/logger` package provides a structured logging utility for the collector and adapters with configurable log levels.

## Features

- **Five Log Levels**: error, warn, info, debug, verbose
- **Environment-Based Configuration**: Set `LOG_LEVEL` env var
- **Adapter-Specific Loggers**: Each adapter gets its own logger with a prefix
- **Request/Response Helpers**: Convenient methods for logging HTTP interactions
- **Timestamp & Level Formatting**: Clean, structured output

## Usage

### Collector Setup

The collector automatically initializes logging from the `LOG_LEVEL` environment variable:

```bash
# Default is 'info'
LOG_LEVEL=verbose bun src/index.ts
LOG_LEVEL=debug bun src/index.ts
LOG_LEVEL=info bun src/index.ts
```

### In Adapter Code

```typescript
import { getLogger } from '@live-traffic/logger';

const logger = getLogger('NDW');

// Log at different levels
logger.error('Something failed', error);
logger.warn('This might be a problem');
logger.info('Operation completed');
logger.debug('Detailed diagnostic info');
logger.verbose('Full request body', requestData);

// Helper methods for HTTP logging
logger.logRequest('GET', 'https://api.example.com/data');
logger.logResponse('GET', 'https://api.example.com/data', 200, 1250, { size: 50000 });
logger.logError('Failed to fetch', error, { url: '...' });
```

### Log Levels Explained

| Level | When to Use | Info Included |
|-------|------------|---------------|
| **error** | Fatal issues only | Error message, context |
| **warn** | Recoverable problems | Warning message, basic context |
| **info** | Important events | Summary of operations (event counts, timing) |
| **debug** | Troubleshooting | Request/response metadata, stack traces |
| **verbose** | Deep debugging | Full payloads, decompressed sizes, timing details |

### Example Output

With `LOG_LEVEL=verbose`:

```
2026-02-27T10:15:24.001Z ERROR   [NDW] Failed to fetch incidents: Connection timeout
2026-02-27T10:15:24.050Z WARN    [Runner] Adapter took longer than expected
2026-02-27T10:15:24.150Z INFO    [NDW] Inserted/updated 42 incidents
2026-02-27T10:15:24.200Z DEBUG   [NDW] GET https://opendata.ndw.nu/incidents 200 (300ms)
2026-02-27T10:15:24.250Z VERBOSE [NDW] GET https://opendata.ndw.nu/incidents
  {
    "decompressedSize": 512000,
    "xmlSize": 525000
  }
```

## Integration with Adapters

All adapters have been updated to use the logger:

- **adapter-ndw**: Logs each feed fetch, response timing, event counts, and errors
- **Runner**: Logs adapter lifecycle events and retention job execution
- **Collector**: Logs startup, shutdown, and operational status

The logging package is minimal (no external dependencies) and performance-friendly for production use.
