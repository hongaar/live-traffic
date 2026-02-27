import maplibregl from 'maplibre-gl';
import { WSClient } from './ws-client';
import type { AnyEvent, EventListResponse } from '@live-traffic/types';
import type { MapState } from './types';

const API_BASE = process.env.VITE_API_BASE || 'http://localhost:3000';
const WS_URL = process.env.VITE_WS_URL || 'ws://localhost:3000/ws';

let state: MapState = {
  events: new Map(),
  layerVisibility: {
    incident: true,
    speed: true,
    travel_time: true,
    road_work: true,
    message_sign: true,
  },
  selectedEventType: null,
  wsConnected: false,
  subscribed: false,
};

let map: maplibregl.Map;
let wsClient: WSClient;

const eventTypeColors: Record<string, string> = {
  incident: '#e74c3c',
  speed: '#f39c12',
  travel_time: '#3498db',
  road_work: '#9b59b6',
  message_sign: '#1abc9c',
};

function getColorForType(type: string): string {
  return eventTypeColors[type] || '#95a5a6';
}

async function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://demotiles.maplibre.org/style.json',
    center: [5.2913, 52.1326], // Center of Netherlands
    zoom: 7,
  });

  map.on('load', () => {
    // Add sources and layers for each event type
    addEventLayers();
  });
}

function addEventLayers() {
  const eventTypes = ['incident', 'speed', 'travel_time', 'road_work', 'message_sign'];

  for (const type of eventTypes) {
    // Add source
    map.addSource(`source-${type}`, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });

    // Add layer
    map.addLayer({
      id: `layer-${type}`,
      type: 'circle',
      source: `source-${type}`,
      paint: {
        'circle-radius': 6,
        'circle-color': getColorForType(type),
        'circle-opacity': 0.7,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
      },
    });

    // Add popup on click
    map.on('click', `layer-${type}`, (e) => {
      const features = e.features;
      if (features && features.length > 0) {
        const feature = features[0];
        const props = feature.properties;

        new maplibregl.Popup({ closeButton: true, closeOnClick: true })
          .setLngLat(e.lngLat)
          .setHTML(
            `
            <div style="max-width: 250px;">
              <h3 style="margin: 0 0 8px 0;">${props.type.toUpperCase()}</h3>
              <p style="margin: 4px 0; font-size: 12px; color: #666;">
                <strong>Source:</strong> ${props.source}
              </p>
              <p style="margin: 4px 0; font-size: 12px; color: #666;">
                <strong>Time:</strong> ${new Date(props.timestamp).toLocaleString()}
              </p>
              ${
                props.description
                  ? `<p style="margin: 4px 0; font-size: 12px;">${props.description}</p>`
                  : ''
              }
            </div>
          `
          )
          .addTo(map);
      }
    });

    map.on('mouseenter', `layer-${type}`, () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', `layer-${type}`, () => {
      map.getCanvas().style.cursor = '';
    });
  }
}

function updateMapLayers(events: AnyEvent[]) {
  const featuresByType: Record<string, any[]> = {
    incident: [],
    speed: [],
    travel_time: [],
    road_work: [],
    message_sign: [],
  };

  for (const event of events) {
    if (!featuresByType[event.type]) {
      continue;
    }

    const feature = {
      type: 'Feature',
      id: event.id,
      geometry: event.geometry,
      properties: {
        id: event.id,
        type: event.type,
        source: event.source,
        timestamp: event.timestamp,
        description:
          event.attributes.description ||
          event.attributes.message ||
          (event.attributes.speed ? `Speed: ${event.attributes.speed} km/h` : ''),
      },
    };

    featuresByType[event.type].push(feature);
  }

  // Update each layer's source
  for (const [type, features] of Object.entries(featuresByType)) {
    const source = map.getSource(`source-${type}`) as maplibregl.GeoJSONSource;
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features,
      });
    }
  }
}

