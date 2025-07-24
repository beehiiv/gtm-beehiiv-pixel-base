# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the beehiiv Pixel V2 for Google Tag Manager - a JavaScript tracking pixel library and GTM template that enables advertisers to track conversion events and integrate with beehiiv's Ad Network.

## Commands

### Development
- `npm run build` - Build the pixel library using Vite (runs `./scripts/build_pixeljs`)
- `npm run test` - Run tests (runs `./scripts/run_tests`)
- `npm run format` - Format code with Prettier
- `npm run run-advertiser` - Start local dev servers for testing (serves test pages on port 9999)

### Deployment
- `npm run upload` - Upload built files to S3 (runs `./scripts/upload_to_s3`)

### Testing a Single Feature
To test pixel functionality locally:
1. Run `npm run build` to build the latest version
2. Run `npm run run-advertiser` to start local servers
3. Open `http://localhost:9999/` to access test pages
4. Use GTM preview mode with the test container to verify events

## Architecture

### Core Components
1. **src/pixel-v2.js** - Main pixel tracking library that handles:
   - Event tracking (pageview, conversion, lead, purchase, etc.)
   - Cookie management (_bhp profile cookie, _bhc click cookie)
   - Email hashing (SHA-256, SHA-1, MD5)
   - Rate limiting and retry logic
   - SPA support with URL change detection

2. **src/pixel-support.js** - GTM integration helpers:
   - Provides utility functions for the GTM template
   - Handles parameter extraction and validation

3. **template.tpl** - GTM template file:
   - Defines the GTM tag interface
   - Manages permissions and sandboxed code execution
   - Integrates with pixel-v2.js

### Event Flow
1. GTM tag fires based on configured triggers
2. Template code validates parameters and calls pixel library
3. Pixel library processes event data, manages cookies, and sends to backend
4. Events are batched and sent to the ingestion endpoint (configured via VITE_PIXEL_V2_APIARY_ENDPOINT)

### Key Design Patterns
- **Singleton Pattern**: One BeehiivPixel instance per page
- **Event Batching**: Groups multiple events for efficiency
- **Retry Logic**: Handles failed requests with exponential backoff
- **Cookie Persistence**: Maintains user identity across sessions
- **Debug Mode**: Visual overlay for development/troubleshooting

## Environment Configuration
Uses Doppler for environment management. Key variable:
- `VITE_PIXEL_V2_APIARY_ENDPOINT` - Backend ingestion endpoint URL

## Important Considerations
- Always use lowercase "beehiiv" per naming conventions
- Follow conventional commits format for git messages
- The pixel excludes beehiiv domains from tracking
- Email values are automatically hashed before transmission
- Test thoroughly with GTM preview mode before deploying changes