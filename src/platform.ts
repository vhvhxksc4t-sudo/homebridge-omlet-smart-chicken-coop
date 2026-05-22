import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';
import { createOmlet } from 'smartcoop-sdk';
import { OmletDoorAccessory } from './accessory';

const PLUGIN_NAME = 'homebridge-omlet-smart-chicken-coop';
const PLATFORM_NAME = 'OmletSmartChickenCoop';

export interface OmletConfig extends PlatformConfig {
  apiKey: string;
  pollInterval?: number;
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

  private async discoverDevices(): Promise<void> {
    const omlet = createOmlet(this.config.apiKey);

    let deviceHandlers;
    try {
      deviceHandlers = await omlet.getDevices();
    } catch (err) {
      this.logger.error('Failed to fetch devices from Omlet API: %s', err);
      return;
    }

    // 'Feeder' devices are intentionally excluded for now — no API support yet.
    // When Omlet adds feeder state/actions to their API, add a FeederAccessory here.
    const autodoors = deviceHandlers.filter((d) => d.getData().deviceType === 'Autodoor');

    if (autodoors.length === 0) {
      this.logger.warn('No Autodoor devices found on this account.');
    }

    const activeUUIDs = new Set<string>();

    for (const deviceHandler of autodoors) {
      const device = deviceHandler.getData();
      const uuid = this.hap.uuid.generate(device.deviceId);
      activeUUIDs.add(uuid);

      const existing = this.accessories.get(uuid);
      if (existing) {
        existing.context.deviceId = device.deviceId;
        this.homebridgeApi.updatePlatformAccessories([existing]);
        this.logger.info('Restored accessory: %s', device.name);
        this.handlers.set(uuid, new OmletDoorAccessory(this, existing, deviceHandler));
      } else {
        const accessory = new this.homebridgeApi.platformAccessory(device.name, uuid);
        accessory.context.deviceId = device.deviceId;
        this.logger.info('Adding new accessory: %s', device.name);
        this.handlers.set(uuid, new OmletDoorAccessory(this, accessory, deviceHandler));
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
