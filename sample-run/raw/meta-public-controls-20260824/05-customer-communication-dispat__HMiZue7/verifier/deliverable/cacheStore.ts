import { caching } from 'cache-manager';

export const cache = caching({ store: 'memory', max: 10000, ttl: 604800 });
