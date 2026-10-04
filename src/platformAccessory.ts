import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { ModernFormsPlatform } from './platform';
import { ModernFormsHttpClient, ResponsePayload, StaticPayload } from './utils/client';

const NUMBER_OF_FAN_SPEEDS = 6;

export class ModernFormsPlatformAccessory {
  private client: ModernFormsHttpClient;

  private fanService: Service;
  private lightService?: Service;

  // Last state the fan reported, and whether it answered the last request.
  private state?: ResponsePayload;
  private reachable = true;
  private polling?: NodeJS.Timeout;
  private refreshing?: Promise<void>;

  constructor(
    private readonly platform: ModernFormsPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
      this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Modern Forms')
        .setCharacteristic(this.platform.Characteristic.Model, 'Unknown')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.clientId);

      this.client = new ModernFormsHttpClient(this.accessory.context.device.ip);

      // FAN SERVICE

      this.fanService =
        this.accessory.getService(this.platform.Service.Fan) ??
        this.accessory.addService(this.platform.Service.Fan);

      this.fanService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(this.setFanOn.bind(this))
        .onGet(this.getFanOn.bind(this));

      this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .onSet(this.setRotationSpeed.bind(this))
        .onGet(this.getRotationSpeed.bind(this))
        .setProps({ minStep: this.getStepWithoutGoingOver(6) });

      this.fanService.getCharacteristic(this.platform.Characteristic.RotationDirection)
        .onSet(this.setRotationDirection.bind(this))
        .onGet(this.getRotationDirection.bind(this));

      // LIGHT SERVICE (left out if the user said this fan has no light)

      if (this.platform.fanConfigFor(this.accessory.context.device.ip)?.light === false) {
        this.removeLightService();
      } else {
        this.addLightService();
      }

