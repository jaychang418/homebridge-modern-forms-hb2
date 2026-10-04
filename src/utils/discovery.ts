import axios from 'axios';
import os from 'os';

// Networks bigger than this (e.g. Docker's /16 bridges) are skipped:
// scanning them would take far too long and fans don't live there.
const MAX_HOSTS_PER_SUBNET = 1024;

// How long to wait for each address to answer, and how many to ask at once.
const PROBE_TIMEOUT = 1500;
const CONCURRENCY = 64;

// Interface name prefixes that belong to containers or VPNs, not the home LAN.
const IGNORED_INTERFACES = /^(docker|br-|veth|virbr|tailscale|utun|tun|tap|zt|wg)/;

export type FoundFan = { ip: string, clientId: string };

// Turn "192.168.1.10" into a number (and back) so address ranges can be counted.
function ipToNumber(ip: string): number {
  return ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
}

function numberToIp(n: number): string {
  return [24, 16, 8, 0].map(shift => Math.floor(n / 2 ** shift) % 256).join('.');
}

// List every host address on the home networks this machine is connected to.
export function listLocalAddresses(): string[] {
  const addresses = new Set<string>();

  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    if (IGNORED_INTERFACES.test(name)) {
      continue;
    }
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) {
        continue;
      }
      const mask = ipToNumber(info.netmask);
      const size = 2 ** 32 - mask;
      if (size > MAX_HOSTS_PER_SUBNET || size < 4) {
        continue;
      }
      const network = ipToNumber(info.address) - (ipToNumber(info.address) % size);
      // Skip the network address (first) and broadcast address (last).
      for (let n = network + 1; n < network + size - 1; n++) {
        if (n !== ipToNumber(info.address)) {
          addresses.add(numberToIp(n));
        }
      }
    }
  }

  return [...addresses];
}

// Ask one address whether it is a Modern Forms fan. Returns its client ID, or
// null if nothing answered or the answer wasn't from a fan.
export async function probe(ip: string, timeout = PROBE_TIMEOUT): Promise<string | null> {
  try {
    const res = await axios.post(`http://${ip}/mf`, { queryDynamicShadowData: 1 }, { timeout });
    const clientId = res.data?.clientId;
    return typeof clientId === 'string' && typeof res.data?.fanOn === 'boolean' ? clientId : null;
  } catch {
    return null;
  }
}

// Ask every address on the local networks, a batch at a time, and return
// the ones that answered as Modern Forms fans.
export async function scanForFans(addresses = listLocalAddresses()): Promise<FoundFan[]> {
  const found: FoundFan[] = [];
  const queue = [...addresses];

  const worker = async () => {
    for (let ip = queue.shift(); ip !== undefined; ip = queue.shift()) {
      const clientId = await probe(ip);
      if (clientId) {
        found.push({ ip, clientId });
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return found;
}
