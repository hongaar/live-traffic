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
    const feedName = 'trafficspeed';
    const url = FEEDS.trafficspeed;

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
    const feedName = 'traveltime';
    const url = FEEDS.traveltime;

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
    const feedName = 'roadwork';
    const url = FEEDS.roadwork;

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
    const feedName = 'drips';
    const url = FEEDS.drips;

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

    // Navigate to payloadPublication -> situation -> situationRecord
    const payloadPublication = logicalModel.payloadPublication;
    if (!payloadPublication) {
      logger.debug('parseIncidents: No payloadPublication found in d2LogicalModel');
      return events;
    }

    const situations = Array.isArray(payloadPublication.situation)
      ? payloadPublication.situation
      : payloadPublication.situation ? [payloadPublication.situation] : [];

    logger.debug(`parseIncidents: Found ${situations.length} situations`);

    const records: any[] = [];
    for (const situation of situations) {
      const situationRecords = Array.isArray(situation.situationRecord)
        ? situation.situationRecord
        : situation.situationRecord ? [situation.situationRecord] : [];
      records.push(...situationRecords);
    }

    logger.debug(`parseIncidents: Found ${records.length} situation records`);

    for (const record of records) {
      try {
        // Extract coordinates from groupOfLocations
        const groupOfLocations = record.groupOfLocations;
        let coordinates: [number, number] = [5.2913, 52.1326]; // Default to Netherlands center
        
        if (groupOfLocations?.locationForDisplay?.latitude && groupOfLocations?.locationForDisplay?.longitude) {
          coordinates = [
            parseFloat(groupOfLocations.locationForDisplay.longitude),
            parseFloat(groupOfLocations.locationForDisplay.latitude),
          ];
        } else if (groupOfLocations?.linearByCoordinatesExtension?.linearCoordinatesStartPoint?.pointCoordinates) {
          const point = groupOfLocations.linearByCoordinatesExtension.linearCoordinatesStartPoint.pointCoordinates;
          if (point.latitude && point.longitude) {
            coordinates = [
              parseFloat(point.longitude),
              parseFloat(point.latitude),
            ];
          }
        }

        // Extract description
        let description = 'Traffic incident';
        if (record.vehicleObstructionType) {
          description = `Vehicle obstruction: ${record.vehicleObstructionType}`;
        }

        // Extract source name
        const sourceName = record.source?.sourceName?.values?.value || 'NDW';

        const incident: TrafficIncident = {
          id: crypto.randomUUID(),
          source: 'ndw',
          sourceId: record['@_id'] || record.situationRecordCreationReference || crypto.randomUUID(),
          type: 'incident',
          geometry: {
            type: 'Point',
            coordinates,
          },
          timestamp: Date.now(),
          validFrom: Date.now(),
          validTo: Date.now() + 86400000, // 24 hours
          attributes: {
            description,
            severity: undefined,
            category: record['@_xsi:type'] || 'incident',
            source: sourceName,
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

    if (!d2LogicalModel?.payloadPublication?.siteMeasurements) {
      return events;
    }

    const siteMeasurementsArray = Array.isArray(d2LogicalModel.payloadPublication.siteMeasurements)
      ? d2LogicalModel.payloadPublication.siteMeasurements
      : [d2LogicalModel.payloadPublication.siteMeasurements];

    for (const siteMeasurement of siteMeasurementsArray) {
      try {
        const measuredValues = Array.isArray(siteMeasurement.measuredValue)
          ? siteMeasurement.measuredValue
          : siteMeasurement.measuredValue ? [siteMeasurement.measuredValue] : [];

        for (const measuredValue of measuredValues) {
          try {
            // Check if this has speed data
            const basicData = measuredValue.measuredValue?.basicData;
            if (!basicData) continue;

            const speedData = basicData.averageVehicleSpeed;
            if (!speedData) continue;

            const speedValue = parseInt(speedData.speed);
            // Skip invalid speeds (e.g., -1)
            if (speedValue < 0) continue;

            const event: SpeedMeasurement = {
              id: crypto.randomUUID(),
              source: 'ndw',
              sourceId: siteMeasurement.measurementSiteReference?.['@_id'] || crypto.randomUUID(),
              type: 'speed',
              geometry: {
                type: 'Point',
                coordinates: [5.2913, 52.1326],
              },
              timestamp: Date.now(),
              validFrom: Date.now(),
              validTo: Date.now() + 300000, // 5 minutes
              attributes: {
                speed: speedValue,
                averageSpeed: speedValue,
              },
              createdAt: Date.now(),
            };

            events.push(event);
          } catch (err) {
            logger.debug('parseTrafficSpeed: Error parsing measured value', err);
          }
        }
      } catch (err) {
        logger.debug('parseTrafficSpeed: Error parsing site measurement', err);
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

    if (!d2LogicalModel?.payloadPublication?.siteMeasurements) {
      return events;
    }

    const siteMeasurementsArray = Array.isArray(d2LogicalModel.payloadPublication.siteMeasurements)
      ? d2LogicalModel.payloadPublication.siteMeasurements
      : [d2LogicalModel.payloadPublication.siteMeasurements];

    for (const siteMeasurement of siteMeasurementsArray) {
      try {
        // measuredValue with index attribute contains the actual measuredValue element
        const measuredValues = Array.isArray(siteMeasurement.measuredValue)
          ? siteMeasurement.measuredValue
          : siteMeasurement.measuredValue ? [siteMeasurement.measuredValue] : [];

        for (const measuredValueWrapper of measuredValues) {
          try {
            // The structure is: measuredValue[index] -> measuredValue -> basicData
            const measuredValue = measuredValueWrapper.measuredValue;
            if (!measuredValue) continue;

            const basicData = measuredValue.basicData;
            if (!basicData) continue;

            // Try both direct path and via travelTimeData
            let travelTime = basicData.travelTime;
            if (!travelTime && basicData.travelTimeData) {
              travelTime = basicData.travelTimeData.travelTime;
            }

            if (!travelTime) continue;

            const duration = parseFloat(travelTime.duration);
            if (isNaN(duration) || duration < 0) continue;

            // Duration is already in minutes, convert to seconds
            const durationSeconds = Math.round(duration * 60);

            const event: TravelTime = {
              id: crypto.randomUUID(),
              source: 'ndw',
              sourceId: siteMeasurement.measurementSiteReference?.['@_id'] || crypto.randomUUID(),
              type: 'travel_time',
              geometry: {
                type: 'Point',
                coordinates: [5.2913, 52.1326],
              },
              timestamp: Date.now(),
              validFrom: Date.now(),
              validTo: Date.now() + 300000, // 5 minutes
              attributes: {
                duration: durationSeconds,
              },
              createdAt: Date.now(),
            };

            events.push(event);
          } catch (err) {
            logger.debug('parseTravelTime: Error parsing measured value', err);
          }
        }
      } catch (err) {
        logger.debug('parseTravelTime: Error parsing site measurement', err);
      }
    }

    logger.debug(`parseTravelTime: Parsed ${events.length} travel times`);
    return events;
  }

  private parseRoadWork(parsed: unknown): RoadWork[] {
    const events: RoadWork[] = [];
    const root = parsed as any;

    // Navigate SOAP structure
    let d2LogicalModel = root?.d2LogicalModel;
    if (!d2LogicalModel && root?.['SOAP:Envelope']) {
      d2LogicalModel = root['SOAP:Envelope']?.['SOAP:Body']?.d2LogicalModel;
    }

    if (!d2LogicalModel?.payloadPublication) {
      return events;
    }

    const situations = Array.isArray(d2LogicalModel.payloadPublication.situation)
      ? d2LogicalModel.payloadPublication.situation
      : d2LogicalModel.payloadPublication.situation ? [d2LogicalModel.payloadPublication.situation] : [];

    for (const situation of situations) {
      try {
        const situationRecords = Array.isArray(situation.situationRecord)
          ? situation.situationRecord
          : situation.situationRecord ? [situation.situationRecord] : [];

        for (const record of situationRecords) {
          try {
            // Check if this is maintenance/roadwork type
            if (record['@_xsi:type'] !== 'MaintenanceWorks' && record['@_xsi:type'] !== 'Roadworks') {
              continue;
            }

            // Extract coordinates from groupOfLocations
            const groupOfLocations = record.groupOfLocations;
            let coordinates: [number, number] = [5.2913, 52.1326];
            
            if (groupOfLocations?.locationForDisplay?.latitude && groupOfLocations?.locationForDisplay?.longitude) {
              coordinates = [
                parseFloat(groupOfLocations.locationForDisplay.longitude),
                parseFloat(groupOfLocations.locationForDisplay.latitude),
              ];
            }

            // Extract description
            let description = 'Road work';
            const roadworkHindrance = record.roadworkHindrance;
            if (roadworkHindrance) {
              const hindranceClass = roadworkHindrance.roadworkHindranceClass;
              if (hindranceClass) {
                description = `Road work: ${hindranceClass}`;
              }
            }

            // Extract impact severity
            let impact: 'none' | 'minor' | 'moderate' | 'severe' | undefined = undefined;
            const overallSeverity = situation.overallSeverity;
            if (overallSeverity) {
              if (overallSeverity === 'unknown') impact = 'minor';
              else if (overallSeverity === 'low') impact = 'minor';
              else if (overallSeverity === 'medium') impact = 'moderate';
              else if (overallSeverity === 'high') impact = 'severe';
            }

            // Extract source name
            const sourceName = record.source?.sourceName?.values?.value || 'NDW';

            const event: RoadWork = {
              id: crypto.randomUUID(),
              source: 'ndw',
              sourceId: record['@_id'] || crypto.randomUUID(),
              type: 'road_work',
              geometry: {
                type: 'Point',
                coordinates,
              },
              timestamp: Date.now(),
              validFrom: Date.now(),
              validTo: Date.now() + 86400000, // 24 hours
              attributes: {
                description,
                impact,
                source: sourceName,
              },
              createdAt: Date.now(),
            };

            events.push(event);
          } catch (err) {
            logger.debug('parseRoadWork: Error parsing record', err);
          }
        }
      } catch (err) {
        logger.debug('parseRoadWork: Error parsing situation', err);
      }
    }

    logger.debug(`parseRoadWork: Parsed ${events.length} road works`);
    return events;
  }

  private parseDRIPS(parsed: unknown): MessageSign[] {
    const events: MessageSign[] = [];
    const root = parsed as any;

    // Navigate SOAP structure
    let d2LogicalModel = root?.d2LogicalModel;
    if (!d2LogicalModel && root?.['SOAP:Envelope']) {
      d2LogicalModel = root['SOAP:Envelope']?.['SOAP:Body']?.d2LogicalModel;
    }

    if (!d2LogicalModel?.payloadPublication?.vmsUnit) {
      return events;
    }

    const vmsUnits = Array.isArray(d2LogicalModel.payloadPublication.vmsUnit)
      ? d2LogicalModel.payloadPublication.vmsUnit
      : [d2LogicalModel.payloadPublication.vmsUnit];

    for (const vmsUnit of vmsUnits) {
      try {
        const vmsWrapper = vmsUnit.vms;
        if (!vmsWrapper) continue;

        // vms can be an array or single element
        const vmsArray = Array.isArray(vmsWrapper) ? vmsWrapper : [vmsWrapper];

        for (const vmsOuter of vmsArray) {
          try {
            // Navigate to inner vms
            const vmsInner = vmsOuter.vms;
            if (!vmsInner) continue;

            const vmsInnerArray = Array.isArray(vmsInner) ? vmsInner : [vmsInner];

            for (const vms of vmsInnerArray) {
              try {
                // Check if unit is working
                const isWorking = vms.vmsWorking;
                if (isWorking === false || isWorking === 'false') {
                  continue;
                }

                // Extract messages
                const vmsMessages = Array.isArray(vms.vmsMessage)
                  ? vms.vmsMessage
                  : vms.vmsMessage ? [vms.vmsMessage] : [];

                for (const vmsMessageWrapper of vmsMessages) {
                  try {
                    const vmsMessage = vmsMessageWrapper.vmsMessage;
                    if (!vmsMessage) continue;

                    // Try to extract message text from vmsMessageExtension
                    let messageText = 'VMS Message';
                    
                    if (vmsMessage.vmsMessageExtension) {
                      const msgExt = vmsMessage.vmsMessageExtension;
                      
                      // msgExt could be the extension itself or contain it
                      const extension = msgExt.vmsMessageExtension || msgExt;
                      if (extension?.textLine) {
                        messageText = extension.textLine;
                      }
                    }

                    const event: MessageSign = {
                      id: crypto.randomUUID(),
                      source: 'ndw',
                      sourceId: vmsUnit.vmsUnitReference?.['@_id'] || crypto.randomUUID(),
                      type: 'message_sign',
                      geometry: {
                        type: 'Point',
                        coordinates: [5.2913, 52.1326],
                      },
                      timestamp: Date.now(),
                      validFrom: Date.now(),
                      validTo: Date.now() + 3600000, // 1 hour
                      attributes: {
                        message: messageText,
                      },
                      createdAt: Date.now(),
                    };

                    events.push(event);
                  } catch (err) {
                    logger.debug('parseDRIPS: Error parsing vmsMessage', err);
                  }
                }
              } catch (err) {
                logger.debug('parseDRIPS: Error parsing inner vms', err);
              }
            }
          } catch (err) {
            logger.debug('parseDRIPS: Error parsing outer vms', err);
          }
        }
      } catch (err) {
        logger.debug('parseDRIPS: Error parsing vmsUnit', err);
      }
    }

    logger.debug(`parseDRIPS: Parsed ${events.length} messages/signs`);
    return events;
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