      this.loadDetails();
      this.startPolling();
  }

  // SETUP

  // Add the light tile and wire up its controls.
  private addLightService() {
    this.lightService =
      this.accessory.getService(this.platform.Service.Lightbulb) ??
      this.accessory.addService(this.platform.Service.Lightbulb);

    this.lightService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setLightOn.bind(this))
      .onGet(this.getLightOn.bind(this));

    this.lightService.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.getBrightness.bind(this))
      .onSet(this.setBrightness.bind(this));
  }

  // Remove the light tile, for fans that have no light kit.
  private removeLightService() {
    const existing = this.accessory.getService(this.platform.Service.Lightbulb);
    if (existing) {
      this.platform.log.info(`[${this.accessory.context.device.ip}] Removing light tile (fan has no light)`);
      this.accessory.removeService(existing);
    }
    this.lightService = undefined;
  }

  // Fetch the fan's name, model and firmware once, and use them for the tiles.
  // Fails quietly: the fan may be offline, and this is cosmetic.
  private async loadDetails() {
    let details: StaticPayload;
    try {
      details = await this.client.getStatic();
    } catch {
      return;
    }

    const name = details.deviceName?.trim();
    if (name) {
      this.fanService.setCharacteristic(this.platform.Characteristic.Name, name);
      this.lightService?.setCharacteristic(this.platform.Characteristic.Name, `${name} Light`);
    }

    const info = this.accessory.getService(this.platform.Service.AccessoryInformation)!;
    if (details.fanType) {
      info.setCharacteristic(this.platform.Characteristic.Model, details.fanType);
    }
    const firmware = this.toFirmwareRevision(details.firmwareVersion);
    if (firmware) {
      info.setCharacteristic(this.platform.Characteristic.FirmwareRevision, firmware);
    }

    // The fan reports an empty light type when no light kit is fitted.
    const lightType = details.lightType?.trim();
    if (lightType !== undefined && (lightType === '' || /^none$/i.test(lightType))) {
      this.removeLightService();
    }
  }

  // Check the fan's state every few seconds, so changes made with the remote
  // or the Modern Forms app show up in the Home app.
  private startPolling() {
    const seconds = this.platform.pollingInterval;
    this.refresh();
    if (seconds > 0) {
      this.polling = setInterval(() => this.refresh(), seconds * 1000);
    }
  }

  // Stop checking the fan (Homebridge is shutting down).
  stop() {
    if (this.polling) {
      clearInterval(this.polling);
    }
  }

  // Switch this fan to a new IP address without rebuilding its HomeKit services.
  updateIp(ip: string) {
    this.accessory.context.device.ip = ip;
    this.client.setIp(ip);
    this.refresh();
  }

  // HELPERS

  getStepWithoutGoingOver = (steps: number) => {
    return Math.floor(100 / steps * 1000) / 1000;
  }

  debug = (...args: unknown[]) => {
    this.platform.log.debug(`[${this.accessory.context.device.ip}]`, ...args);
  }

  // HomeKit wants firmware as plain numbers, e.g. "02.00.0043" -> "2.0.43".
  private toFirmwareRevision(version?: string): string | undefined {
    const parts = version?.match(/\d+/g)?.slice(0, 3).map(Number);
    return parts?.length ? parts.join('.') : undefined;
  }

  // The error HomeKit turns into "No Response" on the tile.
  private noResponse() {
    return new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  // Log once when the fan stops answering, and once when it comes back,
  // instead of an error for every request in between.
  private markReachable(reachable: boolean, error?: unknown) {
    const ip = this.accessory.context.device.ip;
    if (this.reachable && !reachable) {
      const reason = error instanceof Error ? error.message : String(error);
      this.platform.log.warn(`[${ip}] Fan is not responding (${reason}). It will show as "No Response" until it is back.`);
    } else if (!this.reachable && reachable) {
      this.platform.log.info(`[${ip}] Fan is responding again`);
    }
    this.reachable = reachable;
  }

  // Ask the fan for its state and push any changes to the Home app.
  // Only one request is in flight at a time; callers share it.
  private refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.client.get()
        .then(state => {
          this.markReachable(true);
          this.applyState(state);
        })
        .catch(error => this.markReachable(false, error))
        .finally(() => {
          this.refreshing = undefined;
        });
    }
    return this.refreshing;
  }

  // Store the fan's state and update the tiles to match.
  private applyState(state: ResponsePayload) {
    this.state = state;
    const C = this.platform.Characteristic;
    this.fanService.updateCharacteristic(C.On, state.fanOn);
    this.fanService.updateCharacteristic(C.RotationSpeed, state.fanSpeed * 100 / NUMBER_OF_FAN_SPEEDS);
    this.fanService.updateCharacteristic(C.RotationDirection, state.fanDirection === 'forward' ? 0 : 1);
    this.lightService?.updateCharacteristic(C.On, state.lightOn);
    this.lightService?.updateCharacteristic(C.Brightness, state.lightBrightness);
  }

  // Answer a HomeKit status request: from the last check if live updates are
  // on, otherwise by asking the fan. Shows "No Response" if the fan is offline.
  private async readState(): Promise<ResponsePayload> {
    if (!(this.platform.pollingInterval > 0 && this.state && this.reachable)) {
      await this.refresh();
    }
    if (!this.state || !this.reachable) {
      throw this.noResponse();
    }
    return this.state;
  }

  // Send a change to the fan. Shows "No Response" if the fan is offline.
  private async send(payload: Parameters<ModernFormsHttpClient['update']>[0]): Promise<void> {
    try {
      const reply = await this.client.update(payload);
      this.markReachable(true);
      if (this.state) {
        this.state = { ...this.state, ...payload, ...(reply?.clientId ? reply : {}) };
      }
    } catch (error) {
      this.markReachable(false, error);
      throw this.noResponse();
    }
  }

  // FAN GETTERS / SETTERS

  async getFanOn(): Promise<CharacteristicValue> {
    return (await this.readState()).fanOn;
  }

  async setFanOn(value: CharacteristicValue): Promise<void> {
    this.debug('Set Fan Characteristic On ->', value);
    await this.send({ fanOn: Boolean(value) });
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {
    return (await this.readState()).fanSpeed * 100 / NUMBER_OF_FAN_SPEEDS;
  }

  async setRotationSpeed(value: CharacteristicValue): Promise<void> {
    this.debug('Set Fan Characteristic RotationSpeed ->', value);
    const fanSpeed = Math.round(value as number / 100 * NUMBER_OF_FAN_SPEEDS);
    await this.send(fanSpeed > 0 ? { fanOn: true, fanSpeed } : { fanOn: false });
  }

  async getRotationDirection(): Promise<CharacteristicValue> {
    return (await this.readState()).fanDirection === 'forward' ? 0 : 1;
  }

  async setRotationDirection(value: CharacteristicValue): Promise<void> {
    this.debug('Set Fan Characteristic RotationDirection ->', value);
    await this.send({ fanDirection: value === 0 ? 'forward' : 'reverse' });
  }

  // LIGHT GETTERS / SETTERS

  async getLightOn(): Promise<CharacteristicValue> {
    return (await this.readState()).lightOn;
  }

  async setLightOn(value: CharacteristicValue): Promise<void> {
    this.debug('Set Light Characteristic On ->', value);
    await this.send({ lightOn: Boolean(value) });
  }

  async getBrightness(): Promise<CharacteristicValue> {
    return (await this.readState()).lightBrightness;
  }

  async setBrightness(value: CharacteristicValue): Promise<void> {
    this.debug('Set Characteristic Brightness ->', value);
    await this.send({ lightOn: (value as number) > 0, lightBrightness: value as number });
  }
}
