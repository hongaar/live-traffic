import { XMLParser } from 'fast-xml-parser';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  type TrafficIncident,
  type SpeedMeasurement,
  type TravelTime,
  type RoadWork,
  type MessageSign,
} from '@live-traffic/types';
import { upsertEvents, upsertSource, getSource } from '@live-traffic/db';
import { getLogger } from '@live-traffic/logger';
import type { Adapter } from '@live-traffic/types';

const logger = getLogger('NDW');

const NDW_BASE_URL = 'https://opendata.ndw.nu';

const FEEDS = {
  incidents: `${NDW_BASE_URL}/incidents.xml.gz`,
  trafficspeed: `${NDW_BASE_URL}/trafficspeed.xml.gz`,
  traveltime: `${NDW_BASE_URL}/traveltime.xml.gz`,
  roadwork: `${NDW_BASE_URL}/wegwerkzaamheden.xml.gz`,
  drips: `${NDW_BASE_URL}/DRIPS.xml.gz`,
};

const CACHE_DIR = process.env.NDW_CACHE_DIR || './.ndw-cache';
const USE_CACHE = process.env.NDW_USE_CACHE !== 'false';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCacheFilePath(feedName: string): string {
  return join(CACHE_DIR, `${feedName}.xml`);
}

function readFromCache(feedName: string): string | null {
  if (!USE_CACHE) return null;
  
  const cachePath = getCacheFilePath(feedName);
  if (existsSync(cachePath)) {
    logger.debug(`Loading ${feedName} from cache`);
    return readFileSync(cachePath, 'utf-8');
  }
  return null;
}

function writeToCache(feedName: string, xmlStr: string): void {
  if (!USE_CACHE) return;
  
  ensureCacheDir();
  const cachePath = getCacheFilePath(feedName);
  writeFileSync(cachePath, xmlStr, 'utf-8');
  logger.debug(`Cached ${feedName} to ${cachePath}`);
}

export class NDWAdapter implements Adapter {
  id = 'ndw';
  private running = false;
  private timers: NodeJS.Timeout[] = [];

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    logger.info('Starting adapter');

    // Fetch all feeds immediately, then schedule recurring fetches
    await this.fetchAllFeeds();

    // Schedule periodic fetches (every 10 minutes)
    const interval = setInterval(() => {
      this.fetchAllFeeds().catch((err) => {
        logger.error('Error in scheduled fetch', err);
      });
    }, 10 * 60 * 1000);

