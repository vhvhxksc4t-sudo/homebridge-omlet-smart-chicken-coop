import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';
import { OmletApi } from './omletApi';
import { OmletDoorAccessory } from './accessory';

const PLUGIN_NAME = 'homebridge-omlet-smart-chicken-coop';
const PLATFORM_NAME = 'OmletSmartChickenCoop';

export interface DeviceOverride {
  name: string;
  hideLight?: boolean;
}

export interface OmletConfig extends PlatformConfig {
  apiKey: string;
  pollInterval?: number;
  devices?: DeviceOverride[];
}

export class OmletCoopDoorPlatform implements DynamicPlatformPlugin {
  public readonly hap: API['hap'];
  private readonly accessories = new Map<string, PlatformAccessory>();
  private readonly handlers = new Map<string, OmletDoorAccessory>();

  constructor(
    public readonly logger: Logger,
    public readonly config: OmletConfig,
    public readonly homebridgeApi: API,
  ) {
    this.hap = homebridgeApi.hap;

    if (!config.apiKey) {
      logger.error('No apiKey configured — plugin will not start.');
      return;
    }

    homebridgeApi.on('didFinishLaunching', () => this.discoverDevices());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }

  private deviceOverride(name: string): DeviceOverride {
    const match = (this.config.devices ?? []).find(
      (d) => d.name.toLowerCase() === name.toLowerCase(),
    );
    return match ?? { name };
  }

  private async discoverDevices(): Promise<void> {
    const api = new OmletApi(this.config.apiKey);

    let devices;
    try {
      devices = await api.getDevices();
    } catch (err) {
      this.logger.error('Failed to fetch devices from Omlet API: %s', err);
      return;
    }

    // 'Feeder' devices are intentionally excluded for now — no API support yet.
    // When Omlet adds feeder state/actions to their API, add a FeederAccessory here.
    const autodoors = devices.filter((d) => d.deviceType === 'Autodoor');

    if (autodoors.length === 0) {
      this.logger.warn('No Autodoor devices found on this account.');
      return;
    }

    this.logger.info('Discovered %d Autodoor device(s):', autodoors.length);
    for (const d of autodoors) {
      this.logger.info('  • %s  (id: %s)', d.name, d.deviceId);
    }

    const activeUUIDs = new Set<string>();

    for (const device of autodoors) {
      const uuid = this.hap.uuid.generate(device.deviceId);
      activeUUIDs.add(uuid);
      const override = this.deviceOverride(device.name);

      const existing = this.accessories.get(uuid);
      if (existing) {
        existing.context.deviceId = device.deviceId;
        this.logger.info('Restored: %s', device.name);
        this.handlers.set(uuid, new OmletDoorAccessory(this, existing, device, override));
        this.homebridgeApi.updatePlatformAccessories([existing]);
      } else {
        const accessory = new this.homebridgeApi.platformAccessory(device.name, uuid);
        accessory.context.deviceId = device.deviceId;
        this.logger.info('Adding: %s', device.name);
        this.handlers.set(uuid, new OmletDoorAccessory(this, accessory, device, override));
        this.homebridgeApi.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
      }
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!activeUUIDs.has(uuid)) {
        this.logger.info('Removing stale accessory: %s', accessory.displayName);
        this.handlers.get(uuid)?.destroy();
        this.handlers.delete(uuid);
        this.homebridgeApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }
  }
}
