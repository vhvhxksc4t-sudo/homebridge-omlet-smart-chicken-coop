import * as https from 'https';

const BASE_URL = 'https://x107.omlet.co.uk/api/v1';

export type DoorStateValue =
  | 'open' | 'closed' | 'opening' | 'closing'
  | 'openpending' | 'closepending' | 'stopping' | 'fault';

export type LightStateValue = 'on' | 'off' | 'onpending' | 'offpending';

export interface OmletDevice {
  deviceId: string;
  name: string;
  deviceType: string;
  state: {
    door?:         { state: DoorStateValue; fault: string; lightLevel: number };
    light?:        { state: LightStateValue };
    general?:      { batteryLevel: number; powerSource: 'external' | 'battery' };
    connectivity?: { wifiStrength: number; connected: boolean };
  };
  actions: Array<{ actionName: string; url: string }>;
}

function request<T>(method: string, path: string, apiKey: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: 'x107.omlet.co.uk',
      path: `/api/v1/${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          if (status === 204 || !data.trim()) {
            resolve(undefined as T);
          } else {
            try {
              resolve(JSON.parse(data) as T);
            } catch {
              reject(new Error(`Omlet API: invalid JSON from ${path}`));
            }
          }
        } else {
          reject(new Error(`Omlet API: HTTP ${status} from ${path}: ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Omlet API: ${err.message}`)));
    req.end();
  });
}

export class OmletApi {
  constructor(private readonly apiKey: string) {}

  getDevices(): Promise<OmletDevice[]> {
    return request<OmletDevice[]>('GET', 'device', this.apiKey);
  }

  getDevice(deviceId: string): Promise<OmletDevice> {
    return request<OmletDevice>('GET', `device/${deviceId}`, this.apiKey);
  }

  performAction(deviceId: string, actionName: string): Promise<void> {
    return request<void>('POST', `device/${deviceId}/action/${actionName}`, this.apiKey);
  }
}