    this.timers.push(interval);
    logger.info('Adapter started, polls scheduled every 10 minutes');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    logger.info('Adapter stopped');
  }

  private async fetchAllFeeds(): Promise<void> {
    logger.debug('Fetching all feeds...');

    const startTime = Date.now();
    const promises = [
      this.fetchIncidents(),
      this.fetchTrafficSpeed(),
      this.fetchTravelTime(),
      this.fetchRoadWork(),
      this.fetchDRIPS(),
    ];

    const results = await Promise.allSettled(promises);

    let successCount = 0;
    let failureCount = 0;

    results.forEach((result, idx) => {
      const feedName = Object.keys(FEEDS)[idx];
      if (result.status === 'rejected') {
        logger.error(`Error fetching ${feedName}`, result.reason);
        failureCount++;
      } else {
        successCount++;
      }
    });

    const duration = Date.now() - startTime;
    logger.info(
      `Fetched ${successCount}/${results.length} feeds (${duration}ms)${failureCount > 0 ? ` [${failureCount} failures]` : ''}`
    );
  }

  private async fetchIncidents(): Promise<void> {
    const feedName = 'incidents';
    const url = FEEDS.incidents;
    const source = await getSource(`${this.id}:${feedName}`);

    try {
      let xmlStr: string | null = readFromCache(feedName);

      if (!xmlStr) {
        const startTime = Date.now();
        logger.logRequest('GET', url);

        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const decompressed = await this.gunzip(buffer);
        xmlStr = new TextDecoder().decode(decompressed);

        const duration = Date.now() - startTime;
        logger.logResponse('GET', url, response.status, duration, {
          decompressedSize: decompressed.byteLength,
          xmlSize: xmlStr.length,
        });

        writeToCache(feedName, xmlStr);
      }

      const parsed = xmlParser.parse(xmlStr);
      logger.verbose('Parsed incidents XML structure', {
        keys: Object.keys(parsed).slice(0, 5),
        hasD2LogicalModel: !!parsed.d2LogicalModel,
      });

      const events = this.parseIncidents(parsed);

      if (events.length > 0) {
        await upsertEvents(events);
        logger.info(`Inserted/updated ${events.length} incidents`);
      } else {
        logger.info(`No incidents parsed from data (xmlSize: ${xmlStr.length})`);
      }

      await upsertSource({
        adapterId: `${this.id}:${feedName}`,
        lastFetchAt: Date.now(),
        lastSuccessAt: Date.now(),
        errorMessage: null,
        cursor: null,
      });
    } catch (err) {
      logger.logError(`Failed to fetch ${feedName}`, err, { url });
      await upsertSource({
        adapterId: `${this.id}:${feedName}`,
        lastFetchAt: Date.now(),
        errorMessage: String(err),
        lastSuccessAt: source?.lastSuccessAt || null,
        cursor: source?.cursor || null,
      });
    }
  }

  private async fetchTrafficSpeed(): Promise<void> {
    const url = FEEDS.trafficspeed;

    try {
      const startTime = Date.now();
      logger.logRequest('GET', url);

      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const decompressed = await this.gunzip(buffer);
      const xmlStr = new TextDecoder().decode(decompressed);

      const duration = Date.now() - startTime;
      logger.logResponse('GET', url, response.status, duration, {
        decompressedSize: decompressed.byteLength,
        xmlSize: xmlStr.length,
      });

      const parsed = xmlParser.parse(xmlStr);
      const events = this.parseTrafficSpeed(parsed);

      if (events.length > 0) {
        await upsertEvents(events);
        logger.info(`Inserted/updated ${events.length} speed measurements`);
      } else {
        logger.debug('No speed measurements found in fetch');
      }

      await upsertSource({
        adapterId: `${this.id}:trafficspeed`,
        lastFetchAt: Date.now(),
        lastSuccessAt: Date.now(),
        errorMessage: null,
        cursor: null,
      });
    } catch (err) {
      logger.logError('Failed to fetch traffic speed', err, { url });
      const source = await getSource(`${this.id}:trafficspeed`);
      await upsertSource({
        adapterId: `${this.id}:trafficspeed`,
        lastFetchAt: Date.now(),
        errorMessage: String(err),
        lastSuccessAt: source?.lastSuccessAt || null,
        cursor: source?.cursor || null,
      });
    }
  }

  private async fetchTravelTime(): Promise<void> {
    const url = FEEDS.traveltime;

    try {
      const startTime = Date.now();
      logger.logRequest('GET', url);

      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const decompressed = await this.gunzip(buffer);
      const xmlStr = new TextDecoder().decode(decompressed);

      const duration = Date.now() - startTime;
      logger.logResponse('GET', url, response.status, duration, {
        decompressedSize: decompressed.byteLength,
        xmlSize: xmlStr.length,
      });

      const parsed = xmlParser.parse(xmlStr);
      const events = this.parseTravelTime(parsed);

      if (events.length > 0) {
        await upsertEvents(events);
        logger.info(`Inserted/updated ${events.length} travel times`);
      } else {
        logger.debug('No travel times found in fetch');
      }

      await upsertSource({
        adapterId: `${this.id}:traveltime`,
        lastFetchAt: Date.now(),
        lastSuccessAt: Date.now(),
        errorMessage: null,
        cursor: null,
      });
    } catch (err) {
      logger.logError('Failed to fetch travel time', err, { url });
      const source = await getSource(`${this.id}:traveltime`);
      await upsertSource({
        adapterId: `${this.id}:traveltime`,
        lastFetchAt: Date.now(),
        errorMessage: String(err),
        lastSuccessAt: source?.lastSuccessAt || null,
        cursor: source?.cursor || null,
      });
    }
  }

  private async fetchRoadWork(): Promise<void> {
    const url = FEEDS.roadwork;

    try {
      const startTime = Date.now();
      logger.logRequest('GET', url);

      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const decompressed = await this.gunzip(buffer);
      const xmlStr = new TextDecoder().decode(decompressed);

      const duration = Date.now() - startTime;
      logger.logResponse('GET', url, response.status, duration, {
        decompressedSize: decompressed.byteLength,
        xmlSize: xmlStr.length,
      });

      const parsed = xmlParser.parse(xmlStr);
      const events = this.parseRoadWork(parsed);

      if (events.length > 0) {
        await upsertEvents(events);
        logger.info(`Inserted/updated ${events.length} road works`);
      } else {
        logger.debug('No road works found in fetch');
      }

      await upsertSource({
        adapterId: `${this.id}:roadwork`,
        lastFetchAt: Date.now(),
        lastSuccessAt: Date.now(),
        errorMessage: null,
        cursor: null,
      });
    } catch (err) {
      logger.logError('Failed to fetch road work', err, { url });
      const source = await getSource(`${this.id}:roadwork`);
      await upsertSource({
        adapterId: `${this.id}:roadwork`,
        lastFetchAt: Date.now(),
        errorMessage: String(err),
        lastSuccessAt: source?.lastSuccessAt || null,
        cursor: source?.cursor || null,
      });
    }
  }

  private async fetchDRIPS(): Promise<void> {
    const url = FEEDS.drips;

    try {
      const startTime = Date.now();
      logger.logRequest('GET', url);

      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const decompressed = await this.gunzip(buffer);
      const xmlStr = new TextDecoder().decode(decompressed);

      const duration = Date.now() - startTime;
      logger.logResponse('GET', url, response.status, duration, {
        decompressedSize: decompressed.byteLength,
        xmlSize: xmlStr.length,
      });

      const parsed = xmlParser.parse(xmlStr);
      const events = this.parseDRIPS(parsed);

      if (events.length > 0) {
        await upsertEvents(events);
        logger.info(`Inserted/updated ${events.length} messages/signs`);
      } else {
        logger.debug('No messages/signs found in fetch');
      }

      await upsertSource({
        adapterId: `${this.id}:drips`,
        lastFetchAt: Date.now(),
        lastSuccessAt: Date.now(),
        errorMessage: null,
        cursor: null,
      });
    } catch (err) {
      logger.logError('Failed to fetch DRIPS', err, { url });
      const source = await getSource(`${this.id}:drips`);
      await upsertSource({
        adapterId: `${this.id}:drips`,
        lastFetchAt: Date.now(),
        errorMessage: String(err),
        lastSuccessAt: source?.lastSuccessAt || null,
        cursor: source?.cursor || null,
      });
    }
  }

  private parseIncidents(parsed: unknown): TrafficIncident[] {
    const events: TrafficIncident[] = [];
    const root = parsed as any;

    logger.verbose('parseIncidents: Root keys', Object.keys(root).slice(0, 10));

    // Navigate SOAP structure: ?xml + SOAP:Envelope/SOAP:Body/d2LogicalModel
    let d2LogicalModel = root?.d2LogicalModel;
    
    if (!d2LogicalModel && root?.['SOAP:Envelope']) {
      d2LogicalModel = root['SOAP:Envelope']?.['SOAP:Body']?.d2LogicalModel;
      logger.debug('parseIncidents: Found d2LogicalModel in SOAP structure');
    }

    if (!d2LogicalModel) {
      logger.debug('parseIncidents: No d2LogicalModel found');
      return events;
    }

    const logicalModel = d2LogicalModel;
    logger.verbose('parseIncidents: LogicalModel keys', Object.keys(logicalModel).slice(0, 10));

    if (!logicalModel.situationRecord) {
      logger.debug('parseIncidents: No situationRecord found in d2LogicalModel');
      return events;
    }

    const records = Array.isArray(logicalModel.situationRecord)
      ? logicalModel.situationRecord
      : [logicalModel.situationRecord];

    logger.debug(`parseIncidents: Found ${records.length} situation records`);

    for (const record of records) {
      try {
        const situation = record.situation;
        if (!situation) {
          logger.verbose('parseIncidents: Record has no situation');
          continue;
        }

        const eventData = situation.eventData || situation;
        const loc = eventData.eventLocation || eventData.location || {};

        // Extract coordinates
        let coordinates: [number, number] = [5.2913, 52.1326]; // Default to Netherlands center
        if (loc.Point?.Location?.Latitude && loc.Point?.Location?.Longitude) {
          coordinates = [
            parseFloat(loc.Point.Location.Longitude['#text'] || loc.Point.Location.Longitude),
            parseFloat(loc.Point.Location.Latitude['#text'] || loc.Point.Location.Latitude),
          ];
        }

        const incident: TrafficIncident = {
          id: crypto.randomUUID(),
          source: 'ndw',
          sourceId: record['@_id'] || crypto.randomUUID(),
          type: 'incident',
          geometry: {
            type: 'Point',
            coordinates,
          },
          timestamp: Date.now(),
          validFrom: Date.now(),
          validTo: Date.now() + 86400000, // 24 hours
          attributes: {
            description: eventData.eventDescription?.[0]?.['#text'] || eventData.description || 'Traffic incident',
            severity: this.extractSeverity(eventData),
            category: eventData.eventType || 'incident',
          },
          createdAt: Date.now(),
        };

        events.push(incident);
      } catch (err) {
        logger.debug('parseIncidents: Error parsing incident record', err);
      }
    }

    logger.info(`parseIncidents: Parsed ${events.length} events from ${records.length} records`);
    return events;
  }

  private extractSeverity(eventData: any): 'low' | 'medium' | 'high' | 'critical' | undefined {
    const severity = (eventData.severity || '').toLowerCase();
    if (severity.includes('critical') || severity.includes('very high')) return 'critical';
    if (severity.includes('high')) return 'high';
    if (severity.includes('medium')) return 'medium';
    if (severity.includes('low')) return 'low';
    return undefined;
  }

  private parseTrafficSpeed(parsed: unknown): SpeedMeasurement[] {
    const events: SpeedMeasurement[] = [];
    const root = parsed as any;

    // Navigate SOAP structure
    let d2LogicalModel = root?.d2LogicalModel;
    if (!d2LogicalModel && root?.['SOAP:Envelope']) {
      d2LogicalModel = root['SOAP:Envelope']?.['SOAP:Body']?.d2LogicalModel;
    }

    if (!d2LogicalModel?.measurementSiteMeasurements) {
      return events;
    }

    const measurements = Array.isArray(d2LogicalModel.measurementSiteMeasurements)
      ? d2LogicalModel.measurementSiteMeasurements
      : [d2LogicalModel.measurementSiteMeasurements];

    for (const measurement of measurements) {
      try {
        const siteMeasurements = measurement.siteMeasurementsForAPoint || [measurement];
        const speedArray = Array.isArray(siteMeasurements) ? siteMeasurements : [siteMeasurements];

        for (const speed of speedArray) {
          const speedValue = speed.measuredValue?.[0]?.speed?.['#text'] || 
                            speed.speed?.['#text'] || 
                            speed.measuredValue?.speed || 0;
          
          if (!speedValue) continue;

          const event: SpeedMeasurement = {
            id: crypto.randomUUID(),
            source: 'ndw',
            sourceId: measurement['@_id'] || crypto.randomUUID(),
            type: 'speed',
            geometry: {
              type: 'Point',
              coordinates: [5.2913, 52.1326],
            },
            timestamp: Date.now(),
            validFrom: Date.now(),
            validTo: Date.now() + 300000, // 5 minutes
            attributes: {
              speed: parseInt(speedValue),
              averageSpeed: parseInt(speedValue),
            },
            createdAt: Date.now(),
          };

          events.push(event);
        }
      } catch (err) {
        logger.debug('parseTrafficSpeed: Error parsing speed measurement', err);
      }
    }

    logger.debug(`parseTrafficSpeed: Parsed ${events.length} speed measurements`);
    return events;
  }

  private parseTravelTime(parsed: unknown): TravelTime[] {
    const events: TravelTime[] = [];
    const root = parsed as any;

    // Navigate SOAP structure
    let d2LogicalModel = root?.d2LogicalModel;
    if (!d2LogicalModel && root?.['SOAP:Envelope']) {
      d2LogicalModel = root['SOAP:Envelope']?.['SOAP:Body']?.d2LogicalModel;
    }

    if (!d2LogicalModel?.travelTimeMeasurement) {
      return events;
    }

    const measurements = Array.isArray(d2LogicalModel.travelTimeMeasurement)
      ? d2LogicalModel.travelTimeMeasurement
      : [d2LogicalModel.travelTimeMeasurement];

    for (const measurement of measurements) {
      try {
        const duration = measurement.travelTime?.[0]?.duration?.['#text'] || 
                        measurement.duration?.['#text'] || 0;
        
        if (!duration) continue;

        const event: TravelTime = {
          id: crypto.randomUUID(),
          source: 'ndw',
          sourceId: measurement['@_id'] || crypto.randomUUID(),
          type: 'travel_time',
          geometry: {
            type: 'Point',
            coordinates: [5.2913, 52.1326],
          },
          timestamp: Date.now(),
          validFrom: Date.now(),
          validTo: Date.now() + 300000, // 5 minutes
          attributes: {
            duration: parseInt(duration),
          },
          createdAt: Date.now(),
        };

        events.push(event);
      } catch (err) {
        logger.debug('parseTravelTime: Error parsing travel time', err);
      }
    }

    logger.debug(`parseTravelTime: Parsed ${events.length} travel times`);
    return events;
  }

  private parseRoadWork(_parsed: unknown): RoadWork[] {
    return [];
  }

  private parseDRIPS(_parsed: unknown): MessageSign[] {
    return [];
  }

  private async gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
    const stream = new Response(buffer).body;
    if (!stream) throw new Error('No response body');

    const decompressedStream = stream.pipeThrough(
      new DecompressionStream('gzip') as any
    );
    return new Response(decompressedStream).arrayBuffer();
  }
}

export default new NDWAdapter();
