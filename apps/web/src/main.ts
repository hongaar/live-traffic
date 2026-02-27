import maplibregl from 'maplibre-gl';
import { WSClient } from './ws-client';
import type { AnyEvent, EventQueryParams } from '@live-traffic/types';
import type { MapState } from './types';

const WS_URL = import.meta.env.VITE_WS_URL || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

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
    style: 'https://tiles.openfreemap.org/styles/liberty',
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

/**
 * Build filter object based on checked layers
 */
function getEnabledTypesFilter(): string[] | undefined {
  const enabledTypes = Object.entries(state.layerVisibility)
    .filter(([_, visible]) => visible)
    .map(([type, _]) => type);

  if (enabledTypes.length === 0 || enabledTypes.length === 5) {
    // Return undefined to get all types (when none or all are selected)
    return undefined;
  }

  // Return array of enabled types
  return enabledTypes;
}

/**
 * Set filters based on current layer visibility
 */
async function updateFilters() {
  if (!wsClient.isConnected()) {
    console.log('WebSocket not connected, skipping filter update');
    return;
  }

  try {
    const filters: EventQueryParams = {
      type: getEnabledTypesFilter(),
      limit: 200,
      since: Date.now() - 3600000, // Last hour
    };

    console.log('Setting filters:', filters);
    const result = await wsClient.setFilters(filters);

    console.log(`Received ${(result as any).events?.length || 0} historical events`);
    state.subscribed = true;
    updateConnectionStatus();
  } catch (err) {
    console.error('Failed to set filters:', err);
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
    text.textContent = state.subscribed ? 'Connected & Listening' : 'Connected';
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
    // Set initial filters when connected
    updateFilters();
  });

  wsClient.onEventHandler((eventData) => {
    console.log('Received event:', eventData.type);
    state.events.set(eventData.id, eventData);
    updateMapLayers(Array.from(state.events.values()));
    updateEventCount();
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
  // Layer visibility toggles - these now also set filters
  const eventTypes = ['incident', 'speed', 'travel_time', 'road_work', 'message_sign'];
  for (const type of eventTypes) {
    const checkbox = document.getElementById(`layer-${type}`) as HTMLInputElement;
    checkbox?.addEventListener('change', (e) => {
      const visibility = (e.target as HTMLInputElement).checked ? 'visible' : 'none';
      map.setLayoutProperty(`layer-${type}`, 'visibility', visibility);
      state.layerVisibility[type as keyof typeof state.layerVisibility] = visibility === 'visible';

      // Update filters when layer visibility changes
      updateFilters();
    });
  }
}

async function main() {
  console.log('🚀 Starting Live Traffic Web App...');

  try {
    await initMap();
    await initWebSocket();
    setupEventListeners();

    console.log('✅ App ready');
  } catch (err) {
    console.error('❌ Initialization error:', err);
  }
}

main();
