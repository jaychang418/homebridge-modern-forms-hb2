import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { ModernFormsPlatformAccessory } from './platformAccessory';
import { probe, scanForFans } from './utils/discovery';
import { ModernFormsHttpClient } from './utils/client';

export interface FanConfig {
  ip: string
  light?: boolean
}

interface Config extends PlatformConfig {
  autoDiscover?: boolean
  pollingInterval?: number
  fans?: Array<FanConfig>
}

const DEFAULT_POLLING_INTERVAL = 10;

export class ModernFormsPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];
  private readonly handlers = new Map<string, ModernFormsPlatformAccessory>();

  constructor(
    public readonly log: Logger,
    public readonly config: Config,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.discoverDevices().catch(err => this.log.error('Fan discovery failed:', err));
    });

    this.api.on('shutdown', () => {
      this.handlers.forEach(handler => handler.stop());
    });
  }

  // Seconds between status checks on each fan (0 turns live updates off).
  get pollingInterval(): number {
    const value = Number(this.config.pollingInterval ?? DEFAULT_POLLING_INTERVAL);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_POLLING_INTERVAL;
  }

  // Find the user's settings for the fan at this IP, if they listed it.
  fanConfigFor(ip: string): FanConfig | undefined {
    return this.config.fans?.find(fan => fan.ip === ip);
  }

  // Restore a fan saved from a previous run and wire up its HomeKit controls
  // straight away, using its last known IP. This must not wait for discovery:
  // if the fan happens to be offline at startup, discovery won't find it, and
  // without handlers HomeKit would show the fan as fine while ignoring every tap.
  // Instead, requests fail ("No Response") until the fan is reachable again.
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
    this.handlers.set(accessory.UUID, new ModernFormsPlatformAccessory(this, accessory));
  }

  // Look for fans at their cached IPs, the IPs in the config, and (unless
  // turned off) everywhere on the local network. Add new fans and fix the IP
  // of known fans that moved.
  async discoverDevices() {
    this.log.info('Looking for Modern Forms devices on network');

    const candidates = [
      ...this.accessories.map(accessory => accessory.context.device.ip as string),
      ...(this.config.fans ?? []).map(fan => fan.ip),
    ];
    const found = new Map<string, string>();

    for (const ip of new Set(candidates)) {
      const clientId = await probe(ip);
      if (clientId) {
        found.set(clientId, ip);
      }
    }

    if (this.config.autoDiscover !== false) {
      this.log.debug('Searching network for Modern Forms fans');
      for (const fan of await scanForFans()) {
        if (!found.has(fan.clientId)) {
          found.set(fan.clientId, fan.ip);
        }
      }
    }

    for (const [clientId, ip] of found) {
      this.log.info(`Found device at ${ip} with client ID of ${clientId}`);
      await this.addOrUpdateFan(clientId, ip);
    }
  }

  // Register a newly found fan, or point a known fan at its current IP.
  private async addOrUpdateFan(clientId: string, ip: string) {
    const uuid = this.api.hap.uuid.generate(clientId);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (!existingAccessory) {
      this.log.info('Adding new accessory:', clientId);
      // Use the name given to the fan in the Modern Forms app, e.g. "Porch Fan".
      const details = await new ModernFormsHttpClient(ip).getStatic().catch(() => undefined);
      const name = details?.deviceName?.trim() || clientId.replace(/_/g, ' ');
      const accessory = new this.api.platformAccessory(name, uuid);
      accessory.context.device = { uuid, ip, clientId };
      this.accessories.push(accessory);
      this.handlers.set(uuid, new ModernFormsPlatformAccessory(this, accessory));
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      return;
    }

    // A cached fan was found on the network. Its controls are already wired up
    // in configureAccessory. If it was rediscovered at a different IP than the
    // one stored in the cache (e.g. the user changed its DHCP reservation, or a
    // new lease was issued), point it at the new IP and persist that so
    // subsequent HTTP calls reach the fan instead of the stale address.
    this.log.info('Restoring existing accessory from cache:', clientId);
    if (existingAccessory.context.device.ip !== ip) {
      this.log.info(`IP for ${clientId} changed from ${existingAccessory.context.device.ip} to ${ip}; updating cached accessory`);
      this.handlers.get(uuid)!.updateIp(ip);
      this.api.updatePlatformAccessories([existingAccessory]);
    }
  }
}
