import axios from 'axios';
import memoize from 'memoizee';

export type ResponsePayload = {
    fanOn: boolean,
    fanSpeed: number,
    fanDirection: 'forward' | 'reverse',
    lightOn: boolean,
    lightBrightness: number,
    clientId: string
}

// Fixed details the fan reports about itself (name, light kit, firmware).
export type StaticPayload = {
    clientId: string,
    deviceName?: string,
    fanType?: string,
    lightType?: string,
    firmwareVersion?: string,
}

type RequestPayload = Omit<Partial<ResponsePayload>, 'clientId'>

const BATCH_TIME = Math.floor(1000 / 60);

// Give up on a fan that hasn't answered within this many milliseconds,
// so HomeKit shows "No Response" instead of waiting forever.
const REQUEST_TIMEOUT = 5000;

export class ModernFormsHttpClient {
  private nextUpdatePayloads: RequestPayload[] = []
  private nextUpdateCallbacks: Array<(promise: Promise<ResponsePayload>) => void> = []

  constructor(private ip: string) {}

  // PRIVATE

  // Send one command (or status query) to the fan and return its reply.
  private request<T = ResponsePayload>(payload: RequestPayload & { queryDynamicShadowData?: 1, queryStaticShadowData?: 1 }) {
    return axios
      .post<T>(`http://${this.ip}/mf`, payload, { timeout: REQUEST_TIMEOUT })
      .then(res => res.data);
  }

  // PUBLIC

  // Point this client at a new address, e.g. after the fan's IP changed.
  public setIp(ip: string) {
    this.ip = ip;
  }

  // Ask the fan for its current state (on/off, speed, light...).
  public readonly get = memoize(
    () => this.request({ queryDynamicShadowData: 1 }),
    { maxAge: BATCH_TIME },
  )

  // Ask the fan for its fixed details (name, light kit, firmware).
  public getStatic() {
    return this.request<StaticPayload>({ queryStaticShadowData: 1 });
  }

  // Queue a change for the fan. Changes made within a few milliseconds of each
  // other are merged into one request. Resolves with the fan's reply.
  public readonly update = (payload: RequestPayload): Promise<ResponsePayload> => {
    if (this.nextUpdatePayloads.length === 0) {
      setTimeout(() => {
        const payload = this.nextUpdatePayloads.reduce<RequestPayload>((final, current) => {
          return { ...final, ...current };
        }, {});

        const callbacks = this.nextUpdateCallbacks;

        this.nextUpdatePayloads = [];
        this.nextUpdateCallbacks = [];

        const promise = this.request(payload);

        callbacks.forEach(callback => callback(promise));
      }, BATCH_TIME);
    }

    return new Promise((res, rej) => {
      this.nextUpdatePayloads.push(payload);
      this.nextUpdateCallbacks.push((promise) => {
        promise.then(res, rej);
      });
    });
  }
}