async function loadEvents() {
  try {
    const typeParam = state.selectedEventType ? `&type=${state.selectedEventType}` : '';
    const response = await fetch(`${API_BASE}/api/events?limit=200${typeParam}`);
    const data = (await response.json()) as EventListResponse;

    // Store events
    for (const event of data.events) {
      state.events.set(event.id, event);
    }

    // Update map
    updateMapLayers(Array.from(state.events.values()));
    updateEventCount();

    console.log(`Loaded ${data.events.length} events`);
  } catch (err) {
    console.error('Failed to load events:', err);
    alert('Failed to load events');
  }
}

function updateEventCount() {
  const count = state.events.size;
  (document.getElementById('event-count') as HTMLElement).textContent = String(count);
}

function updateConnectionStatus() {
  const indicator = document.getElementById('status-indicator') as HTMLElement;
  const text = document.getElementById('status-text') as HTMLElement;

  if (state.wsConnected) {
    indicator.className = 'status-indicator connected';
    text.textContent = state.subscribed ? 'Subscribed' : 'Connected';
  } else {
    indicator.className = 'status-indicator disconnected';
    text.textContent = 'Disconnected';
  }
}

async function initWebSocket() {
  wsClient = new WSClient(WS_URL);

  wsClient.onOpenHandler(() => {
    state.wsConnected = true;
    updateConnectionStatus();
    console.log('WebSocket connected');
  });

  wsClient.onMessageHandler((msg) => {
    if (msg.method === 'query_response') {
      const data = msg.data;
      for (const event of data.events) {
        state.events.set(event.id, event);
      }
      updateMapLayers(Array.from(state.events.values()));
      updateEventCount();
    } else if (msg.method === 'event') {
      state.events.set(msg.data.id, msg.data);
      updateMapLayers(Array.from(state.events.values()));
      updateEventCount();
    }
  });

  wsClient.onCloseHandler(() => {
    state.wsConnected = false;
    state.subscribed = false;
    updateConnectionStatus();
    console.log('WebSocket disconnected');
  });

  wsClient.onErrorHandler((err) => {
    console.error('WebSocket error:', err);
  });

  try {
    await wsClient.connect();
  } catch (err) {
    console.error('Failed to connect WebSocket:', err);
  }
}

function setupEventListeners() {
  // Type filter
  const typeFilter = document.getElementById('type-filter') as HTMLSelectElement;
  typeFilter.addEventListener('change', (e) => {
    state.selectedEventType = (e.target as HTMLSelectElement).value || null;
    loadEvents();
  });

  // Load button
  document.getElementById('load-btn')?.addEventListener('click', loadEvents);

  // Subscribe button
  document.getElementById('subscribe-btn')?.addEventListener('click', () => {
    if (wsClient.isConnected()) {
      const typeParam = state.selectedEventType || undefined;
      wsClient.send({
        method: 'subscribe',
        params: {
          type: typeParam,
        },
      });
      state.subscribed = true;
      (document.getElementById('subscribe-btn') as HTMLElement).style.display = 'none';
      (document.getElementById('unsubscribe-btn') as HTMLElement).style.display = 'block';
      updateConnectionStatus();
    }
  });

  // Unsubscribe button
  document.getElementById('unsubscribe-btn')?.addEventListener('click', () => {
    if (wsClient.isConnected()) {
      wsClient.send({ method: 'unsubscribe' });
      state.subscribed = false;
      (document.getElementById('subscribe-btn') as HTMLElement).style.display = 'block';
      (document.getElementById('unsubscribe-btn') as HTMLElement).style.display = 'none';
      updateConnectionStatus();
    }
  });

  // Layer visibility toggles
  const eventTypes = ['incident', 'speed', 'travel_time', 'road_work', 'message_sign'];
  for (const type of eventTypes) {
    const checkbox = document.getElementById(`layer-${type}`) as HTMLInputElement;
    checkbox?.addEventListener('change', (e) => {
      const visibility = (e.target as HTMLInputElement).checked ? 'visible' : 'none';
      map.setLayoutProperty(`layer-${type}`, 'visibility', visibility);
      state.layerVisibility[type] = visibility === 'visible';
    });
  }
}

async function main() {
  console.log('🚀 Starting Live Traffic Web App...');

  try {
    await initMap();
    await initWebSocket();
    setupEventListeners();
    await loadEvents();

    console.log('✅ App ready');
  } catch (err) {
    console.error('❌ Initialization error:', err);
  }
}

main();
