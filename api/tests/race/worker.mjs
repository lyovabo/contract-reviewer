// Worker entry point: load TypeScript through tsx, then run the contender.
import { register } from 'tsx/esm/api';

register();
await import('./contender.ts');
