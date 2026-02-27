import { XMLParser } from 'fast-xml-parser';
import {
  type TrafficIncident,
  type SpeedMeasurement,
  type TravelTime,
  type RoadWork,
  type MessageSign,
} from '@live-traffic/types';
import { upsertEvents, upsertSource, getSource } from '@live-traffic/db';
import type { Adapter } from '../../types';

const NDW_BASE_URL = 'https://opendata.ndw.nu';

const FEEDS = {
  incidents: `${NDW_BASE_URL}/incidents.xml.gz`,
  trafficspeed: `${NDW_BASE_URL}/trafficspeed.xml.gz`,
  traveltime: `${NDW_BASE_URL}/traveltime.xml.gz`,
  roadwork: `${NDW_BASE_URL}/wegwerkzaamheden.xml.gz`,
  drips: `${NDW_BASE_URL}/DRIPS.xml.gz`,
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

export class NDWAdapter implements Adapter {
  id = 'ndw';
  private running = false;
  private timers: NodeJS.Timeout[] = [];

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log('[NDW] Starting adapter');

    // Fetch all feeds immediately, then schedule recurring fetches
    await this.fetchAllFeeds();

    // Schedule periodic fetches (every 10 minutes)
    const interval = setInterval(() => {
      this.fetchAllFeeds().catch((err) => {
        console.error('[NDW] Error in scheduled fetch:', err);
      });
    }, 10 * 60 * 1000);

    this.timers.push(interval);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    console.log('[NDW] Stopped adapter');
  }

  private async fetchAllFeeds(): Promise<void> {
    console.log('[NDW] Fetching all feeds...');

    const promises = [
      this.fetchIncidents(),
      this.fetchTrafficSpeed(),
      this.fetchTravelTime(),
      this.fetchRoadWork(),
      this.fetchDRIPS(),
    ];

    const results = await Promise.allSettled(promises);

    results.forEach((result, idx) => {
      const feedName = Object.keys(FEEDS)[idx];
      if (result.status === 'rejected') {
        console.error(`[NDW] Error fetching ${feedName}:`, result.reason);
      }
    });
  }

  private async fetchIncidents(): Promise<void> {
    const url = FEEDS.incidents;
    const source = await getSource(`${this.id}:incidents`);

    try {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const decompressed = await this.gunzip(buffer);
      const xmlStr = new TextDecoder().decode(decompressed);

      const parsed = xmlParser.parse(xmlStr);
      const events = this.parseIncidents(parsed);

      if (events.length > 0) {
        await upsertEvents(events);
        console.log(`[NDW] Inserted/updated ${events.length} incidents`);
      }

      await upsertSource({
        adapterId: `${this.id}:incidents`,
        lastFetchAt: Date.now(),
        lastSuccessAt: Date.now(),
        errorMessage: null,
        cursor: null,
      });
    } catch (err) {
      console.error('[NDW] Failed to fetch incidents:', err);
      await upsertSource({
        adapterId: `${this.id}:incidents`,
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
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const decompressed = await this.gunzip(buffer);
      const xmlStr = new TextDecoder().decode(decompressed);

      const parsed = xmlParser.parse(xmlStr);
      const events = this.parseTrafficSpeed(parsed);

      if (events.length > 0) {
        await upsertEvents(events);
        console.log(`[NDW] Inserted/updated ${events.length} speed measurements`);
      }

      await upsertSource({
        adapterId: `${this.id}:trafficspeed`,
        lastFetchAt: Date.now(),
        lastSuccessAt: Date.now(),
        errorMessage: null,
        cursor: null,
      });
    } catch (err) {
      console.error('[NDW] Failed to fetch traffic speed:', err);
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
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const decompressed = await this.gunzip(buffer);
      const xmlStr = new TextDecoder().decode(decompressed);

      const parsed = xmlParser.parse(xmlStr);
      const events = this.parseTravelTime(parsed);

      if (events.length > 0) {
        await upsertEvents(events);
        console.log(`[NDW] Inserted/updated ${events.length} travel times`);
      }

      await upsertSource({
        adapterId: `${this.id}:traveltime`,
        lastFetchAt: Date.now(),
        lastSuccessAt: Date.now(),
        errorMessage: null,
        cursor: null,
      });
    } catch (err) {
      console.error('[NDW] Failed to fetch travel time:', err);
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
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const decompressed = await this.gunzip(buffer);
      const xmlStr = new TextDecoder().decode(decompressed);

      const parsed = xmlParser.parse(xmlStr);
      const events = this.parseRoadWork(parsed);

      if (events.length > 0) {
        await upsertEvents(events);
        console.log(`[NDW] Inserted/updated ${events.length} road works`);
      }

      await upsertSource({
        adapterId: `${this.id}:roadwork`,
        lastFetchAt: Date.now(),
        lastSuccessAt: Date.now(),
        errorMessage: null,
        cursor: null,
      });
    } catch (err) {
      console.error('[NDW] Failed to fetch road work:', err);
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
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const decompressed = await this.gunzip(buffer);
      const xmlStr = new TextDecoder().decode(decompressed);

      const parsed = xmlParser.parse(xmlStr);
      const events = this.parseDRIPS(parsed);

      if (events.length > 0) {
        await upsertEvents(events);
        console.log(`[NDW] Inserted/updated ${events.length} messages/signs`);
      }

      await upsertSource({
        adapterId: `${this.id}:drips`,
        lastFetchAt: Date.now(),
        lastSuccessAt: Date.now(),
        errorMessage: null,
        cursor: null,
      });
    } catch (err) {
      console.error('[NDW] Failed to fetch DRIPS:', err);
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

  private parseIncidents(_parsed: unknown): TrafficIncident[] {
    // Placeholder parsing logic; would extract incident elements from DATEX II XML
    // For now, return empty array as reference implementation
    return [];
  }

  private parseTrafficSpeed(_parsed: unknown): SpeedMeasurement[] {
    return [];
  }

  private parseTravelTime(_parsed: unknown): TravelTime[] {
    return [];
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
